// Deterministic policy engine: constraints + scores + context → one verdict.
//
// The four outcomes are first-class results, not warnings attached to a
// confident-looking recommendation:
//   insufficient-information — no estimates entered. Never name a winner.
//   no-viable-option        — every option breaks a hard constraint.
//   tie                     — the top two are within the tie threshold.
//   recommend               — one option leads and nothing objects.
//
// An earlier version returned a recommendation even with zero signal, and
// flagged `needsReview` for every significant decision regardless of the
// numbers. Constraint evaluation lives here rather than in the caller so the
// verdict and the displayed violations can never disagree.
import type {
  Assumption,
  BlockedOption,
  Constraint,
  Criterion,
  DecisionFactor,
  DecisionOption,
  Evidence,
  PolicyVerdict,
  Reason,
  SafetyClass,
  ScoredOption,
  SensitivityResult,
  Stakes,
} from "../types.ts";
import type { ConstraintViolation, RankedOption } from "./constraints.ts";
import {
  applyConstraintPolicy,
  constraintPenalties,
  evaluateConstraints,
  preferenceOrder,
} from "./constraints.ts";
import { t } from "../i18n/index.ts";
import { generateReasons } from "./reasons.ts";
import { TIE_GAP } from "./sensitivity.ts";
import { safetyNotice } from "./safety.ts";

export interface PolicyInput {
  scored: ScoredOption[];
  options: DecisionOption[];
  factors?: DecisionFactor[];
  constraints?: Constraint[];
  sensitivity?: SensitivityResult;
  evidence?: Evidence[];
  assumptions?: Assumption[];
  criteria?: Criterion[];
  safety?: SafetyClass;
  stakes?: Stakes;
  /** False when no factor impact has been estimated. Blocks any verdict. */
  hasSignal?: boolean;
}

/**
 * The leading option as the verdict saw it.
 *
 * `jev` is the option's raw JEV; `score` is what the ranking actually used,
 * after hard constraints removed rivals and soft penalties were subtracted.
 * The UI reports `gap` from here rather than recomputing it from raw JEV, which
 * would ignore penalties and compare against the wrong runner-up.
 */
export interface PolicyLeader {
  optionId: string;
  jev: number;
  score: number;
  /** Adjusted score of the option it beat, or null when none remained. */
  runnerUpScore: number | null;
  /** Adjusted difference to the runner-up, or null when none remained. */
  gap: number | null;
  confidence: number;
}

export interface PolicyResult {
  verdict: PolicyVerdict;
  recommendation: ScoredOption | null;
  leader: PolicyLeader | null;
  /** Final ranking after hard constraints, soft penalties and preference order. */
  ranking: RankedOption[];
  violations: ConstraintViolation[];
  blockedOptions: BlockedOption[];
  /** Constraints that could not be evaluated, and other notices. */
  warnings: string[];
  reasons: Reason[];
  needsReview: boolean;
  /** Every reason review was flagged, not just the first. */
  reviewReasons: string[];
}

/** Confidence below this is too weak to present a pick without a caveat. */
export const REVIEW_CONFIDENCE = 0.6;

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const factors = input.factors ?? [];
  const constraints = input.constraints ?? [];
  const { violations, warnings: constraintWarnings } = evaluateConstraints(
    constraints,
    input.options,
    factors
  );
  const penalties = constraintPenalties(constraints, input.options, factors);

  const ranking = applyConstraintPolicy(
    input.scored.map((s) => ({ optionId: s.optionId, score: s.jev })),
    violations,
    penalties,
    preferenceOrder(constraints)
  );

  const blockedOptions: BlockedOption[] = violations.map((v) => ({
    optionId: v.optionId,
    label: v.optionLabel,
    reason: v.reason,
    constraintId: v.constraint.id,
  }));

  const warnings = constraintWarnings.map((w) => w.reason);
  const notice = input.safety ? safetyNotice(input.safety) : null;
  if (notice) warnings.push(notice);

  const reviewReasons: string[] = [];
  const byId = new Map(input.scored.map((s) => [s.optionId, s]));

  const reasons = (): Reason[] =>
    input.sensitivity
      ? generateReasons({
          scored: input.scored,
          options: input.options,
          sensitivity: input.sensitivity,
          violations,
          warnings: constraintWarnings,
          evidence: input.evidence,
          assumptions: input.assumptions,
          criteria: input.criteria,
          safety: input.safety,
          hasSignal: input.hasSignal,
        })
      : [];

  // 1. Nothing estimated — the honest dead end.
  // 0. Support path. Enforced here rather than left to the screens, so no
  // caller can ever be handed a recommended option for a crisis decision.
  if (input.safety === "crisis" || input.safety === "dangerous") {
    reviewReasons.push(t("This decision is on the support path and must not be modelled."));
    return {
      verdict: "support-path",
      recommendation: null,
      leader: null,
      ranking,
      violations,
      blockedOptions,
      warnings,
      reasons: [],
      needsReview: true,
      reviewReasons,
    };
  }

  // 1. Nothing estimated - the honest dead end.
  if (input.hasSignal === false || input.scored.length === 0) {
    reviewReasons.push(t("No impact estimates, so no option can be preferred."));
    return {
      verdict: "insufficient-information",
      recommendation: null,
      leader: null,
      ranking,
      violations,
      blockedOptions,
      warnings,
      reasons: reasons(),
      needsReview: true,
      reviewReasons,
    };
  }

  // 2. Every option is ruled out.
  if (ranking.length === 0) {
    reviewReasons.push(t("Every option breaks a hard constraint."));
    return {
      verdict: "no-viable-option",
      recommendation: null,
      leader: null,
      ranking,
      violations,
      blockedOptions,
      warnings,
      reasons: reasons(),
      needsReview: true,
      reviewReasons,
    };
  }

  const top = ranking[0];
  const runner = ranking[1];
  // Ranking-consistent numbers. `gap` is null rather than Infinity when only one
  // option survives, so display code never has to invent a comparison.
  const leaderScore = round2(top.score);
  const runnerUpScore = runner ? round2(runner.score) : null;
  const gap = runner ? round2(top.score - runner.score) : null;
  const recommendation = byId.get(top.optionId) ?? null;
  const leader: PolicyLeader = {
    optionId: top.optionId,
    jev: recommendation?.jev ?? leaderScore,
    score: leaderScore,
    runnerUpScore,
    gap,
    confidence: recommendation?.confidence ?? 0,
  };

  // 3. Tie: name the options, pick nothing.
  if (runner && gap !== null && gap <= TIE_GAP) {
    reviewReasons.push(
      t("The top options are within {gap} JEV points, which is not a meaningful difference.", { gap: Math.abs(gap) })
    );
    return {
      verdict: "tie",
      recommendation: null,
      leader: null,
      ranking,
      violations,
      blockedOptions,
      warnings,
      reasons: reasons(),
      needsReview: true,
      reviewReasons,
    };
  }

  // 4. Recommend, attaching every caveat that applies.
  if (recommendation && recommendation.confidence < REVIEW_CONFIDENCE) {
    reviewReasons.push(
      t("Confidence in the leading option is {confidence}%, below the {needed}% needed to treat it as settled.", {
        confidence: Math.round(recommendation.confidence * 100),
        needed: Math.round(REVIEW_CONFIDENCE * 100),
      })
    );
  }
  // The ranking score, not raw JEV: a heavily penalized option can look fine on
  // JEV and still be the worst adjusted choice.
  if (leaderScore <= 0) {
    reviewReasons.push(t("The leading option still has a negative expected impact overall."));
  }
  if (input.safety && input.safety !== "normal") {
    reviewReasons.push(t("This is a high-stakes area — have a qualified professional weigh in."));
  }
  if (input.stakes === "major" || input.stakes === "significant") {
    reviewReasons.push(t("High-impact decisions deserve a deliberate second look."));
  }

  return {
    verdict: "recommend",
    recommendation,
    leader,
    ranking,
    violations,
    blockedOptions,
    warnings,
    reasons: reasons(),
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;