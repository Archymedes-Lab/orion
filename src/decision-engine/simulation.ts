// What-if simulation: score a modified copy of the model and report whether the
// answer changes. Never mutates the inputs — callers can simulate repeatedly
// from the same baseline, and an accidental mutation cannot corrupt a saved
// decision.
import type { DecisionFactor, DecisionOption, ScoredOption, SensitivityResult } from "../types.ts";
import { t } from "../i18n/index.ts";
import { scoreAll } from "./uncertainty.ts";
import { sensitivity } from "./sensitivity.ts";
import { runScenarios } from "./scenarios.ts";
import { clamp10 } from "./normalize.ts";
import { clamp01 } from "./normalize.ts";

export type SimulationChangeType =
  | "factor-weight"
  | "outcome-value"
  | "outcome-probability"
  | "outcome-confidence"
  | "reversibility";

export interface SimulationChange {
  type: SimulationChangeType;
  /** Human label for the thing being changed, used in the explanation. */
  target: string;
  /** New value, in the units of the field being changed. */
  value: number;
  optionId?: string;
  factorId?: string;
  /** Which outcome, for outcome-scoped changes. Defaults to all of them. */
  outcomeId?: string;
}

export interface SimulationDelta {
  optionId: string;
  label: string;
  before: number;
  after: number;
  delta: number;
}

export interface SimulationResult {
  originalLeaderId: string;
  simulatedLeaderId: string;
  changed: boolean;
  /** Rank positions that moved, if any. */
  rankingChanged: boolean;
  deltas: SimulationDelta[];
  scored: ScoredOption[];
  originalScored: ScoredOption[];
  stabilityBefore: "high" | "medium" | "low";
  stabilityAfter: "high" | "medium" | "low";
  /** Exact thresholds recomputed under the simulated model. */
  sensitivity: SensitivityResult;
  applied: number;
  /** Changes that named something the model does not contain. */
  skipped: string[];
  explanation: string;
}

/** Deep-enough copy: every leaf the simulator can touch is duplicated. */
function clone(options: DecisionOption[], factors: DecisionFactor[]): {
  options: DecisionOption[];
  factors: DecisionFactor[];
} {
  return {
    factors: factors.map((f) => ({ ...f })),
    options: options.map((o) => ({
      ...o,
      outcomes: o.outcomes.map((oc) => ({
        ...oc,
        factors: oc.factors.map((fv) => ({ ...fv })),
      })),
    })),
  };
}

export function simulate(
  options: DecisionOption[],
  factors: DecisionFactor[],
  changes: SimulationChange[]
): SimulationResult {
  const { options: working, factors: workingFactors } = clone(options, factors);
  const skipped: string[] = [];
  let applied = 0;

  for (const change of changes) {
    switch (change.type) {
      case "factor-weight": {
        const factor = workingFactors.find(
          (f) => f.id === change.factorId || f.label === change.target
        );
        if (!factor) {
          skipped.push(t("no factor matching \"{target}\"", { target: String(change.target) }));
          break;
        }
        factor.weight = clamp01(change.value);
        applied += 1;
        break;
      }
      case "reversibility": {
        const option = working.find((o) => o.id === change.optionId);
        if (!option) {
          skipped.push(t("no option \"{target}\"", { target: String(change.target) }));
          break;
        }
        option.reversibility = clamp01(change.value);
        applied += 1;
        break;
      }
      case "outcome-value":
      case "outcome-probability":
      case "outcome-confidence": {
        const option = working.find((o) => o.id === change.optionId);
        if (!option) {
          skipped.push(t("no option \"{target}\"", { target: String(change.target) }));
          break;
        }
        if (!change.factorId) {
          skipped.push(t("\"{target}\" needs a factor to change", { target: String(change.target) }));
          break;
        }
        const targets = option.outcomes.filter(
          (o) => !change.outcomeId || o.id === change.outcomeId
        );
        let touched = 0;
        for (const oc of targets) {
          const fv = oc.factors.find((x) => x.factorId === change.factorId);
          if (!fv) continue;
          if (change.type === "outcome-value") fv.value = clamp10(change.value);
          if (change.type === "outcome-confidence") oc.probabilityConfidence = clamp01(change.value);
          touched += 1;
        }
        if (touched === 0) {
          skipped.push(t("\"{option}\" has no estimate for that factor", { option: option.label }));
          break;
        }
        if (change.type === "outcome-probability") {
          // Set as a share of the option's outcomes. Siblings keep their raw
          // values and `normalizeProbabilities` redistributes the remainder,
          // so this means "make this one likelier" rather than inventing mass.
          for (const oc of targets) oc.probability = clamp01(change.value);
        }
        applied += 1;
        break;
      }
      default:
        skipped.push(t("unknown change type \"{type}\"", { type: String(change.type) }));
    }
  }

  const originalScored = sortByJev(scoreAll(options, factors));
  const scored = sortByJev(scoreAll(working, workingFactors));

  const originalLeaderId = originalScored[0]?.optionId ?? "";
  const simulatedLeaderId = scored[0]?.optionId ?? "";
  const changed = originalLeaderId !== simulatedLeaderId;
  const rankingChanged =
    originalScored.map((s) => s.optionId).join(",") !== scored.map((s) => s.optionId).join(",");

  const deltas: SimulationDelta[] = scored.map((after) => {
    const before = originalScored.find((s) => s.optionId === after.optionId)?.jev ?? 0;
    return {
      optionId: after.optionId,
      label: working.find((o) => o.id === after.optionId)?.label ?? after.optionId,
      before,
      after: after.jev,
      delta: round2(after.jev - before),
    };
  });

  const stabilityBefore = runScenarios(options, factors).stability;
  const stabilityAfter = runScenarios(working, workingFactors).stability;

  return {
    originalLeaderId,
    simulatedLeaderId,
    changed,
    rankingChanged,
    deltas,
    scored,
    originalScored,
    stabilityBefore,
    stabilityAfter,
    sensitivity: sensitivity(working, workingFactors),
    applied,
    skipped,
    explanation: explainSimulation(originalLeaderId, simulatedLeaderId, deltas, working, applied),
  };
}

function sortByJev(rows: ScoredOption[]): ScoredOption[] {
  return [...rows].sort((a, b) => b.jev - a.jev);
}

function explainSimulation(
  originalLeaderId: string,
  simulatedLeaderId: string,
  deltas: SimulationDelta[],
  options: DecisionOption[],
  applied: number
): string {
  if (applied === 0) return t("No changes were applied, so nothing could change.");
  const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;

  if (originalLeaderId !== simulatedLeaderId) {
    const biggest = [...deltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    return t("{next} would overtake {leader}. Largest move: {move}.", {
      next: label(simulatedLeaderId),
      leader: label(originalLeaderId),
      move: `${biggest.label} ${biggest.delta > 0 ? "+" : ""}${biggest.delta}`,
    });
  }

  const moved = deltas.filter((d) => Math.abs(d.delta) >= 0.01);
  if (moved.length === 0) return t("These changes do not alter any option's score.");
  const still = label(originalLeaderId);
  const moves = moved
    .slice(0, 2)
    .map((d) => `${d.label} ${d.delta > 0 ? "+" : ""}${d.delta}`)
    .join(", ");
  return t("{leader} still leads. {moves}.", { leader: still, moves });
}

const round2 = (n: number) => Math.round(n * 100) / 100;