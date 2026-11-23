// §28 scenario engine: conservative / expected / optimistic.
//
// Scenarios re-weight each option's own outcomes toward its better or worse
// tail. That makes them answer a real question — "does the leader survive if
// things go badly?" — and it only means anything once an option has more than
// one outcome.
//
// The previous version shifted every factor value by a fixed amount derived
// from confidence. Because the same shift hit every option, the ordering
// almost never changed and the reported "stability" was close to meaningless.
import type { DecisionFactor, DecisionOption, ScenarioResult, ScoredOption } from "../types.ts";
import { scoreAll } from "./uncertainty.ts";
import { normalizeProbabilities, normalizeWeights, utilityOfOutcome } from "./expectedValue.ts";

/** Tilt strength, in utility units (utilities run roughly -10..+10). */
export const TILT = 0.35;
/** Extra mass given to outcomes whose likelihood we are unsure about. */
export const DOUBT_TILT = 1;

/**
 * Softmax re-weighting of an option's outcomes toward one tail.
 * `dir` +1 favours higher-utility outcomes, -1 favours lower.
 * Outcomes we trust less gain mass in the pessimistic direction only, because
 * uncertainty is asymmetric risk.
 */
function tiltWeights(
  option: DecisionOption,
  weights: DecisionFactor[],
  dir: -1 | 1
): number[] {
  const weightBy = new Map(weights.map((f) => [f.id, f.weight]));
  const outs = normalizeProbabilities(option.outcomes);
  const utilities = outs.map((o) => utilityOfOutcome(o, weights, weightBy));

  const raw = outs.map((o, i) => {
    const base = o.probability;
    if (base <= 0) return 0;
    const exponential = Math.exp(dir * TILT * utilities[i]);
    const doubt =
      dir === -1 ? 1 + DOUBT_TILT * (1 - clamp01(o.probabilityConfidence)) : 1;
    return base * exponential * doubt;
  });

  const sum = raw.reduce((a, b) => a + b, 0);
  // Degenerate model (single outcome, or all mass zero): leave it alone rather
  // than inventing movement.
  if (sum <= 0) return outs.map((o) => o.probability);
  return raw.map((v) => v / sum);
}

function applyTilt(
  options: DecisionOption[],
  factors: DecisionFactor[],
  dir: -1 | 1
): DecisionOption[] {
  const weights = normalizeWeights(factors);
  return options.map((o) => {
    if (o.outcomes.length < 2) return o;
    const weightsForOption = tiltWeights(o, weights, dir);
    return {
      ...o,
      outcomes: o.outcomes.map((oc, i) => ({ ...oc, probability: weightsForOption[i] })),
    };
  });
}

function leaderOf(rows: ScoredOption[]): string {
  return [...rows].sort((a, b) => b.jev - a.jev)[0]?.optionId ?? "";
}

export function runScenarios(
  options: DecisionOption[],
  factors: DecisionFactor[]
): ScenarioResult {
  const expected = scoreAll(options, factors);
  const conservative = scoreAll(applyTilt(options, factors, -1), factors);
  const optimistic = scoreAll(applyTilt(options, factors, 1), factors);

  const leaders = [leaderOf(conservative), leaderOf(expected), leaderOf(optimistic)];
  const distinct = new Set(leaders).size;
  return {
    conservative,
    expected,
    optimistic,
    stability: distinct === 1 ? "high" : distinct === 2 ? "medium" : "low",
  };
}

/**
 * True when the model carries no outcome structure to test. Scenarios on such
 * a model are a no-op, and the UI should say so instead of implying robustness.
 */
export function scenariosAreInert(options: DecisionOption[]): boolean {
  return options.every((o) => o.outcomes.length < 2);
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);