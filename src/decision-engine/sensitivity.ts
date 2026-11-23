// §10 sensitivity: "what would have to be true for the decision to change?"
//
// JEV is linear in every factor value: JEV(option) = Σ P(outcome) · Σ v·w.
// So the change that exactly closes the leader/runner gap is gap / weight —
// no search, no estimation. An earlier version returned `50 + gap*8` percent,
// a number with no relationship to the model, which made the most confident
// part of the product's output fictional.
import type {
  DecisionFactor,
  DecisionOption,
  FlipThreshold,
  SensitivityResult,
} from "../types.ts";
import { t } from "../i18n/index.ts";
import { expectedUtility, normalizeProbabilities, normalizeWeights } from "./expectedValue.ts";

/** A gap at or below this counts as a tie rather than a lead. */
export const TIE_GAP = 0.35;
/** Above this the lead survives any single-factor shock inside the model's range. */
export const STABLE_GAP = 1.2;

/** Expected impact of one option on one factor, in -10..+10 model units. */
export function impactOf(option: DecisionOption, factorId: string): number {
  const outs = normalizeProbabilities(option.outcomes);
  let total = 0;
  for (const o of outs) {
    total += o.probability * (o.factors.find((f) => f.factorId === factorId)?.value ?? 0);
  }
  return total;
}

/**
 * Exact per-factor flip thresholds for the runner-up to overtake the leader.
 * Factors are ranked by how little change they need, i.e. the cheapest way to
 * change the answer.
 */
export function flipThresholds(
  leader: DecisionOption,
  runner: DecisionOption,
  factors: DecisionFactor[],
  gap: number
): FlipThreshold[] {
  const weights = normalizeWeights(factors);
  const out: FlipThreshold[] = [];

  for (const factor of weights) {
    if (factor.weight <= 0) continue;
    const deltaNeeded = gap / factor.weight;
    const currentValue = round2(impactOf(runner, factor.id));
    const rawTarget = currentValue + deltaNeeded;
    const targetValue = round2(Math.min(10, rawTarget));
    const reachable = rawTarget <= 10 + 1e-9;
    out.push({
      factorId: factor.id,
      label: factor.label,
      deltaNeeded: round2(deltaNeeded),
      currentValue,
      targetValue,
      reachable,
      threshold: reachable
        ? t("{option} on {factor} would need to be {target} instead of {current} (+{delta})", { option: runner.label, factor: factor.label, target: targetValue, current: currentValue, delta: round2(deltaNeeded) })
        : t("{option} would need {factor} above +10, outside the model's range", { option: runner.label, factor: factor.label }),
    });
  }

  // Reachable flips first (what could actually change the answer), then the
    // smallest change that would close the gap.
  return out.sort(
    (a, b) => Number(b.reachable) - Number(a.reachable) || a.deltaNeeded - b.deltaNeeded
  );
}

export function sensitivity(
  options: DecisionOption[],
  factors: DecisionFactor[]
): SensitivityResult {
  if (options.length < 2) return { flips: [], dominantFactors: [], stable: true, thresholds: [], gap: 0 };

  const weights = normalizeWeights(factors);
  const scored = options
    .map((o) => ({ o, jev: expectedUtility(o, factors) }))
    .sort((a, b) => b.jev - a.jev);
  const [top, runner] = scored;
  const gap = top.jev - runner.jev;

  // Attribution: how much each factor favours the leader over the runner-up.
  const impacts = factors.map((f) => {
    const weight = weights.find((w) => w.id === f.id)?.weight ?? 0;
    const delta = impactOf(top.o, f.id) - impactOf(runner.o, f.id);
    return { factorId: f.id, label: f.label, impact: round2(delta * weight) };
  });
  const dominantFactors = [...impacts].sort(
    (a, b) => Math.abs(b.impact) - Math.abs(a.impact)
  );

  const thresholds = flipThresholds(top.o, runner.o, factors, Math.max(0, gap));

  const flips: SensitivityResult["flips"] = [];
  if (gap <= TIE_GAP) {
    flips.push({
      description: t("{leader} and {runner} are effectively tied (gap {gap}).", { leader: top.o.label, runner: runner.o.label, gap: gap.toFixed(2) }),
      threshold: t("any change above 0.5 breaks the tie"),
    });
  } else if (gap > 5) {
    flips.push({
      description: t("\"{leader}\" leads by a wide margin (gap {gap}).", { leader: top.o.label, gap: gap.toFixed(1) }),
      threshold: t("No single factor would close it; several estimates would have to change together."),
    });
  } else {
    const first = thresholds.find((x) => x.reachable);
    if (first) {
      flips.push({
        description: t("If {factor} favours \"{runner}\" more strongly, \"{runner}\" becomes competitive.", { factor: first.label.toLowerCase(), runner: runner.o.label }),
        threshold: first.threshold,
      });
    }
  }

  if (flips.length === 0) {
    flips.push({
      description: t("\"{leader}\" leads by a wide margin (gap {gap}). No single factor would close it; several estimates would have to change together.", { leader: top.o.label, gap: gap.toFixed(1) }),
      threshold: t("gap > 5"),
    });
  }

  return {
    flips: flips.slice(0, 3),
    dominantFactors: dominantFactors.slice(0, 4).map((i) => ({ ...i, impact: i.impact })),
    stable: gap > STABLE_GAP,
    thresholds,
    gap: round2(gap),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;