// Deterministic constraint evaluation. Hard constraints override JEV results.
//
// Constraints are evaluated against the *model* (each option's expected impact
// per factor), never against option label text. An earlier version parsed
// budget numbers out of the option label, which silently produced wrong
// verdicts; the units here are explicit instead.
//
// Three shapes are supported, in precedence order:
//   1. exclusion   — `optionIds` lists the options that are ruled out.
//   2. bound       — `subject` + `operator` + `numericValue` compares the
//                    option's expected impact on that factor (-10..+10).
//   3. unresolvable— no structured fields. Reported as a warning. It never
//                    blocks, because inventing a violation is worse than
//                    admitting we cannot check.
import type {
  Constraint,
  ConstraintOperator,
  ConstraintSeverity,
  ConstraintWarning,
  DecisionFactor,
  DecisionOption,
} from "../types.ts";
import { msg, t } from "../i18n/index.ts";
import { normalizeProbabilities, normalizeWeights } from "./expectedValue.ts";

export interface ConstraintViolation {
  constraint: Constraint;
  optionId: string;
  optionLabel: string;
  reason: string;
}

/** Expected impact of one option on one factor, in -10..+10 model units. */
export function impactOn(
  option: DecisionOption,
  factorId: string
): number | null {
  const outs = normalizeProbabilities(option.outcomes);
  if (outs.length === 0) return null;
  let total = 0;
  for (const o of outs) {
    const fv = o.factors.find((f) => f.factorId === factorId);
    total += o.probability * (fv ? fv.value : 0);
  }
  return round2(total);
}

/** Resolve a constraint's `subject` to a factor id by id, then by label. */
function resolveSubject(
  subject: string,
  factors: DecisionFactor[]
): DecisionFactor | null {
  const key = subject.trim().toLowerCase();
  return (
    factors.find((f) => f.id.toLowerCase() === key) ??
    factors.find((f) => f.label.toLowerCase() === key) ??
    null
  );
}

/**
 * An operator ORION does not recognise. `compare` returns false for these,
 * which for a HARD constraint would otherwise read as "every option violates
 * this" and silently remove the whole field, so they are rejected explicitly.
 */
function isKnownOperator(operator: ConstraintOperator): boolean {
  return operator in OPERATOR_TEXT;
}

function compare(value: number, operator: ConstraintOperator, bound: number): boolean {
  switch (operator) {
    case "LT":
      return value < bound;
    case "LTE":
      return value <= bound;
    case "GT":
      return value > bound;
    case "GTE":
      return value >= bound;
    case "EQ":
      return value === bound;
    case "NEQ":
      return value !== bound;
    default:
      return false;
  }
}

const OPERATOR_TEXT: Record<ConstraintOperator, string> = {
  LT: msg("below {n}"),
  LTE: msg("at most {n}"),
  GT: msg("above {n}"),
  GTE: msg("at least {n}"),
  EQ: msg("exactly {n}"),
  NEQ: msg("other than {n}"),
};

/** Resolve an exclusion target: option id first, then exact label match. */
function resolveExcluded(
  option: DecisionOption,
  ids: string[]
): boolean {
  const key = option.label.trim().toLowerCase();
  return ids.some((id) => id === option.id || id.trim().toLowerCase() === key);
}

/**
 * HARD constraints that rule options out. Returns violations plus any
 * constraints that could not be evaluated against the current model.
 */
export function evaluateConstraints(
  constraints: Constraint[],
  options: DecisionOption[],
  factors: DecisionFactor[] = []
): { violations: ConstraintViolation[]; warnings: ConstraintWarning[] } {
  const violations: ConstraintViolation[] = [];
  const warnings: ConstraintWarning[] = [];

  for (const constraint of constraints) {
    if (constraint.type !== "HARD") continue;
    let checked = 0;
    // A specific explanation already given above; don't also report the
    // generic "not checkable" warning for the same broken constraint.
    let explained = false;

    if (constraint.optionIds?.length) {
      checked += 1;
      for (const option of options) {
        if (!resolveExcluded(option, constraint.optionIds)) continue;
        violations.push({
          constraint,
          optionId: option.id,
          optionLabel: option.label,
          reason: t("{option} is ruled out by \"{constraint}\".", { option: option.label, constraint: constraint.name }),
        });
      }
    }

    if (constraint.subject !== undefined && constraint.operator && constraint.numericValue !== undefined) {
      const factor = resolveSubject(constraint.subject, factors);
      if (!factor) {
        explained = true;
        warnings.push({
          constraint,
          reason: t("\"{constraint}\" refers to \"{subject}\", which is not one of this decision's factors, so it could not be checked.", { constraint: constraint.name, subject: constraint.subject }),
        });
      } else if (!isKnownOperator(constraint.operator)) {
        explained = true;
        warnings.push({
          constraint,
          reason: t("\"{constraint}\" uses an operator ORION does not understand, so it could not be enforced. It was ignored rather than guessed at.", { constraint: constraint.name }),
        });
      } else {
        checked += 1;
        for (const option of options) {
          const value = impactOn(option, factor.id);
          if (value === null) continue;
          if (!compare(value, constraint.operator, constraint.numericValue)) continue;
          violations.push({
            constraint,
            optionId: option.id,
            optionLabel: option.label,
            reason: t("{option} scores {value} on {factor} ({constraint} requires {requirement}).", {
              option: option.label,
              value,
              factor: factor.label,
              constraint: constraint.name,
              requirement: t(OPERATOR_TEXT[constraint.operator], { n: constraint.numericValue }),
            }),
          });
        }
      }
    }

    if (checked === 0 && !explained) {
      warnings.push({
        constraint,
        reason: t("\"{constraint}\" has no machine-checkable form (add the options it excludes, or a factor and threshold), so ORION could not enforce it.", { constraint: constraint.name }),
      });
    }
  }

  return { violations, warnings };
}

const SEVERITY_PENALTY: Record<ConstraintSeverity, number> = {
  low: 0.5,
  medium: 1.5,
  high: 3,
  critical: 5,
};

/** Default JEV penalty for a SOFT violation, by severity unless overridden. */
export function softPenalty(constraint: Constraint): number {
  if (constraint.penalty !== undefined && Number.isFinite(constraint.penalty)) {
    return Math.max(0, constraint.penalty);
  }
  return SEVERITY_PENALTY[constraint.severity ?? "medium"];
}

/**
 * SOFT constraints do not block; they subtract from the JEV used for ranking.
 * Keys are option ids.
 */
export function constraintPenalties(
  constraints: Constraint[],
  options: DecisionOption[],
  factors: DecisionFactor[] = []
): Map<string, number> {
  const penalties = new Map<string, number>();
  const push = (id: string, amount: number) => {
    penalties.set(id, round2((penalties.get(id) ?? 0) + amount));
  };

  for (const constraint of constraints) {
    if (constraint.type !== "SOFT") continue;
    const amount = softPenalty(constraint);

    if (constraint.optionIds?.length) {
      for (const option of options) {
        if (resolveExcluded(option, constraint.optionIds)) push(option.id, amount);
      }
      continue;
    }

    if (constraint.subject !== undefined && constraint.operator && constraint.numericValue !== undefined) {
      const factor = resolveSubject(constraint.subject, factors);
      if (!factor) continue;
      if (!isKnownOperator(constraint.operator)) continue;
      for (const option of options) {
        const value = impactOn(option, factor.id);
        // `compare` is true when the constraint is *satisfied*, so a penalty is
        // owed when it is false. Mirrors evaluateConstraints above.
        if (value !== null && !compare(value, constraint.operator, constraint.numericValue)) {
          push(option.id, amount);
        }
      }
    }
  }

  return penalties;
}

/**
 * PREFERENCE constraints only order options that are otherwise tied, so they
 * never change a JEV. Returns the preferred option ids in declaration order.
 */
export function preferenceOrder(constraints: Constraint[]): string[] {
  const order: string[] = [];
  for (const constraint of constraints) {
    if (constraint.type !== "PREFERENCE") continue;
    for (const id of constraint.optionIds ?? []) if (!order.includes(id)) order.push(id);
  }
  return order;
}

export interface RankedOption {
  optionId: string;
  score: number;
}

/**
 * Drop hard-constraint violations, subtract soft penalties, then sort. Ties
 * fall back to PREFERENCE order and then to option id, so the ranking is
 * total and stable across runs.
 */
export function applyConstraintPolicy(
  recommendations: RankedOption[],
  violations: ConstraintViolation[],
  penalties: Map<string, number> = new Map(),
  preferences: string[] = []
): RankedOption[] {
  const blocked = new Set(violations.map((v) => v.optionId));
  const rankOf = (id: string) => {
    const i = preferences.indexOf(id);
    return i === -1 ? preferences.length : i;
  };
  return recommendations
    .filter((r) => !blocked.has(r.optionId))
    .map((r) => ({ optionId: r.optionId, score: round2(r.score - (penalties.get(r.optionId) ?? 0)) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        rankOf(a.optionId) - rankOf(b.optionId) ||
        a.optionId.localeCompare(b.optionId)
    );
}

/** Normalized factor weights, exposed so callers rank consistently with JEV. */
export function constraintFactors(factors: DecisionFactor[]): DecisionFactor[] {
  return normalizeWeights(factors);
}

const round2 = (n: number) => Math.round(n * 100) / 100;