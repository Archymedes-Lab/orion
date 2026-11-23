// Value of information: what is worth finding out, and what is not.
//
 // The governing rule is the same one the stopping rule uses (§5), applied
 // per-factor instead of per-question: learning something is worth suggesting
 // only if it could plausibly change which option wins. That gives a hard cut —
 // when no factor inside the model's range can close the gap, every candidate
 // scores zero and the honest answer is "you probably know enough".
 //
 // An earlier version returned a fixed sentence regardless of the model.
 import type { DecisionFactor, DecisionOption, Unknown, Constraint, Assumption } from "../types.ts";
 import { normalizeProbabilities, normalizeWeights } from "./expectedValue.ts";
 import { flipThresholds } from "./sensitivity.ts";
 import { uid } from "./normalize.ts";
import { t } from "../i18n/index.ts";

 export type InformationKind = "explicit" | "factor-spread" | "uninformed" | "constraint" | "assumption" | "risk";

 export interface InformationCandidate {
   id: string;
   question: string;
   kind: InformationKind;
   factorId?: string;
   constraintId?: string;
   assumptionId?: string;
   riskId?: string;
   /**
    * How many JEV points resolving this could move, from the model. 0 means it
    * cannot change the winner, which is why we do not ask.
    */
   estimatedImpact: number;
   canChangeResult: boolean;
   /** 0..1 — how little the current model knows about this. */
   doubt: number;
   /** Priority factors for question selection */
   resolvesHardConstraint: boolean;
   resolvesMajorUncertainty: boolean;
   distinguishesLeaders: boolean;
   affectsLargeWeight: boolean;
   eliminatesUnrealisticOption: boolean;
   /** Ranking key. 0 means "do not ask". */
   score: number;
 }

interface FactorReading {
  /** Observed spread of this factor's impact across an option's outcomes. */
  spread: number;
  /** Probability-weighted confidence in this factor's value. */
  confidence: number;
  /** True when the factor has no estimated impact at all for any option. */
  unestimated: boolean;
}

/** What the model currently says about one factor, pooled across options. */
function readFactor(options: DecisionOption[], factorId: string): FactorReading {
  let spread = 0;
  let weightedConfidence = 0;
  let totalProbability = 0;
  let unestimated = true;

  for (const option of options) {
    const outs = normalizeProbabilities(option.outcomes);
    const values = outs.map((o) => o.factors.find((f) => f.factorId === factorId)?.value);
    const present = values.filter((v): v is number => v !== undefined && v !== 0);
    if (present.length > 0) unestimated = false;
    if (values.length > 0) {
      const finite = values.filter((v): v is number => typeof v === "number");
      if (finite.length > 1) spread = Math.max(spread, Math.max(...finite) - Math.min(...finite));
      else if (finite.length === 1) spread = Math.max(spread, Math.abs(finite[0]));
    }
    for (const o of outs) {
      weightedConfidence += o.probability * o.probabilityConfidence;
      totalProbability += o.probability;
    }
  }

  return {
    spread,
    confidence: totalProbability > 0 ? weightedConfidence / options.length : 0,
    unestimated,
  };
}

/**
 * Rank what is worth learning. Explicit questions (the extractor's own
 * missing-information list) keep their order below factor-derived candidates,
 * because those are backed by the model and these are not.
 * 
 * Priority order for question selection:
 * 1. Resolves hard constraints (highest priority)
 * 2. Resolves major uncertainty that distinguishes leaders
 * 3. Affects large criterion weights
 * 4. Eliminates unrealistic options
 * 5. General factor uncertainty
 */
export function rankInformationValue(
  options: DecisionOption[],
  factors: DecisionFactor[],
  missing: string[] = [],
  constraints: Constraint[] = [],
  assumptions: Assumption[] = [],
  risks: Array<{ id: string; description: string }> = []
): InformationCandidate[] {
  const candidates: InformationCandidate[] = [];

  if (options.length >= 2) {
    const weights = normalizeWeights(factors);
    const jevs = options.map((o) => {
      const outs = normalizeProbabilities(o.outcomes);
      const weightBy = new Map(weights.map((f) => [f.id, f.weight]));
      return outs.reduce((acc, o) => {
        const u = o.factors.reduce((a, fv) => a + fv.value * (weightBy.get(fv.factorId) ?? 0), 0);
        return acc + o.probability * u;
      }, 0);
    });
    const sorted = [...jevs].sort((a, b) => b - a);
    const leader = options[jevs.indexOf(sorted[0])];
    const runner = options[jevs.indexOf(sorted[1])];
    const gap = Math.max(0, sorted[0] - sorted[1]);

    // Exact per-factor close-the-gap thresholds
    const thresholds = gap > 0 ? flipThresholds(leader, runner, factors, gap) : [];

    // Hard constraints that could be resolved by questions
    const hardConstraints = constraints.filter(c => c.type === "HARD" && c.subject && c.operator && c.numericValue !== undefined);

    for (const factor of factors) {
      const weight = weights.find((w) => w.id === factor.id)?.weight ?? 0;
      if (weight <= 0) continue;
      const reading = readFactor(options, factor.id);
      const doubt = round2(Math.max(0, Math.min(1, 1 - reading.confidence)));

      let estimatedImpact = 0;
      let canChangeResult = false;
      const threshold = thresholds.find((t) => t.factorId === factor.id);

      if (reading.unestimated) {
        estimatedImpact = 0;
        canChangeResult = true;
      } else if (threshold) {
        const bestCase = weight * (10 - threshold.currentValue);
        estimatedImpact = round2(bestCase);
        canChangeResult = threshold.reachable;
      }

      // Check if this factor relates to hard constraints
      const relatedConstraint = hardConstraints.find(c => c.subject?.toLowerCase() === factor.label.toLowerCase() || c.subject?.toLowerCase() === factor.id.toLowerCase());
      const resolvesHardConstraint = !!relatedConstraint;

      // Check if this distinguishes leaders (high weight + high doubt + can change result)
      const distinguishesLeaders = canChangeResult && weight > 0.3 && doubt > 0.3;

      // Check if affects large weight
      const affectsLargeWeight = weight > 0.4;

      // Check if could eliminate unrealistic option (factor spread suggests an option is implausible)
      const eliminatesUnrealisticOption = reading.spread > 8 && doubt > 0.5;

      candidates.push({
        id: uid("info"),
        question: questionForFactor(factor.label),
        kind: reading.unestimated ? "uninformed" : "factor-spread",
        factorId: factor.id,
        estimatedImpact,
        canChangeResult,
        doubt,
        resolvesHardConstraint,
        resolvesMajorUncertainty: reading.unestimated || doubt > 0.7,
        distinguishesLeaders,
        affectsLargeWeight,
        eliminatesUnrealisticOption,
        score: calculateInfoScore({
          estimatedImpact,
          canChangeResult,
          doubt,
          weight,
          resolvesHardConstraint,
          distinguishesLeaders,
          affectsLargeWeight,
          eliminatesUnrealisticOption,
        }),
      });
    }
  }

  // Add assumption-based questions
  for (const assumption of assumptions) {
    if (assumption.userValidated) continue; // Skip validated assumptions
    const doubt = 1 - (assumption.confidence ?? 0.5);
    candidates.push({
      id: uid("info"),
      question: t("How confident are you that: {assumption}?", { assumption: assumption.statement }),
      kind: "assumption",
      assumptionId: assumption.id,
      estimatedImpact: 0,
      canChangeResult: true,
      doubt,
      resolvesHardConstraint: false,
      resolvesMajorUncertainty: doubt > 0.5,
      distinguishesLeaders: false,
      affectsLargeWeight: false,
      eliminatesUnrealisticOption: false,
      score: calculateInfoScore({ estimatedImpact: 0, canChangeResult: true, doubt, weight: 0.3, resolvesHardConstraint: false, distinguishesLeaders: false, affectsLargeWeight: false, eliminatesUnrealisticOption: false }),
    });
  }

  // Add risk-based questions
  for (const risk of risks) {
    candidates.push({
      id: uid("info"),
      question: t("What early warning signals would tell you that \"{risk}\" is happening?", { risk: risk.description }),
      kind: "risk",
      riskId: risk.id,
      estimatedImpact: 0,
      canChangeResult: false, // Risks don't change the result directly, but inform monitoring
      doubt: 0.8,
      resolvesHardConstraint: false,
      resolvesMajorUncertainty: true,
      distinguishesLeaders: false,
      affectsLargeWeight: false,
      eliminatesUnrealisticOption: false,
      score: 0.3, // Lower priority for display in results
    });
  }

  // Add explicit missing-information questions (lowest priority)
  for (const question of missing) {
    candidates.push({
      id: uid("info"),
      question,
      kind: "explicit",
      estimatedImpact: 0,
      canChangeResult: true,
      doubt: 1,
      resolvesHardConstraint: false,
      resolvesMajorUncertainty: false,
      distinguishesLeaders: false,
      affectsLargeWeight: false,
      eliminatesUnrealisticOption: false,
      score: 0,
    });
  }

  return candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.resolvesHardConstraint) - Number(a.resolvesHardConstraint) ||
      Number(b.resolvesMajorUncertainty) - Number(a.resolvesMajorUncertainty) ||
      Number(b.distinguishesLeaders) - Number(a.distinguishesLeaders) ||
      Number(b.affectsLargeWeight) - Number(a.affectsLargeWeight) ||
      Number(b.eliminatesUnrealisticOption) - Number(a.eliminatesUnrealisticOption) ||
      Number(b.canChangeResult) - Number(a.canChangeResult) ||
      a.question.localeCompare(b.question)
  );
}

interface ScoreInputs {
  estimatedImpact: number;
  canChangeResult: boolean;
  doubt: number;
  weight: number;
  resolvesHardConstraint: boolean;
  distinguishesLeaders: boolean;
  affectsLargeWeight: boolean;
  eliminatesUnrealisticOption: boolean;
}

function calculateInfoScore(inputs: ScoreInputs): number {
  if (!inputs.canChangeResult) return 0;
  let score = 0;
  // Base score from estimated impact
  score += inputs.estimatedImpact * 0.3;
  // Bonus for high doubt (uncertainty)
  score += inputs.doubt * 0.2;
  // Bonus for high weight
  score += inputs.weight * 0.2;
  // Major bonus for resolving hard constraints
  if (inputs.resolvesHardConstraint) score += 5;
  // Bonus for distinguishing leaders
  if (inputs.distinguishesLeaders) score += 2;
  // Bonus for large weight
  if (inputs.affectsLargeWeight) score += 1;
  // Bonus for eliminating unrealistic options
  if (inputs.eliminatesUnrealisticOption) score += 1;
  return round2(score);
}

function questionForFactor(label: string): string {
  return t("What do you expect for {factor}?", { factor: label.toLowerCase() });
}

/** Only the candidates worth asking, strongest first. */
export function worthAsking(
  candidates: InformationCandidate[],
  limit = 3
): InformationCandidate[] {
  return candidates.filter((c) => c.canChangeResult && c.score > 0).slice(0, limit);
}

/**
 * Missing-information records for persistence: everything the model flags as
 * unresolved, with its real estimated impact attached.
 */
export function identifyUnknowns(
  options: DecisionOption[],
  factors: DecisionFactor[],
  missing: string[] = []
): Unknown[] {
  return rankInformationValue(options, factors, missing).map((c) => ({
    id: c.id,
    question: c.question,
    importance: c.score >= 4 ? "high" : c.score > 0 ? "medium" : "low",
    estimatedImpact: c.estimatedImpact,
    resolved: false,
  }));
}

/**
 * The single best next thing to check, phrased for the result screen.
 * Returns the "you know enough" line when nothing can change the answer.
 */
export function computeInformationValue(
  options: DecisionOption[],
  factors: DecisionFactor[],
  missing: string[] = []
): { topUnknown: string; impact: string } {
  const top = worthAsking(rankInformationValue(options, factors, missing), 1)[0];
  if (!top) {
    return {
      topUnknown: t("You probably know enough to decide."),
      impact: t("Nothing left to check could change which option wins."),
    };
  }
  const impact =
    top.estimatedImpact > 0
      ? t("Worth up to {impact} JEV points — enough to matter.", { impact: top.estimatedImpact })
      : t("Not quantified yet, but currently unestimated.");
  return { topUnknown: top.question, impact };
}

const round2 = (n: number) => Math.round(n * 100) / 100;