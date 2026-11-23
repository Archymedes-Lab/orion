// §5 + §30: never ask unless the answer could change the decision.
// Fight analysis paralysis: stop quickly when reversible, margin large, or VOI low.
import { t } from "../i18n/index.ts";
import type { Stakes } from "../types.ts";

export interface StopInput {
  gap: number; // leader JEV minus runner-up
  stakes: Stakes;
  reversibility: number; // leader reversibility 0..1
  questionsAsked: number;
  maxQuestions: number;
}

export function shouldStop(in_: StopInput): { stop: boolean; reason: string } {
  if (in_.questionsAsked >= in_.maxQuestions)
    return { stop: true, reason: t("Question budget reached.") };
  if (in_.stakes === "tiny" && in_.reversibility >= 0.6 && in_.questionsAsked >= 1)
    return { stop: true, reason: t("Low stakes and reversible — enough analysis.") };
  if (in_.gap >= 2.5 && in_.questionsAsked >= 1)
    return { stop: true, reason: t("Strong leader; more questions unlikely to change it.") };
  if (in_.gap >= 1.2 && in_.questionsAsked >= 2)
    return { stop: true, reason: t("Stable lead; diminishing returns.") };
  if (in_.gap >= 0.8 && in_.questionsAsked >= 3)
    return { stop: true, reason: t("Clear direction emerging; further analysis unlikely to help.") };
  return { stop: false, reason: t("Close call — one more useful question is worthwhile.") };
}

export function questionBudgetFor(stakes: Stakes): number {
  return stakes === "tiny" ? 1 : stakes === "normal" ? 2 : stakes === "significant" ? 2 : 2;
}
