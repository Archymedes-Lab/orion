// §15 outcome feedback: when a choice followed the leading option, did it turn out well?
// Read-only over saved decisions; nothing here changes weights or scores.
import { db } from "./database.ts";
import { expectedUtility } from "../decision-engine/expectedValue.ts";
import { divergence } from "../decision-engine/divergence.ts";
import type { DecisionFactor, DecisionOption } from "../types.ts";

export type OutcomeTone = "well" | "neutral" | "badly";
export type Tally = Record<OutcomeTone, number>;
export interface Calibration {
  /** The person picked the option the comparison ranked first. */
  followed: Tally;
  /** Not the leader, but too close for the estimates to tell apart. */
  tossup: Tally;
  /** The person chose against the comparison by more than its uncertainty. */
  diverged: Tally;
  /** The same "against" choices, by what the person said was behind them. */
  reasons: Record<string, Tally>;
}

export function toneOf(rating: unknown): OutcomeTone | null {
  if (rating === "Great" || rating === "Good") return "well";
  if (rating === "Neutral") return "neutral";
  if (rating === "Bad" || rating === "Very bad") return "badly";
  return null;
}

/** Latest rating per decision id. */
export async function latestRatings(): Promise<Record<string, string>> {
  await db.init();
  // Rows without a rating are the pending predictions recorded at commit time;
  // only a rated row can be the latest rating.
  const outcomes = [...(await db.list("decision_outcomes"))]
    .filter((o) => o.rating != null && String(o.rating).trim() !== "")
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return Object.fromEntries(outcomes.map((o) => [String(o.decision_id), String(o.rating)]));
}

const empty = (): Tally => ({ well: 0, neutral: 0, badly: 0 });

/**
 * Counts rated, decided decisions by how the choice sat against the comparison.
 * Decisions without estimates have no comparison and are left out.
 */
export async function getCalibration(): Promise<Calibration> {
  const ratings = await latestRatings();
  const [decisions, optionRows, factorRows, valueRows, choiceRows, metadata] = await Promise.all(
    ["decisions", "options", "factors", "option_factor_values", "decision_choices", "decision_metadata"].map((table) => db.list(table))
  );
  const result: Calibration = { followed: empty(), tossup: empty(), diverged: empty(), reasons: {} };
  for (const decision of decisions) {
    const tone = toneOf(ratings[String(decision.id)]);
    const chosen = decision.selected_option_id;
    if (!tone || !chosen) continue;
    const saved = choiceRows.find((c) => c.id === decision.id && c.chosen_option_id === chosen);
    // What the choice was when it was made; decisions saved before this was recorded are assessed from their model.
    let level = saved ? String(saved.initial_level) : null;
    if (!level) {
      const factors: DecisionFactor[] = factorRows
        .filter((r) => r.decision_id === decision.id)
        .map((r) => ({ id: String(r.id), label: String(r.label), weight: Number(r.weight) }));
      const options: DecisionOption[] = optionRows.filter((r) => r.decision_id === decision.id).map((r) => {
        const mine = valueRows.filter((v) => v.option_id === r.id);
        const confidence = mine.length ? mine.reduce((sum, v) => sum + Number(v.confidence), 0) / mine.length : 0.5;
        return {
          id: String(r.id), label: String(r.label), reversibility: Number(r.reversibility ?? 0.5),
          outcomes: [{ id: String(r.id), label: String(r.label), probability: 1, probabilityConfidence: confidence, factors: mine.map((v) => ({ factorId: String(v.factor_id), value: Number(v.value) })) }],
        };
      });
      const scored = metadata.find((m) => m.id === decision.id)?.scoring_source !== "none";
      level = divergence(options, factors, String(chosen), scored).level;
      // A tie at the top has no leader to follow or go against.
      if (level === "aligned" && options.length > 1) {
        const utilities = options.map((o) => expectedUtility(o, factors)).sort((a, b) => b - a);
        if (utilities[0] === utilities[1]) continue;
      }
    }
    if (level === "none" || level === "tied") continue;
    const bucket = level === "aligned" ? "followed" : level === "tossup" ? "tossup" : "diverged";
    result[bucket][tone] += 1;
    if (bucket === "diverged") {
      const reason = saved?.reason ? String(saved.reason) : "unsaid";
      (result.reasons[reason] ??= empty())[tone] += 1;
    }
  }
  return result;
}
