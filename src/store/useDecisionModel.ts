// One shared decision model for the whole app.
//
// Decide and Analysis used to score the raw session options independently, so
// adding a criterion or a limit on one screen quietly contradicted the other,
// and a blocked option stayed choosable on the main screen. This hook is the
// single place the model is assembled:
//
//   session options
//     → criteria (direction of "better")   applyCriteria
//     → evidence and assumptions            applyEvidenceConfidence
//     → scoring, sensitivity, policy verdict
//
// Order matters: criteria change what a factor value means, so evidence has to
// be applied to the already-reinterpreted options. Nothing here writes to the
// session or the database — it is derived state, recomputed on every render.
import { useEffect, useMemo, useRef } from "react";
import { applyCriteria, applyEvidenceConfidence, hasOutcomeStructure } from "../ai/model";
import { scoreAll } from "../decision-engine/uncertainty";
import { runScenarios, scenariosAreInert } from "../decision-engine/scenarios";
import { sensitivity } from "../decision-engine/sensitivity";
import { evaluatePolicy } from "../decision-engine/policy";
import { identifyUnknowns } from "../decision-engine/informationValue";
import { useDecisionStore } from "./decisionStore";
import type {
  Assumption,
  Constraint,
  Criterion,
  DecisionFactor,
  DecisionOption,
  Evidence,
  SafetyClass,
  Stakes,
  Unknown,
} from "../types";

export interface SharedDecisionModel {
  /** Options after criteria and evidence were applied. */
  options: DecisionOption[];
  factors: DecisionFactor[];
  scored: ReturnType<typeof scoreAll>;
  /** Ranking after constraints, penalties and preference order. */
  policy: ReturnType<typeof evaluatePolicy>;
  scenarios: ReturnType<typeof runScenarios>;
  sensitivity: ReturnType<typeof sensitivity>;
  /** False when every option has a single outcome, so robustness adds nothing. */
  outcomesVary: boolean;
  /**
   * What the model says is still unresolved, with its real estimated impact.
   * Persisted to `unknowns` so a review can be resolved later, rather than
   * recomputed and forgotten.
   */
  unknowns: ReturnType<typeof identifyUnknowns>;
  /** Criteria that matched no factor, so the user knows they had no effect. */
  unmatchedCriteria: string[];
  /** Criteria that changed the model. */
  activeCriteria: number;
  /** Whether constraints, criteria or evidence changed anything at all. */
  adjusted: boolean;
  /** True when the session is on the support path and must not be scored. */
  supportPath: boolean;
  /** Whether the session has enough estimates to say anything. */
  hasSignal: boolean;
  evidenceNote: string;
}

export interface SharedModelInput {
  options: DecisionOption[];
  factors: DecisionFactor[];
  constraints?: Constraint[];
  criteria?: Criterion[];
  evidence?: Evidence[];
  assumptions?: Assumption[];
  safety?: SafetyClass;
  stakes?: Stakes;
  scoringSource?: "none" | "manual" | "api";
  /** Needed to persist unknowns; omit to skip persistence entirely. */
  decisionId?: string | null;
}

/**
 * Pure assembly of the shared model. Exported separately from the hook so it
 * can be tested without React.
 */
export function buildDecisionModel(input: SharedModelInput): SharedDecisionModel | null {
  const {
    options,
    factors,
    constraints = [],
    criteria = [],
    evidence = [],
    assumptions = [],
    safety = "normal",
    stakes,
    scoringSource = "none",
  } = input;

  if (options.length === 0) return null;

  // Crisis and dangerous never get scored. JEV theater on a support path is
  // exactly what the safety rules are meant to prevent.
  const supportPath = safety === "crisis" || safety === "dangerous";

  const withCriteria = applyCriteria(options, criteria, factors);
  const withEvidence = applyEvidenceConfidence(
    withCriteria.options,
    evidence,
    assumptions
  );
  const finalOptions = withEvidence.options;

  const scored = scoreAll(finalOptions, withCriteria.factors);
  const sens = sensitivity(finalOptions, withCriteria.factors);
  const policy = evaluatePolicy({
    scored,
    options: finalOptions,
    factors: withCriteria.factors,
    constraints,
    sensitivity: sens,
    evidence,
    assumptions,
    criteria,
    safety,
    stakes,
    hasSignal: scoringSource !== "none",
  });

  const hasSignal = scoringSource !== "none";
  const unmatched = withEvidence.unmatched ?? withCriteria.unmatched;
  // A criterion that matched nothing is recorded but inert; saying so is better
  // than letting the user believe it shifted the result.
  const activeCriteria = Math.max(0, criteria.length - unmatched.length);

  return {
    options: finalOptions,
    factors: withCriteria.factors,
    scored,
    policy,
    scenarios: runScenarios(finalOptions, withCriteria.factors),
    sensitivity: sens,
    outcomesVary: hasOutcomeStructure(finalOptions) && !scenariosAreInert(finalOptions),
    unknowns: identifyUnknowns(finalOptions, withCriteria.factors),
    unmatchedCriteria: unmatched,
    activeCriteria,
    adjusted:
      criteria.length > 0 ||
      evidence.length > 0 ||
      assumptions.length > 0 ||
      constraints.length > 0,
    supportPath,
    hasSignal,
    evidenceNote: withEvidence.note,
  };
}

/**
 * Records the model's open questions in `unknowns` so they survive a restart
 * and can be resolved later. Only genuinely open ones are written, and never
 * more than once per decision: the model is derived, so this must not turn into
 * a row written on every render.
 */
function usePersistUnknowns(
  decisionId: string | null,
  unknowns: Unknown[],
  enabled: boolean
): void {
  const persisted = useRef(false);
  useEffect(() => {
    persisted.current = false;
  }, [decisionId]);

  useEffect(() => {
    if (!enabled || !decisionId || persisted.current) return;
    if (unknowns.length === 0) return;
    persisted.current = true;
    void useDecisionStore.getState().recordUnknowns(decisionId, unknowns);
  }, [enabled, decisionId, unknowns]);
}

/** Memoized model for the current session plus the user's stored extras. */
export function useDecisionModel(input: SharedModelInput): SharedDecisionModel | null {
  const { options, factors, constraints, criteria, evidence, assumptions, safety, stakes, scoringSource } = input;
  const model = useMemo(
    () =>
      buildDecisionModel({
        options,
        factors,
        constraints,
        criteria,
        evidence,
        assumptions,
        safety,
        stakes,
        scoringSource,
      }),
    [options, factors, constraints, criteria, evidence, assumptions, safety, stakes, scoringSource]
  );

  usePersistUnknowns(
    input.decisionId ?? null,
    model?.unknowns ?? [],
    !model?.supportPath && model?.hasSignal === true
  );

  return model;
}