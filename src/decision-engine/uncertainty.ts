// §7: confidence is separate from probability. Low confidence widens the band.
//
// Two distinct sources of uncertainty, both derived from the model:
//   - dispersion: how far the option's own outcomes sit from its expected
//     utility. Computed as Σ p·(2−c)·(u−E)², where the (2−c) factor inflates
//     each outcome's squared deviation in proportion to how little we trust
//     its likelihood. A distrusted outcome drags the band wider.
//   - ignorance: a floor of (1−confidence)·PRIOR_SPREAD for what we simply do
//     not know. This keeps the honest "neutral offline estimates" case showing
//     a wide band instead of collapsing to a falsely precise zero-width one.
//
// The previous version used `min(2, outcomeCount * 0.4)` as a stand-in for
// dispersion, which is a property of how many rows exist, not of the option.
import type { DecisionFactor, DecisionOption, Outcome, ScoredOption } from "../types.ts";
import {
  expectedUtility,
  normalizeProbabilities,
  normalizeWeights,
  utilityOfOutcome,
} from "./expectedValue.ts";

/** Assumed impact spread, in -10..+10 units, at zero confidence. */
export const PRIOR_SPREAD = 4;

export interface UncertaintyBand {
  jev: number;
  low: number;
  high: number;
  width: number;
  confidence: number;
  /** Half-width contributed by outcome spread alone. */
  dispersion: number;
  /** Half-width contributed by not knowing. */
  ignorance: number;
}

/** Likely range for an option's JEV given outcome dispersion and confidence. */
export function uncertaintyBand(
  option: DecisionOption,
  factors: DecisionFactor[]
): UncertaintyBand {
  const weights = normalizeWeights(factors);
  const weightBy = new Map(weights.map((f) => [f.id, f.weight]));
  const outs = normalizeProbabilities(option.outcomes);
  const jev = expectedUtility(option, factors);

  if (outs.length === 0) {
    return { jev, low: jev, high: jev, width: 0, confidence: 0, dispersion: 0, ignorance: 0 };
  }

  let variance = 0;
  let confidenceSum = 0;
  for (const o of outs) {
    const c = clamp01(o.probabilityConfidence);
    const u = utilityOfOutcome(o, weights, weightBy);
    confidenceSum += o.probability * c;
    // (2 − c): full weight at c=0, half weight at c=1. Deviation measured
    // against the probability-weighted mean utility for this option.
    variance += o.probability * (2 - c) * (u - jev) ** 2;
  }
  const avgConf = clamp01(confidenceSum);

  const dispersion = Math.sqrt(Math.max(0, variance));
  const ignorance = (1 - avgConf) * PRIOR_SPREAD;
  const half = dispersion + ignorance;

  return { jev, low: jev - half, high: jev + half, width: half * 2, confidence: avgConf, dispersion, ignorance };
}

export function confidenceLabel(c: number): "Low" | "Medium" | "High" {
  if (c < 0.45) return "Low";
  if (c < 0.75) return "Medium";
  return "High";
}

/** Display range like "45–85%" for a single probability + confidence. */
export function probabilityRange(p: number, confidence: number): [number, number] {
  const half = (1 - confidence) * 0.5;
  return [Math.max(0, p - half), Math.min(1, p + half)];
}

export function scoreAll(options: DecisionOption[], factors: DecisionFactor[]): ScoredOption[] {
  return options.map((o) => {
    const band = uncertaintyBand(o, factors);
    return {
      optionId: o.id,
      jev: round2(band.jev),
      confidence: round2(band.confidence),
      uncertaintyWidth: round2(band.width),
      low: round2(band.low),
      high: round2(band.high),
    };
  });
}

/** Re-weight an option's outcomes, preserving everything except probability. */
export function reweightOutcomes(
  option: DecisionOption,
  weights: number[]
): DecisionOption {
  const outs: Outcome[] = option.outcomes.map((o, i) => ({
    ...o,
    probability: Math.max(0, weights[i] ?? 0),
  }));
  return { ...option, outcomes: outs };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;