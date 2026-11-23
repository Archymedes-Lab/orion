// Robustness analysis (§11, §12).
// "How much would reasonable changes to assumptions have to occur before the winner changes?"
// Exposes: ROBUST, FRAGILE, TOSS-UP

import type {
  DecisionOption,
  DecisionFactor,
  ScoredOption,
  SensitivityResult,
  Assumption,
  RobustnessLevel,
} from "../types.ts";
import { TIE_GAP, STABLE_GAP } from "./sensitivity.ts";
import { normalizeWeights, normalizeProbabilities } from "./expectedValue.ts";
import { robustnessCache, makeDecisionKey } from "./cache.ts";
import { t } from "../i18n/index.ts";

export interface RobustnessResult {
  level: RobustnessLevel;
  /** Human-readable summary */
  summary: string;
  /** Detailed flip conditions */
  flipConditions: FlipCondition[];
  /** Assumption sensitivity: how much each assumption must change to flip */
  assumptionSensitivity: AssumptionSensitivity[];
  /** What would change the result (for display) */
  whatWouldChange: string[];
}

export interface FlipCondition {
  factorId: string;
  factorLabel: string;
  currentValue: number;
  targetValue: number;
  deltaNeeded: number;
  reachable: boolean;
  description: string;
}

export interface AssumptionSensitivity {
  assumption: string;
  currentValue: number;
  thresholdValue: number;
  deltaNeeded: number;
  reachable: boolean;
  description: string;
  /** The change that flips the result, worded on its own (set when reachable). */
  shift?: string;
}

/** Analyze robustness of the decision. */
export function analyzeRobustness(
  options: DecisionOption[],
  factors: DecisionFactor[],
  scored: ScoredOption[],
  sens: SensitivityResult,
  assumptions: Assumption[] = []
): RobustnessResult {
  if (options.length < 2) {
    return {
      level: "tossup",
      summary: t("Insufficient options for robustness analysis."),
      flipConditions: [],
      assumptionSensitivity: [],
      whatWouldChange: [t("Need at least 2 options to analyze robustness.")],
    };
  }

  const weights = normalizeWeights(factors);
  const sorted = [...scored].sort((a, b) => b.jev - a.jev);
  const leader = options.find(o => o.id === sorted[0].optionId)!;
  const runner = options.find(o => o.id === sorted[1].optionId)!;
  const gap = sorted[0].jev - sorted[1].jev;

  // 1. Factor-based flip conditions (from sensitivity analysis)
  const flipConditions: FlipCondition[] = (sens.thresholds || []).map(th => ({
    factorId: th.factorId,
    factorLabel: th.label,
    currentValue: th.currentValue,
    targetValue: th.targetValue,
    deltaNeeded: th.deltaNeeded,
    reachable: th.reachable,
    description: th.threshold,
  }));

  // 2. Assumption sensitivity
  const assumptionSensitivity = analyzeAssumptionSensitivity(
    leader,
    runner,
    factors,
    weights,
    gap,
    assumptions
  );

  // 3. Determine robustness level
  const level = determineRobustnessLevel(gap, sens, flipConditions, assumptionSensitivity);

  // 4. Generate human-readable summary and what-would-change list
  const { summary, whatWouldChange } = generateRobustnessSummary(
    level,
    leader.label,
    runner.label,
    gap,
    flipConditions,
    assumptionSensitivity
  );

  return { level, summary, flipConditions, assumptionSensitivity, whatWouldChange };
}

function analyzeAssumptionSensitivity(
  leader: DecisionOption,
  runner: DecisionOption,
  factors: DecisionFactor[],
  weights: DecisionFactor[],
  gap: number,
  assumptions: Assumption[]
): AssumptionSensitivity[] {
  if (assumptions.length === 0) return [];

  // For each assumption, estimate how much it would need to change to flip the decision
  // This is a simplified model - in practice, assumptions map to specific factor values
  return assumptions.map(assumption => {
    // Find the most relevant factor for this assumption (by keyword matching)
    const relevantFactor = findRelevantFactor(assumption.statement, factors);
    const weight = relevantFactor ? weights.find(w => w.id === relevantFactor.id)?.weight ?? 0 : 0;

    if (!relevantFactor || weight <= 0) {
      return {
        assumption: assumption.statement,
        currentValue: 0,
        thresholdValue: 0,
        deltaNeeded: 0,
        reachable: false,
        description: t("Assumption not linked to any weighted factor"),
      };
    }

    // Estimate current impact of this assumption on the runner
    const runnerImpact = estimateAssumptionImpact(runner, relevantFactor.id);
    const deltaNeeded = gap / weight;
    const thresholdValue = runnerImpact + deltaNeeded;
    const reachable = thresholdValue <= 10;
    const shift = t("{factor} for \"{option}\" becomes {target} instead of {current}", {
      factor: relevantFactor.label,
      option: runner.label,
      target: round2(Math.min(10, thresholdValue)),
      current: round2(runnerImpact),
    });

    return {
      assumption: assumption.statement,
      currentValue: round2(runnerImpact),
      thresholdValue: round2(Math.min(10, thresholdValue)),
      deltaNeeded: round2(deltaNeeded),
      reachable,
      description: reachable
        ? t("If \"{assumption}\" changes such that {shift}", { assumption: assumption.statement, shift })
        : t("Would require {factor} for \"{option}\" to exceed model maximum (+10)", { factor: relevantFactor.label, option: runner.label }),
      ...(reachable ? { shift } : {}),
    };
  });
}

function findRelevantFactor(assumption: string, factors: DecisionFactor[]): DecisionFactor | null {
  const lower = assumption.toLowerCase();
  // Simple keyword matching
  for (const factor of factors) {
    const label = factor.label.toLowerCase();
    if (lower.includes(label) || lower.includes(factor.id.toLowerCase())) {
      return factor;
    }
  }
  // Fallback: return highest-weighted factor
  return factors.reduce((max, f) => (f.weight > max.weight ? f : max), factors[0]);
}

function estimateAssumptionImpact(option: DecisionOption, factorId: string): number {
  const outs = normalizeProbabilities(option.outcomes);
  let total = 0;
  for (const o of outs) {
    const fv = o.factors.find(f => f.factorId === factorId);
    total += o.probability * (fv?.value ?? 0);
  }
  return total;
}

function determineRobustnessLevel(
  gap: number,
  sens: SensitivityResult,
  flipConditions: FlipCondition[],
  assumptionSensitivity: AssumptionSensitivity[]
): RobustnessLevel {
  // Robust: large gap, stable sensitivity, no reachable flips
  const hasReachableFlip = flipConditions.some(f => f.reachable);
  const hasReachableAssumption = assumptionSensitivity.some(a => a.reachable);

  if (gap > STABLE_GAP && sens.stable && !hasReachableFlip && !hasReachableAssumption) {
    return "robust";
  }
  // Fragile: small gap, or reachable flips/assumptions
  if (gap <= TIE_GAP || hasReachableFlip || hasReachableAssumption) {
    return "fragile";
  }
  // Toss-up: moderate gap but some sensitivity
  return "tossup";
}

function generateRobustnessSummary(
  level: RobustnessLevel,
  leaderLabel: string,
  runnerLabel: string,
  gap: number,
  flipConditions: FlipCondition[],
  assumptionSensitivity: AssumptionSensitivity[]
): { summary: string; whatWouldChange: string[] } {
  const reachableFlips = flipConditions.filter(f => f.reachable);
  const reachableAssumptions = assumptionSensitivity.filter(a => a.reachable);

  if (level === "robust") {
    return {
      summary: t("\"{leader}\" wins robustly (gap {gap}). The result survives reasonable changes to assumptions and factor estimates.", { leader: leaderLabel, gap: gap.toFixed(1) }),
      whatWouldChange: [
        t("No single factor change within realistic bounds would change the result."),
        t("The lead is stable across conservative, expected, and optimistic scenarios."),
      ],
    };
  }

  if (level === "fragile") {
    const items: string[] = [];
    if (gap <= TIE_GAP) {
      items.push(t("\"{leader}\" and \"{runner}\" are effectively tied (gap {gap}). Any small change could flip the result.", { leader: leaderLabel, runner: runnerLabel, gap: gap.toFixed(2) }));
    }
    for (const flip of reachableFlips.slice(0, 2)) {
      items.push(t("If {factor} for \"{runner}\" improves by {delta} points (to {target}), \"{runner}\" becomes competitive.", { factor: flip.factorLabel.toLowerCase(), runner: runnerLabel, delta: flip.deltaNeeded.toFixed(1), target: flip.targetValue }));
    }
    for (const asm of reachableAssumptions.slice(0, 2)) {
      items.push(t("If the assumption \"{assumption}\" changes such that {shift}.", { assumption: asm.assumption, shift: asm.shift || t("the relevant factor shifts sufficiently") }));
    }
    return {
      summary: t("\"{leader}\" leads but the result is fragile (gap {gap}). Small changes to key assumptions or estimates could change the winner.", { leader: leaderLabel, gap: gap.toFixed(1) }),
      whatWouldChange: items,
    };
  }

  // tossup
  return {
    summary: t("\"{leader}\" leads by {gap} points but the result is uncertain. Moderate changes to assumptions could flip the decision.", { leader: leaderLabel, gap: gap.toFixed(1) }),
    whatWouldChange: [
      t("The gap is moderate ({gap}). Several factors could shift the balance.", { gap: gap.toFixed(1) }),
      t("Key factors to watch: {factors}.", { factors: flipConditions.slice(0, 2).map(f => f.factorLabel).join(", ") }),
      t("Consider gathering more information before committing."),
    ],
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cached wrapper for analyzeRobustness */
export function analyzeRobustnessCached(
  options: DecisionOption[],
  factors: DecisionFactor[],
  scored: ScoredOption[],
  sens: SensitivityResult,
  assumptions: Assumption[] = [],
  stakes: string = "normal",
  mode: string = "serious"
): ReturnType<typeof analyzeRobustness> {
  const key = makeDecisionKey(options, factors, stakes, mode) + ":robustness:" + assumptions.map(a => a.id).sort().join(",");
  const cached = robustnessCache.get([key]);
  if (cached !== undefined) return cached;
  
  const result = analyzeRobustness(options, factors, scored, sens, assumptions);
  robustnessCache.set([key], result);
  return result;
}