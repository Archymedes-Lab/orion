// When ORION should come back to a decision. Following up is how calibration gets its reviews and how an open
// decision gets finished, but asking about a pizza a week later is noise. So: nothing for fun choices, one quick
// check for everyday ones, and a few spaced check-ins for serious ones, when the real outcome takes time to show.
import { t } from "../i18n/index.ts";
import type { Stakes } from "../types.ts";
import type { DecisionMode } from "./mode.ts";

export type FollowUpKind = "outcome" | "open";

export interface FollowUpStep {
  kind: FollowUpKind;
  /** Days after the decision was saved. */
  days: number;
  /** What the check-in asks. */
  prompt: string;
}

const DAY = 24 * 60 * 60 * 1000;

export function followUpPlan(input: { mode: DecisionMode; stakes: Stakes; decided: boolean; reversibility?: number }): FollowUpStep[] {
  const { mode, stakes, decided } = input;
  if (mode === "playful") return [];
  if (!decided) {
    return [{ kind: "open", days: mode === "serious" ? 3 : 1, prompt: t("Still deciding? Pick it up where you left off.") }];
  }
  if (mode === "everyday") return [{ kind: "outcome", days: 2, prompt: t("How did it go?") }];
  // Hard-to-undo choices get an early check, while there may still be time to change course.
  const early = (input.reversibility ?? 0.5) < 0.4 ? 3 : 7;
  const steps: FollowUpStep[] = [
    { kind: "outcome", days: early, prompt: t("First impressions: how is it going so far?") },
    { kind: "outcome", days: 30, prompt: t("A month on: how has it turned out?") },
  ];
  if (stakes === "major") steps.push({ kind: "outcome", days: 90, prompt: t("Three months on: looking back, how did it turn out?") });
  // Serious choices show their real shape over seasons, not weeks: come back at six months and a year, so the
  // long-range picture in the aftermath gets checked against what happened.
  steps.push(
    { kind: "outcome", days: 180, prompt: t("Six months on: how has it settled?") },
    { kind: "outcome", days: 365, prompt: t("A year on: looking back, was it the right call?") },
  );
  return steps;
}

/** ISO due date for a step, counted from `from`. */
export const dueDate = (from: Date, days: number) => new Date(from.getTime() + days * DAY).toISOString();
