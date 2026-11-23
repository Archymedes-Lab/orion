// Outcome tracking and calibration (§15).
//
// ORION records what it predicted for the chosen option, then asks how it
// actually turned out, and reports whether it has been too optimistic or too
// cautious.
//
// Both sides live on the model's own -10..+10 scale so they can be compared
// directly: the prediction is the option's JEV at commit time, and the rating
// is mapped onto the same range. Grouping by the rating itself would be
// circular — a bucket defined by its own answer cannot reveal a bias.
//
// Nothing here feeds back into the model automatically. A user's rating is
// noisy, and silently reweighting their next decision on the strength of one
// review is exactly the kind of invisible adjustment that erodes trust.
import { t } from "../i18n/index.ts";
import { clamp01 } from "./normalize.ts";

export type OutcomeRating = "much-better" | "better" | "as-expected" | "worse" | "much-worse";

export const OUTCOME_RATINGS: OutcomeRating[] = [
  "much-better",
  "better",
  "as-expected",
  "worse",
  "much-worse",
];

/** Rating → the model's own -10..+10 scale. */
const RATING_IMPACT: Record<OutcomeRating, number> = {
  "much-better": 10,
  better: 5,
  "as-expected": 0,
  worse: -5,
  "much-worse": -10,
};

export function ratingToImpact(rating: OutcomeRating): number {
  return RATING_IMPACT[rating] ?? 0;
}

/** How far along the good/bad scale the rating sits, as a 0..1 probability. */
export function ratingToProbability(rating: OutcomeRating): number {
  return clamp01((ratingToImpact(rating) + 10) / 20);
}

export interface OutcomeRecord {
  decisionId: string;
  /** What the model predicted for the chosen option, in -10..+10 units. */
  expectedOutcome: number | null;
  /** The user's rating, if they have given one. */
  rating: OutcomeRating | null;
}

export interface CalibrationBucket {
  /** Lower bound of the predicted band, on the -10..+10 scale. */
  from: number;
  to: number;
  count: number;
  /** Mean the model predicted across the bucket. */
  predicted: number;
  /** Mean the user actually reported. */
  actual: number | null;
  /** actual − predicted. Positive means ORION was too cautious. */
  bias: number | null;
}

// Bands are fixed rather than data-derived, otherwise the buckets move as
// records arrive and the trend becomes unreadable.
const BANDS: [number, number][] = [
  [-11, -6],
  [-6, -2],
  [-2, 2],
  [2, 6],
  [6, 11],
];

export function calibrate(records: OutcomeRecord[]): CalibrationBucket[] {
  return BANDS.map(([from, to]) => {
    const reviewed = records.filter(
      (r) =>
        r.rating !== null &&
        r.expectedOutcome !== null &&
        Number.isFinite(r.expectedOutcome) &&
        r.expectedOutcome >= from &&
        r.expectedOutcome < to
    ) as { rating: OutcomeRating; expectedOutcome: number }[];

    const label = { from, to: Math.min(to, 10) };
    if (reviewed.length === 0) {
      return { ...label, count: 0, predicted: 0, actual: null, bias: null };
    }
    const predicted = mean(reviewed.map((r) => r.expectedOutcome));
    const actual = mean(reviewed.map((r) => ratingToImpact(r.rating)));
    return {
      ...label,
      count: reviewed.length,
      predicted: round2(predicted),
      actual: round2(actual),
      bias: round2(actual - predicted),
    };
  });
}

export interface CalibrationSummary {
  reviewed: number;
  pending: number;
  buckets: CalibrationBucket[];
  /** Mean predicted, mean reported, or null when nothing is reviewed yet. */
  predicted: number | null;
  actual: number | null;
  /** actual − predicted. Positive means ORION was too cautious. */
  bias: number | null;
  /** Plain-language read of the trend, or a reason there isn't one yet. */
  message: string;
}

export function calibrationSummary(records: OutcomeRecord[]): CalibrationSummary {
  const reviewed = records.filter(
    (r) => r.rating !== null && r.expectedOutcome !== null && Number.isFinite(r.expectedOutcome)
  ) as { rating: OutcomeRating; expectedOutcome: number }[];
  const buckets = calibrate(records);
  const pending = records.filter((r) => r.rating === null).length;

  if (reviewed.length === 0) {
    return {
      reviewed: 0,
      pending,
      buckets,
      predicted: null,
      actual: null,
      bias: null,
      message:
        records.length === 0
          ? t("No decisions to review yet.")
          : t("Review a past decision and ORION can tell you how its predictions have held up."),
    };
  }

  const predicted = mean(reviewed.map((r) => r.expectedOutcome));
  const actual = mean(reviewed.map((r) => ratingToImpact(r.rating)));
  const bias = actual - predicted;
  const n = reviewed.length;
  const one = n === 1;

  // A handful of ratings are anecdotes, not a trend.
  const message =
    n < 5
      ? one
        ? t("Based on {n} reviewed decision — too few to call a pattern yet.", { n })
        : t("Based on {n} reviewed decisions — too few to call a pattern yet.", { n })
      : Math.abs(bias) <= 1
        ? t("Based on {n} reviewed decisions, ORION's predictions have been close to how things turned out.", { n })
        : bias > 0
          ? t("Based on {n} reviewed decisions, ORION has tended to be too cautious about how well things would go.", { n })
          : t("Based on {n} reviewed decisions, ORION has tended to be too optimistic about how well things would go.", { n });

  return {
    reviewed: n,
    pending,
    buckets,
    predicted: round2(predicted),
    actual: round2(actual),
    bias: round2(bias),
    message,
  };
}

/**
 * How far off one decision turned out to be, in model units. Null when the
 * decision recorded no prediction, since there is nothing to compare.
 */
export function outcomeError(record: OutcomeRecord): number | null {
  if (record.rating === null || record.expectedOutcome === null) return null;
  if (!Number.isFinite(record.expectedOutcome)) return null;
  return round2(Math.abs(ratingToImpact(record.rating) - record.expectedOutcome));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round2 = (n: number) => Math.round(n * 100) / 100;