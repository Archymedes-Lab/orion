// Decision confidence calculation (§10).
// Separates confidence in the score from confidence in the decision.
// A decision can have a strong leader but low confidence (weak evidence),
// or a close call but high confidence (excellent evidence).

import type {
  DecisionOption,
  DecisionFactor,
  ScoredOption,
  SensitivityResult,
  Evidence,
  Assumption,
  Constraint,
  Unknown,
  ConfidenceLevel,
} from "../types.ts";
import { t } from "../i18n/index.ts";
import { confidenceCache, makeDecisionKey } from "./cache.ts";

export interface ConfidenceFactors {
  /** Score separation between leader and runner-up (0..1) */
  scoreSeparation: number;
  /** Average evidence quality across all options (0..1) */
  evidenceQuality: number;
  /** Fraction of assumptions that are resolved/validated (0..1) */
  assumptionCertainty: number;
  /** Sensitivity stability (0..1) - 1 = very stable, 0 = fragile */
  sensitivityStability: number;
  /** Fraction of critical unknowns resolved (0..1) */
  unknownResolution: number;
  /** Fraction of hard constraints satisfied (0..1) */
  constraintCertainty: number;
  /** User preference certainty (0..1) */
  preferenceCertainty: number;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  score: number;
  factors: ConfidenceFactors;
  reasons: string[];
}

/** Calculate decision confidence from multiple factors. */
export function calculateDecisionConfidence(
  options: DecisionOption[],
  factors: DecisionFactor[],
  scored: ScoredOption[],
  sens: SensitivityResult,
  evidence: Evidence[] = [],
  assumptions: Assumption[] = [],
  constraints: Constraint[] = [],
  unknowns: Unknown[] = [],
  criteria: Array<{ weight: number }> = []
): ConfidenceResult {
  const reasons: string[] = [];

  // 1. Score separation (how clear is the winner)
  const scoreSeparation = calculateScoreSeparation(scored);
  if (scoreSeparation > 0.7) reasons.push(t("Clear score separation between options"));
  else if (scoreSeparation > 0.3) reasons.push(t("Moderate score separation"));
  else reasons.push(t("Options are very close in score"));

  // 2. Evidence quality
  const evidenceQuality = calculateEvidenceQuality(evidence);
  if (evidenceQuality > 0.7) reasons.push(t("Strong evidence base"));
  else if (evidenceQuality > 0.4) reasons.push(t("Moderate evidence quality"));
  else reasons.push(t("Limited or weak evidence"));

  // 3. Assumption certainty
  const assumptionCertainty = calculateAssumptionCertainty(assumptions);
  if (assumptionCertainty < 0.5) reasons.push(t("Many unresolved assumptions"));
  else if (assumptionCertainty < 0.8) reasons.push(t("Some assumptions unvalidated"));

  // 4. Sensitivity stability
  const sensitivityStability = sens.stable ? 1 : (sens.gap !== undefined && sens.gap > 0 ? Math.min(1, sens.gap / 2) : 0.3);
  if (!sens.stable) reasons.push(t("Result is sensitive to assumption changes"));
  else reasons.push(t("Result is stable across scenarios"));

  // 5. Unknown resolution
  const unknownResolution = calculateUnknownResolution(unknowns);
  if (unknownResolution < 0.5) reasons.push(t("Critical unknowns remain unresolved"));
  else if (unknownResolution < 0.8) reasons.push(t("Some unknowns unresolved"));

  // 6. Constraint certainty
  const constraintCertainty = calculateConstraintCertainty(constraints);
  if (constraintCertainty < 1) reasons.push(t("Hard constraints may not be fully satisfied"));

  // 7. Preference certainty (from criteria weights)
  const preferenceCertainty = calculatePreferenceCertainty(criteria);
  if (preferenceCertainty < 0.6) reasons.push(t("Preference weights are uncertain"));

  // Weighted combination
  const weights = {
    scoreSeparation: 0.25,
    evidenceQuality: 0.20,
    assumptionCertainty: 0.15,
    sensitivityStability: 0.15,
    unknownResolution: 0.10,
    constraintCertainty: 0.10,
    preferenceCertainty: 0.05,
  };

  const rawScore =
    scoreSeparation * weights.scoreSeparation +
    evidenceQuality * weights.evidenceQuality +
    assumptionCertainty * weights.assumptionCertainty +
    sensitivityStability * weights.sensitivityStability +
    unknownResolution * weights.unknownResolution +
    constraintCertainty * weights.constraintCertainty +
    preferenceCertainty * weights.preferenceCertainty;

  const level: ConfidenceLevel = rawScore >= 0.75 ? "high" : rawScore >= 0.5 ? "moderate" : "low";

  const confidenceFactors: ConfidenceFactors = {
    scoreSeparation: round2(scoreSeparation),
    evidenceQuality: round2(evidenceQuality),
    assumptionCertainty: round2(assumptionCertainty),
    sensitivityStability: round2(sensitivityStability),
    unknownResolution: round2(unknownResolution),
    constraintCertainty: round2(constraintCertainty),
    preferenceCertainty: round2(preferenceCertainty),
  };

  return { level, score: round2(rawScore), factors: confidenceFactors, reasons };
}

function calculateScoreSeparation(scored: ScoredOption[]): number {
  if (scored.length < 2) return 0;
  const sorted = [...scored].sort((a, b) => b.jev - a.jev);
  const gap = sorted[0].jev - sorted[1].jev;
  // Normalize: gap of 5+ = 1.0, gap of 0 = 0
  return Math.min(1, Math.max(0, gap / 5));
}

function calculateEvidenceQuality(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0.3; // Default low when no evidence

  // Average reliability * relevance across all evidence
  const total = evidence.reduce((sum, e) => sum + (e.reliability ?? 0.5) * (e.relevance ?? 0.5), 0);
  const avg = total / evidence.length;

  // Bonus for having more evidence
  const coverageBonus = Math.min(0.2, evidence.length * 0.05);

  return Math.min(1, avg + coverageBonus);
}

function calculateAssumptionCertainty(assumptions: Assumption[]): number {
  if (assumptions.length === 0) return 1; // No assumptions = full certainty

  const validated = assumptions.filter(a => a.userValidated === true).length;
  const highConf = assumptions.filter(a => (a.confidence ?? 0) >= 0.7).length;
  return (validated * 1 + (highConf - validated) * 0.7 + (assumptions.length - highConf) * 0.3) / assumptions.length;
}

function calculateUnknownResolution(unknowns: Unknown[]): number {
  if (unknowns.length === 0) return 1;
  const resolved = unknowns.filter(u => u.resolved).length;
  const highImportance = unknowns.filter(u => u.importance === "high").length;
  const highImportanceResolved = unknowns.filter(u => u.importance === "high" && u.resolved).length;

  // Weight high-importance unknowns more heavily
  if (highImportance > 0) {
    return highImportanceResolved / highImportance;
  }
  return resolved / unknowns.length;
}

function calculateConstraintCertainty(constraints: Constraint[]): number {
  const hardConstraints = constraints.filter(c => c.type === "HARD");
  if (hardConstraints.length === 0) return 1;

  // Check if any option violates hard constraints
  // This is simplified - in practice would use the constraint evaluation engine
  return 1; // Placeholder - assumes constraints are satisfied
}

function calculatePreferenceCertainty(criteria: Array<{ weight: number }>): number {
  if (criteria.length === 0) return 0.5;
  // Higher certainty when weights are more decisive (less uniform)
  const weights = criteria.map(c => c.weight);
  const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
  const variance = weights.reduce((sum, w) => sum + (w - avg) ** 2, 0) / weights.length;
  // Higher variance = more decisive preferences = higher certainty
  return Math.min(1, 0.5 + variance * 4);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cached wrapper for calculateDecisionConfidence */
export function calculateDecisionConfidenceCached(
  options: DecisionOption[],
  factors: DecisionFactor[],
  scored: ScoredOption[],
  sens: SensitivityResult,
  evidence: Evidence[] = [],
  assumptions: Assumption[] = [],
  constraints: Constraint[] = [],
  unknowns: Unknown[] = [],
  criteria: Array<{ weight: number }> = [],
  stakes: string = "normal",
  mode: string = "serious"
): ReturnType<typeof calculateDecisionConfidence> {
  const key = makeDecisionKey(options, factors, stakes, mode) + ":confidence:" + 
    evidence.map(e => e.id).sort().join(",") + ":" +
    assumptions.map(a => a.id).sort().join(",") + ":" +
    constraints.map(c => c.id).sort().join(",") + ":" +
    unknowns.map(u => u.id).sort().join(",") + ":" +
    criteria.map(c => c.weight).sort().join(",");
  const cached = confidenceCache.get([key]);
  if (cached !== undefined) return cached;
  
  const result = calculateDecisionConfidence(options, factors, scored, sens, evidence, assumptions, constraints, unknowns, criteria);
  confidenceCache.set([key], result);
  return result;
}