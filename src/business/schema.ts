// ORION for businesses. A decision can be asked "for me" or "for the business"; in business mode a short company
// profile travels with every request so the server can apply its business playbook (server/business.ts) and score
// options for this company's stage, cash and appetite for risk rather than for a person's life.
//
// Everything here is optional: an empty profile still switches the playbook on. The profile is shown and edited on
// the You screen, kept in user_preferences (so account backup carries it) and never inferred behind the person's back.
import { z } from "zod";
import { msg, t } from "../i18n/index.ts";

// The labels below are English keys (msg), and the English also goes into the server's prompt: show them through t().

export const STAGES = {
  idea: msg("Idea or pre-launch"),
  early: msg("Early: first customers"),
  growing: msg("Growing"),
  established: msg("Established"),
} as const;
export const TEAM_SIZES = ["Just me", "2–10", "11–50", "51–250", "250+"] as const;
/** A team size as shown: "Just me" is a stored value, so it is translated where it is shown. */
export const teamLabel = (team: (typeof TEAM_SIZES)[number]): string => (team === "Just me" ? t(msg("Just me")) : team);
export const RISK = {
  cautious: msg("Cautious: protect what we have"),
  balanced: msg("Balanced"),
  bold: msg("Bold: we can take big swings"),
} as const;
export const GOALS = {
  survive: msg("Stay alive: extend runway"),
  grow: msg("Grow revenue and customers"),
  profit: msg("Become or stay profitable"),
  value: msg("Build long-term value"),
} as const;

const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const BusinessProfileSchema = z.object({
  name: z.string().trim().max(80).optional(),
  industry: z.string().trim().max(80).optional(),
  stage: z.enum(keys(STAGES)).optional(),
  team: z.enum(TEAM_SIZES).optional(),
  /** Months the company can run at today's burn. Null when unknown or profitable. */
  runwayMonths: z.number().finite().min(0).max(120).nullable().optional(),
  risk: z.enum(keys(RISK)).optional(),
  goal: z.enum(keys(GOALS)).optional(),
  /** Anything else ORION should know: model, customers, constraints. */
  notes: z.string().trim().max(600).optional(),
}).strict();
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

/** One line for the UI: "Acme · Growing · 11–50 people". */
export function profileSummary(p: BusinessProfile): string {
  return [p.name, p.industry, p.stage && t(STAGES[p.stage]), p.team && (p.team === "Just me" ? t("solo") : t("{team} people", { team: p.team })),
    p.runwayMonths != null && t("{n} months runway", { n: p.runwayMonths })].filter(Boolean).join(" · ");
}
