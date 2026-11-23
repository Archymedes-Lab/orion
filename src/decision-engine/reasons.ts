// Structured reasons for a result. Every string here is derived from the model
// and the labels it was given; nothing invents a rationale the math does not
// support, and the "why" always names the option it refers to.
import type {
  Assumption,
  ConstraintWarning,
  Criterion,
  DecisionOption,
  Evidence,
  Reason,
  SafetyClass,
  ScoredOption,
  SensitivityResult,
} from "../types.ts";
import type { ConstraintViolation } from "./constraints.ts";
import { t } from "../i18n/index.ts";
import { safetyNotice } from "./safety.ts";
import { TIE_GAP } from "./sensitivity.ts";

export interface ReasonInput {
  scored: ScoredOption[];
  options: DecisionOption[];
  sensitivity: SensitivityResult;
  violations?: ConstraintViolation[];
  warnings?: ConstraintWarning[];
  evidence?: Evidence[];
  assumptions?: Assumption[];
  criteria?: Criterion[];
  safety?: SafetyClass;
  /** False when the model has no estimates at all — never claim a winner then. */
  hasSignal?: boolean;
}

export function generateReasons(input: ReasonInput): Reason[] {
  const reasons: Reason[] = [];
  const ranked = [...input.scored].sort((a, b) => b.jev - a.jev);
  const leader = ranked[0];
  const runner = ranked[1];
  const leaderLabel = leader ? labelOf(input.options, leader.optionId) : "";
  const runnerLabel = runner ? labelOf(input.options, runner.optionId) : "";

  // 1. No signal: say so and stop. This is the honesty rule.
  if (input.hasSignal === false) {
    return [
      {
        type: "INFORMATION",
        text: t("No impact estimates have been entered, so there is nothing to compare yet."),
      },
    ];
  }

  // 2. The comparison itself.
  if (leader && runner) {
    const gap = round2(leader.jev - runner.jev);
    if (gap <= TIE_GAP) {
      reasons.push({
        type: "CRITERION",
        text: t("{leader} and {runner} are tied within {gap} JEV — no meaningful leader.", { leader: leaderLabel, runner: runnerLabel, gap: Math.abs(gap) }),
        ref: leader.optionId,
      });
    } else if (gap > 2) {
      reasons.push({
        type: "CRITERION",
        text: t("{leader} leads {runner} by {gap} JEV points on your current estimates.", { leader: leaderLabel, runner: runnerLabel, gap }),
        ref: leader.optionId,
      });
    } else {
      reasons.push({
        type: "CRITERION",
        text: t("{leader} is ahead of {runner}, but only by {gap} JEV points.", { leader: leaderLabel, runner: runnerLabel, gap }),
        ref: leader.optionId,
      });
    }
  }

  // 3. Which factors produced the lead. `impact` is leader-minus-runner, so a
  // negative value means the factor is pulling toward the runner-up.
  for (const d of input.sensitivity.dominantFactors.slice(0, 3)) {
    if (Math.abs(d.impact) < 0.05) continue;
    const favoursLeader = d.impact > 0;
    const subject = favoursLeader ? leaderLabel : runnerLabel || t("the other option");
    reasons.push({
      type: "CRITERION",
      text: t("{factor} favours {option} ({impact} JEV).", { factor: d.label, option: subject, impact: `${d.impact > 0 ? "+" : ""}${d.impact}` }),
      ref: d.factorId,
    });
  }

  // 4. Constraints that removed options.
  for (const v of input.violations ?? []) {
    reasons.push({ type: "CONSTRAINT", text: v.reason, ref: v.constraint.id });
  }

  // 5. Constraints ORION could not check. Never let these pass silently.
  for (const w of input.warnings ?? []) {
    reasons.push({ type: "CONSTRAINT", text: w.reason, ref: w.constraint.id });
  }

  // 6. Uncertainty, in the terms that matter for the choice.
  if (leader && runner) {
    const bandsOverlap = leader.low <= runner.high && runner.low <= leader.high;
    if (bandsOverlap) {
      reasons.push({
        type: "UNCERTAINTY",
        text: t("The plausible ranges for {leader} and {runner} overlap, so the ordering is not settled.", { leader: leaderLabel, runner: runnerLabel }),
      });
    }
    if (leader.confidence < 0.45) {
      reasons.push({
        type: "UNCERTAINTY",
        text: t("Confidence in {leader}'s score is low, so its range is wide.", { leader: leaderLabel }),
        ref: leader.optionId,
      });
    }
  }

  // 7. Evidence, or its absence.
  const evidence = input.evidence ?? [];
  if (evidence.length === 0) {
    reasons.push({
      type: "EVIDENCE",
      text: t("No evidence has been attached to this decision yet."),
    });
  } else {
    const weak = evidence.filter((e) => (e.reliability ?? 1) < 0.5).length;
    reasons.push({
      type: "EVIDENCE",
      text:
        weak > 0
          ? t("{n} piece(s) of evidence attached, {weak} rated low reliability.", { n: evidence.length, weak })
          : t("{n} piece(s) of evidence attached.", { n: evidence.length }),
    });
  }

  const assumptions = input.assumptions ?? [];
  if (assumptions.length > 0) {
    reasons.push({
      type: "EVIDENCE",
      text: t("The result rests on {n} unverified assumption(s).", { n: assumptions.length }),
    });
  }

  // 8. Criteria the user declared, when they differ from the raw factors.
  const criteria = input.criteria ?? [];
  const minimised = criteria.filter((c) => c.direction === "MINIMIZE");
  if (minimised.length > 0) {
    reasons.push({
      type: "CRITERION",
      text: t("{factors} counted as better when lower.", { factors: minimised.map((c) => c.name).join(", ") }),
    });
  }

  // 9. Safety framing last, so it reads as a caveat rather than a verdict.
  if (input.safety && input.safety !== "normal") {
    const notice = safetyNotice(input.safety);
    if (notice) reasons.push({ type: "SAFETY", text: notice });
  }

  return reasons;
}

function labelOf(options: DecisionOption[], id: string): string {
  return options.find((o) => o.id === id)?.label ?? id;
}

const round2 = (n: number) => Math.round(n * 100) / 100;