// Business priorities: Jev rates every option on the seven prioritisation dimensions (impact, urgency, reach,
// confidence, effort, leverage, reversibility); src/decision-engine/prioritize.ts turns them into the matrices.
// Each Score is asked twice with the levels reversed and averaged, then calibrated, exactly like the new paths
// (server/creative.ts). Without a Jev key a general model gives levels with a confidence instead.
import { z } from "zod";
import { BusinessProfileSchema } from "../src/business/schema.ts";
import { belief, fromPoint } from "../src/decision-engine/creative.ts";
import { PRIORITY_DIMENSIONS, PRIORITY_QUESTIONS, type PriorityDimension, type PriorityJudgment } from "../src/decision-engine/prioritize.ts";
import { systemOne, type SystemOneQuestion } from "./typesafe.ts";
import { structured, type ProviderOptions } from "./providers.ts";
import { businessInstructions, businessState } from "./business.ts";
import { decode, scoreOrbit, type Presented } from "./creative.ts";
import type { Locale } from "../src/i18n/index.ts";

const id = z.string().min(1).max(100);
export const PrioritizeRequestSchema = z.object({
  context: z.string().trim().min(1).max(4000),
  options: z.array(z.object({ id, label: z.string().trim().min(1).max(80) })).min(1).max(8),
  business: BusinessProfileSchema.optional(),
});
export type PrioritizeRequest = z.infer<typeof PrioritizeRequestSchema>;

export async function prioritizeWithJev(input: PrioritizeRequest, options: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<PriorityJudgment[]> {
  const qs: Record<string, SystemOneQuestion> = {};
  const orbits = Object.fromEntries(PRIORITY_DIMENSIONS.map((d) => [d,
    scoreOrbit(d, `${PRIORITY_QUESTIONS[d].question} Judge only \`option\`, for the company and situation in \`decision\`.`, PRIORITY_QUESTIONS[d].levels, qs)])) as Record<PriorityDimension, Presented[]>;
  const answers = await Promise.all(input.options.map((o) => systemOne(
    { decision: input.context, ...businessState(input.business), option: o.label }, qs, { ...options, timeoutMs: options.timeoutMs ?? 20_000 })));
  return input.options.map((o, n) => ({
    optionId: o.id,
    dims: Object.fromEntries(PRIORITY_DIMENSIONS.map((d) => [d, belief("score", orbits[d].map((p) => decode(answers[n].answers[p.qid], p)))])) as Record<PriorityDimension, number[]>,
  }));
}

export async function prioritizeWithAI(input: PrioritizeRequest, options: ProviderOptions = {}, lang: Locale = "en"): Promise<PriorityJudgment[]> {
  const Rated = z.object({ options: z.array(z.object({ optionId: z.string(), ratings: z.array(z.object({ dimension: z.enum(PRIORITY_DIMENSIONS), level: z.number().min(0).max(4), confidence: z.number().min(0).max(1) })) })) })
    .refine(({ options: rows }) => input.options.every((o) => PRIORITY_DIMENSIONS.every((d) => rows.find((r) => r.optionId === o.id)?.ratings.some((x) => x.dimension === d))), "Incomplete ratings");
  const num = { type: "number" }, str = { type: "string" };
  const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const result = await structured({
    task: "score", business: true,
    input: { decision: input.context, options: input.options, dimensions: Object.fromEntries(PRIORITY_DIMENSIONS.map((d) => [d, PRIORITY_QUESTIONS[d]])) },
    instructions: "Rate every option on every dimension: level 0–4 is the index into that dimension's `levels` (worst/least first), confidence 0–1 in that level. Be conservative on demand and timelines; unknown means level 2 with low confidence. Copy optionIds exactly. Do not pick a winner." + businessInstructions("score", input.business, lang),
    schema: obj({ options: { type: "array", items: obj({ optionId: str, ratings: { type: "array", items: obj({ dimension: { type: "string", enum: PRIORITY_DIMENSIONS }, level: num, confidence: num }) } }) } }),
    validate: Rated,
  }, options);
  return input.options.map((o) => {
    const row = result.data.options.find((r) => r.optionId === o.id)!;
    return { optionId: o.id, dims: Object.fromEntries(PRIORITY_DIMENSIONS.map((d) => { const x = row.ratings.find((r) => r.dimension === d)!; return [d, fromPoint(x.level, x.confidence)]; })) as Record<PriorityDimension, number[]> };
  });
}

export async function prioritizeOptions(input: PrioritizeRequest, options: ProviderOptions & { typesafeKey?: string }, lang: Locale = "en") {
  if (options.typesafeKey) {
    try { return { judgments: await prioritizeWithJev(input, { apiKey: options.typesafeKey, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs }), judge: "typesafe" as const }; }
    catch { /* fall through */ }
  }
  return { judgments: await prioritizeWithAI(input, options, lang), judge: "ai" as const };
}
