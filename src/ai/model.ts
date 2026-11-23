// Pure model builders: extraction + Scores → engine inputs.
// No network, no React. Everything here is unit-tested.
//
// Honesty rule: without real Scores there is NO signal. The offline path
// builds neutral outcomes (value 0, low confidence) so the UI shows a tie
// with wide bands instead of fabricated numbers.
import { clamp01, clamp10, uid } from "../decision-engine/normalize.ts";
import type {
  Assumption,
  Criterion,
  DecisionFactor,
  Pace,
  DecisionOption,
  Evidence,
  ScenarioScore,
} from "../types.ts";
import type { FactorScore } from "./client.ts";

/** importance 0..1 → normalized weights summing to 1. */
export function weightsFromImportance(
  factors: { id: string; label: string; importance: number; pace?: Pace }[]
): DecisionFactor[] {
  const total = factors.reduce((a, f) => a + Math.max(0, f.importance), 0) || 1;
  return factors.map((f) => ({
    id: f.id,
    label: f.label,
    weight: Math.max(0, f.importance) / total,
    ...(f.pace ? { pace: f.pace } : {}),
  }));
}

export interface BuildExtras {
  /**
   * Weighted ways each option can play out. When supplied for every option the
   * engine gets real outcome structure, which is what makes scenarios,
   * sensitivity and uncertainty bands meaningful. Absent → one honest expected
   * outcome per option, exactly as before.
   */
  scenarios?: ScenarioScore[] | null;
  /** Per-option reversibility 0..1 (§8). Defaults to 0.6. */
  reversibility?: Record<string, number>;
}

/**
 * One honest outcome per option: "choose X, expected impact".
 * Score → -10..+10 value; mean Score confidence → probabilityConfidence (§7).
 * Uncertainty bands (not invented good/bad splits) carry the doubt.
 *
 * With `scenarios` the option instead gets one outcome per scenario, each with
 * its own probability and confidence. A factor a scenario does not mention
 * stays 0 rather than inheriting the flat estimate — mixing an expectation into
 * a specific branch is how fabricated numbers get in.
 */
export function buildOptionsFromScores(
  options: { id: string; label: string }[],
  factors: DecisionFactor[],
  scores: FactorScore[] | null,
  extras: BuildExtras = {}
): DecisionOption[] {
  const scenarioSet = extras.scenarios
    ? scenariosByOption(options, factors, extras.scenarios)
    : null;
  return options.map((o) => {
    const mine = (scores ?? []).filter((s) => s.optionId === o.id);
    const byFactor = new Map(mine.map((s) => [s.factorId, s]));
    const conf =
      mine.length > 0
        ? mine.reduce((a, s) => a + clamp01(s.probabilityConfidence), 0) / mine.length
        : 0.15;
    const reversibility = clamp01(extras.reversibility?.[o.id] ?? 0.6);
    // Scenarios are used only if the whole set is usable; otherwise the option
    // falls back to its single expected outcome.
    const branches = (scenarioSet ?? []).filter((s) => s.optionId === o.id);

    if (branches.length > 0) {
      const total = branches.reduce((a, s) => a + Math.max(0, s.probability), 0);
      const scale = total > 0 ? total : 1;
      return {
        id: o.id,
        label: o.label,
        reversibility,
        outcomes: branches.map((s) => ({
          id: uid("out"),
          label: s.label,
          probability: Math.max(0, s.probability) / scale,
          probabilityConfidence: Math.round(clamp01(s.probabilityConfidence) * 100) / 100,
          factors: factors.map((f) => ({
            factorId: f.id,
            value: clamp10(s.values[f.id] ?? 0),
          })),
        })),
      };
    }

    return {
      id: o.id,
      label: o.label,
      reversibility,
      outcomes: [
        {
          id: uid("out"),
          label: `Choose ${o.label}`,
          probability: 1,
          probabilityConfidence: Math.round(clamp01(conf) * 100) / 100,
          factors: factors.map((f) => ({
            factorId: f.id,
            value: byFactor.has(f.id)
              ? clamp10(byFactor.get(f.id)!.value)
              : 0,
          })),
        },
      ],
    };
  });
}

/** True when every option carries real outcome structure worth testing. */
export function hasOutcomeStructure(options: DecisionOption[]): boolean {
  return options.length > 0 && options.every((o) => o.outcomes.length > 1);
}

/**
 * Flat ScenarioScore input → the scenario set to model with, or null.
 *
 * The rules are all-or-nothing, and null means "no scenarios at all":
 *   - every option must have at least one branch, because a model that gives
 *     one option an uncertainty range and another a bare expectation cannot be
 *     compared honestly;
 *   - every branch must name only known factors and stay in range. Clamping an
 *     out-of-range value would quietly invent a plausible number.
 */
export function scenariosByOption(
  options: { id: string }[],
  factors: DecisionFactor[],
  scenarios: ScenarioScore[]
): ScenarioScore[] | null {
  if (scenarios.length === 0 || options.length === 0 || factors.length === 0) return null;

  const optionIds = new Set(options.map((o) => o.id));
  const factorIds = new Set(factors.map((f) => f.id));
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  const unit = (n: unknown) => finite(n) && (n as number) >= 0 && (n as number) <= 1;

  for (const s of scenarios) {
    if (!optionIds.has(s.optionId)) return null;
    if (typeof s.label !== "string" || s.label.trim() === "") return null;
    if (!finite(s.probability) || s.probability < 0) return null;
    if (!unit(s.probabilityConfidence)) return null;
    const keys = Object.keys(s.values ?? {});
    if (keys.length === 0) return null;
    for (const k of keys) {
      if (!factorIds.has(k)) return null;
      if (!finite(s.values[k]) || s.values[k] < -10 || s.values[k] > 10) return null;
    }
  }

  return options.every((o) => scenarios.some((s) => s.optionId === o.id))
    ? scenarios
    : null;
}

// --- Criteria (§ direction-aware weighing) ---------------------------------

export interface CriteriaApplication {
  options: DecisionOption[];
  factors: DecisionFactor[];
  /** Criteria that matched no factor, so the user knows they had no effect. */
  unmatched: string[];
}

/**
 * Fold user-declared criteria into the model:
 *   MAXIMIZE — value as estimated (the default).
 *   MINIMIZE — the factor's impact is negated, so "lower is better" and a
 *              high JEV keeps meaning "better outcome".
 *   NEUTRAL  — weight 0, so the factor is recorded but cannot move the result.
 *
 * Criteria match factors by label (case-insensitive). This only rewrites the
 * options handed to the engine; the stored estimates stay as the user entered
 * them.
 */
export function applyCriteria(
  options: DecisionOption[],
  criteria: Criterion[],
  factors: DecisionFactor[]
): CriteriaApplication {
  const unmatched: string[] = [];
  const negate = new Set<string>();
  const zero = new Set<string>();

  for (const c of criteria) {
    const key = c.name.trim().toLowerCase();
    const factor = factors.find((f) => f.label.trim().toLowerCase() === key || f.id === key);
    if (!factor) {
      unmatched.push(c.name);
      continue;
    }
    if (c.direction === "MINIMIZE") negate.add(factor.id);
    if (c.direction === "NEUTRAL") zero.add(factor.id);
  }

  const adjustedFactors: DecisionFactor[] =
    zero.size === 0
      ? factors
      : factors.map((f) => (zero.has(f.id) ? { ...f, weight: 0 } : f));

  if (negate.size === 0 && zero.size === 0) {
    return { options, factors: adjustedFactors, unmatched };
  }

  const adjustedOptions: DecisionOption[] = options.map((o) => ({
    ...o,
    outcomes: o.outcomes.map((oc) => ({
      ...oc,
      factors: oc.factors.map((fv) =>
        negate.has(fv.factorId) ? { ...fv, value: -fv.value } : fv
      ),
    })),
  }));

  return { options: adjustedOptions, factors: adjustedFactors, unmatched };
}

// --- Evidence (§ confidence calibration) -----------------------------------

export interface EvidenceApplication {
  options: DecisionOption[];
  /** Mean reliability × relevance across attached evidence. */
  support: number;
  /** Plain-language account of what the evidence did to confidence. */
  note: string;
  /** Criteria/assumptions that referenced evidence we could not find. */
  unmatched: string[];
}

/** How much a piece of evidence can raise confidence at most. */
export const MAX_EVIDENCE_LIFT = 0.5;
/** Confidence lost per unverified assumption. */
export const ASSUMPTION_DISCOUNT = 0.15;

/**
 * Let supporting evidence raise, and unverified assumptions lower, the
 * confidence attached to each outcome — never the other way round. Confidence
 * widens the uncertainty band, so this is the honest direction: better
 * evidence narrows it, more guesswork widens it. The JEV itself is untouched;
 * evidence changes how much we trust the ranking, not the ranking.
 */
export function applyEvidenceConfidence(
  options: DecisionOption[],
  evidence: Evidence[],
  assumptions: Assumption[] = []
): EvidenceApplication {
  const items = evidence.filter((e) => e.type !== "ASSUMPTION");
  const support =
    items.length === 0
      ? 0
      : items.reduce((a, e) => a + clamp01(e.reliability ?? 0.8) * clamp01(e.relevance ?? 0.8), 0) /
        items.length;

  const assumptionDiscount = Math.min(0.6, assumptions.length * ASSUMPTION_DISCOUNT);

  const adjusted: DecisionOption[] = options.map((o) => ({
    ...o,
    outcomes: o.outcomes.map((oc) => {
      const base = clamp01(oc.probabilityConfidence);
      const lifted =
        support > 0
          ? base + (1 - base) * Math.min(1, support) * MAX_EVIDENCE_LIFT
          : base;
      const discounted = lifted * (1 - assumptionDiscount);
      return { ...oc, probabilityConfidence: round2(clamp01(discounted)) };
    }),
  }));

  const weak = items.filter((e) => clamp01(e.reliability ?? 0.8) * clamp01(e.relevance ?? 0.8) < 0.5);
  const parts: string[] = [];
  if (items.length === 0) parts.push("No evidence attached, so confidence is unchanged");
  else if (weak.length > 0) parts.push(`${weak.length} of ${items.length} evidence items are low quality`);
  else parts.push(`${items.length} supporting evidence item(s) raise confidence`);
  if (assumptions.length > 0) {
    parts.push(`${assumptions.length} unverified assumption(s) widen the range`);
  }

  return { options: adjusted, support: round2(support), note: parts.join("; "), unmatched: [] };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * An answer means "this factor matters most": boost its weight and
 * renormalize. factorId null ("they're equal") leaves weights unchanged.
 */
export function applyAnswerToWeights(
  factors: DecisionFactor[],
  factorId: string | null,
  boost = 2
): DecisionFactor[] {
  if (!factorId) return factors;
  if (!factors.some((f) => f.id === factorId)) return factors;
  const boosted = factors.map((f) =>
    f.id === factorId ? { ...f, weight: f.weight * boost } : f
  );
  const total = boosted.reduce((a, f) => a + f.weight, 0) || 1;
  return boosted.map((f) => ({ ...f, weight: Math.round((f.weight / total) * 1000) / 1000 }));
}

/** True when no scored signal exists (all values 0) — UI should say so. */
export function hasSignal(options: DecisionOption[]): boolean {
  return options.some((o) =>
    o.outcomes.some((oc) => oc.factors.some((fv) => fv.value !== 0))
  );
}

/**
 * Learned priors (§16): labels the user has picked as "matters most" get a
 * gentle boost before normalization — share-proportional, capped, so a long
 * history informs without dictating. priors maps lowercase label → count.
 */
export function applyLearnedPriors(
  factors: DecisionFactor[],
  priors: Record<string, number>
): DecisionFactor[] {
  const total = Object.values(priors).reduce((a, n) => a + Math.max(0, n), 0);
  if (total <= 0) return factors;
  const boosted = factors.map((f) => {
    const share = Math.max(0, priors[f.label.toLowerCase()] ?? 0) / total;
    return { ...f, weight: f.weight * (1 + Math.min(1, share) * 0.5) };
  });
  const sum = boosted.reduce((a, f) => a + f.weight, 0) || 1;
  return boosted.map((f) => ({ ...f, weight: Math.round((f.weight / sum) * 1000) / 1000 }));
}
