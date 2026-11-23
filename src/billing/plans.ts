// ORION's pricing, in one place. The structure was chosen by putting the alternatives to Jev
// (scripts/jev-guide.ts, 2026-10-04); the figures in brackets are the probability Jev gave its pick.
//
//   Structure: free core + yearly plan with a monthly option + a one-time pass for one decision   [99%]
//   Free product: no limit on decisions; depth is what is paid                                   [74%]
//   Pass: unlocks one decision, for as long as that decision exists                              [99%]
//   Recommended plan on the plans screen: yearly                                                 [85%]
//   Yearly $29.99 [57%], monthly $4.99 [55%], pass $4.99 [37%, with $2.99 at 34%: a toss-up]
//   Lower local-currency prices in lower-income regions                                          [82%]
//
// Amounts are set on the Prices in Stripe, not here: `suggestedUsd` is what to create them with.
// What is paid: Jev scored each feature on "would move someone to pay" and on "locking it hurts the free product".
// Only three came out even slightly ahead on the first, and friend input and reminders came out clearly as
// things to keep free, because sharing and returning are how ORION grows.

import { msg } from "../i18n/index.ts";

// Names and descriptions are English keys (msg): show them through t().
export type PlanId = "yearly" | "monthly" | "pass";
export type PaidFeature = "deep_analysis" | "choice_justification" | "full_insights";

export const PLANS: Record<PlanId, { name: string; kind: "subscription" | "one_time"; suggestedUsd: number; blurb: string; recommended?: boolean }> = {
  yearly: { name: msg("ORION Pro, yearly"), kind: "subscription", suggestedUsd: 29.99, blurb: msg("Every paid feature on every decision. The lowest price per month."), recommended: true },
  monthly: { name: msg("ORION Pro, monthly"), kind: "subscription", suggestedUsd: 4.99, blurb: msg("Every paid feature on every decision. Cancel any time.") },
  pass: { name: msg("One-decision pass"), kind: "one_time", suggestedUsd: 4.99, blurb: msg("Deep analysis for one decision, kept for good. No subscription.") },
};

export const PAID_FEATURES: Record<PaidFeature, { name: string; what: string; inPass: boolean }> = {
  deep_analysis: { name: msg("Deep analysis"), what: msg("Conservative, expected and optimistic scenarios, what would have to be true for another option to win, and the estimate behind every number."), inPass: true },
  choice_justification: { name: msg("What would justify your choice"), what: msg("When you go against the numbers: exactly what would have to matter more for your choice to be the better one."), inPass: true },
  // Insights span all decisions, so a pass for one decision cannot include them.
  full_insights: { name: msg("How your choices turn out"), what: msg("Across all your decisions: how often following the comparison went well, and how your calls against it went."), inPass: false },
};

export interface Entitlement {
  /** Billing is set up on the server. When it is not, nothing is locked. */
  billing: boolean;
  pro: boolean;
  /** Decisions a one-time pass was bought for. */
  passes: string[];
}

/** Whether a paid feature is open, for a given decision where the feature belongs to one. */
export function canUse(feature: PaidFeature, entitlement: Entitlement, decisionId?: string | null): boolean {
  if (!entitlement.billing || entitlement.pro) return true;
  return PAID_FEATURES[feature].inPass && !!decisionId && entitlement.passes.includes(decisionId);
}
