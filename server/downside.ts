// Downside: for each option, how bad the realistic worst case is and whether it could be undone. Hacker News' most
// common advice on a hard decision is to protect the downside (worst case, reversibility, runway), so ORION shows it
// next to the call. Jev answers each question twice, the second time reversed (levels flipped, the yes/no negated),
// and the two are averaged so the wording's direction does not tilt the answer. Fetched only when the person asks.
import { z } from "zod";
import { BusinessProfileSchema } from "../src/business/schema.ts";
import { systemOne, type SystemOneQuestion } from "./typesafe.ts";
import { businessState, isBusinessDecision } from "./business.ts";

const id = z.string().min(1).max(100);
export const DownsideRequestSchema = z.object({
  context: z.string().trim().min(1).max(4000),
  stakes: z.enum(["tiny", "normal", "significant", "major"]).default("normal"),
  options: z.array(z.object({ id, label: z.string().trim().min(1).max(80) })).min(1).max(6),
  business: BusinessProfileSchema.optional(),
});
export type DownsideRequest = z.infer<typeof DownsideRequestSchema>;

/** Position is the answer (0 = mildest). The app words these itself, so they never need translating here. */
export const WORST_LEVELS = [
  "Hardly any downside: if it goes wrong, little is lost.",
  "A minor setback that is easily absorbed.",
  "A real setback that takes months to recover from.",
  "A serious, lasting loss of money, career, health or relationships.",
  "Severe harm that is very hard to recover from.",
];

const questions: Record<string, SystemOneQuestion> = {
  worst: { type: "score", instructions: "If the person chooses `option` and it goes as badly as it realistically could, how bad is that outcome for them? Judge only `option`, in the situation described by `decision`.", criteria: WORST_LEVELS },
  worstReversed: { type: "score", instructions: "If the person chooses `option` and it goes as badly as it realistically could, how bad is that outcome for them? Judge only `option`, in the situation described by `decision`.", criteria: [...WORST_LEVELS].reverse() },
  undo: { type: "noul", instructions: "Could the person undo `option` within a few months, without serious or lasting cost, if it turned out to be a mistake?", criteria: { true: "Yes, it could be undone without lasting cost", false: "No, undoing it would be costly or impossible" } },
  locked: { type: "noul", instructions: "Once the person has chosen `option`, would they be locked in, so that reversing it within a few months would be costly or impossible?", criteria: { true: "Yes, they would be locked in", false: "No, they could reverse it cheaply" } },
};

export interface DownsideItem { optionId: string; worst: number; reversible: number }

export async function downsideWithJev(input: DownsideRequest, options: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<{ options: DownsideItem[] }> {
  const lens = isBusinessDecision(input.context, input.business) ? businessState(input.business) : {};
  const answers = await Promise.all(input.options.map((o) => systemOne(
    { decision: input.context, stakes: input.stakes, ...lens, option: o.label, alternatives: input.options.filter((x) => x.id !== o.id).map((x) => x.label) },
    questions, { ...options, timeoutMs: options.timeoutMs ?? 12_000 },
  )));
  return {
    options: input.options.map((o, i) => {
      const a = answers[i].answers;
      const { worst, worstReversed, undo, locked } = a;
      if (worst?.type !== "score" || worstReversed?.type !== "score" || undo?.type !== "noul" || locked?.type !== "noul") throw new Error("Incomplete Jev answers");
      const top = WORST_LEVELS.length - 1;
      return {
        optionId: o.id,
        worst: Math.round(((worst.score + (top - worstReversed.score)) / 2) * 100) / 100,
        reversible: Math.round(((undo.noul + (1 - locked.noul)) / 2) * 1000) / 1000,
      };
    }),
  };
}
