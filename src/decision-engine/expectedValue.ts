// Deterministic JEV engine. LLM structures, math decides (§24, §27).
// JEV(option) = Σ P(outcome) × Σ factor.value × factor.weight
import type { DecisionFactor, DecisionOption, Outcome } from "../types.ts";

export function normalizeWeights(factors: DecisionFactor[]): DecisionFactor[] {
  const sum = factors.reduce((a, f) => a + Math.max(0, f.weight), 0);
  if (sum <= 0) {
    const w = factors.length ? 1 / factors.length : 0;
    return factors.map((f) => ({ ...f, weight: w }));
  }
  return factors.map((f) => ({ ...f, weight: Math.max(0, f.weight) / sum }));
}

/** How much one "matters more" or "matters less" tap moves a factor's weight, before renormalising. */
export const NUDGE_STEP = 1.6;
/** No factor is nudged to nothing: a factor the person listed still counts a little. */
const NUDGE_FLOOR = 0.02;

/**
 * One factor made to matter more or less, the rest renormalised around it. Pure: the caller decides whether
 * the new weights are kept. Unknown ids, or a single factor, return the weights unchanged (normalised).
 */
export function nudgedWeights(factors: DecisionFactor[], factorId: string, direction: "more" | "less"): DecisionFactor[] {
  const base = normalizeWeights(factors);
  if (base.length < 2 || !base.some((f) => f.id === factorId)) return base;
  const changed = base.map((f) => f.id !== factorId ? f : { ...f, weight: Math.max(NUDGE_FLOOR, direction === "more" ? f.weight * NUDGE_STEP : f.weight / NUDGE_STEP) });
  return normalizeWeights(changed);
}

export function normalizeProbabilities(outcomes: Outcome[]): Outcome[] {
  const sum = outcomes.reduce((a, o) => a + o.probability, 0);
  if (sum <= 0) return outcomes.map((o) => ({ ...o, probability: 1 / outcomes.length }));
  if (Math.abs(sum - 1) < 1e-9) return outcomes;
  return outcomes.map((o) => ({ ...o, probability: o.probability / sum }));
}

export function utilityOfOutcome(
  outcome: Outcome,
  factors: DecisionFactor[],
  weightBy: Map<string, number>
): number {
  let u = 0;
  for (const fv of outcome.factors) {
    const w = weightBy.get(fv.factorId) ?? 0;
    u += fv.value * w;
  }
  return u;
}

/** Expected utility on a roughly -10..+10 scale. */
export function expectedUtility(option: DecisionOption, factors: DecisionFactor[]): number {
  const norm = normalizeWeights(factors);
  const weightBy = new Map(norm.map((f) => [f.id, f.weight]));
  const outs = normalizeProbabilities(option.outcomes);
  return outs.reduce((acc, o) => acc + o.probability * utilityOfOutcome(o, norm, weightBy), 0);
}

export function validateOption(option: DecisionOption): void {
  for (const o of option.outcomes) {
    if (!(o.probability >= 0 && o.probability <= 1))
      throw new Error(`Outcome ${o.id}: probability must be in [0,1]`);
    if (!(o.probabilityConfidence >= 0 && o.probabilityConfidence <= 1))
      throw new Error(`Outcome ${o.id}: confidence must be in [0,1]`);
    for (const fv of o.factors) {
      if (!(fv.value >= -10 && fv.value <= 10))
        throw new Error(`Outcome ${o.id}: factor value must be in [-10,10]`);
    }
  }
  if (!(option.reversibility >= 0 && option.reversibility <= 1))
    throw new Error(`Option ${option.id}: reversibility must be in [0,1]`);
}
