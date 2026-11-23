// Prioritize: the AI proposes the three scores of a task (impact on the declared goals, effort, urgency), which goal
// it serves, the cause behind an urgency ("theme", so repeats can be spotted) and a one-line reason. The person
// confirms or changes them; src/decision-engine/board.ts places the task. Nothing here decides.
//
// Jev answers the three scores when there is a key (each asked twice with the scale reversed, then calibrated, as in
// server/prioritize.ts); a general model answers goal, theme and reason in parallel, and all of it when Jev is missing.
import { z } from "zod";
import { BusinessProfileSchema } from "../src/business/schema.ts";
import { belief } from "../src/decision-engine/creative.ts";
import type { Level } from "../src/decision-engine/board.ts";
import { systemOne, type SystemOneQuestion } from "./typesafe.ts";
import { structured, type ProviderOptions } from "./providers.ts";
import { companyBrief } from "./business.ts";
import { choiceOrbit, decode, scoreOrbit, type Presented } from "./creative.ts";
import type { Locale } from "../src/i18n/index.ts";

/** The anchors from the proposal, as five distinct levels each (least first). */
export const TASK_QUESTIONS = {
  impact: { question: "How much would finishing `task` move the goals listed in `goals`?", levels: ["No visible effect on any goal", "Barely moves a goal", "Moves one goal a little", "Clearly moves a goal", "Moves a key goal a lot, or durably"] },
  effort: { question: "How much work is `task` for the person or team doing it?", levels: ["Under an hour", "A few hours", "One or two days", "Several days", "More than a week"] },
  urgency: { question: "As of `today`, what does waiting on `task` cost: is there a deadline, someone waiting on it, or damage that grows each day?", levels: ["No deadline, no cost of waiting", "Due in the coming months", "Due this month", "Due this week", "Due today, or waiting costs something every day"] },
} as const;
export type TaskScore = keyof typeof TASK_QUESTIONS;
export const TASK_SCORES = Object.keys(TASK_QUESTIONS) as TaskScore[];

const id = z.string().trim().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Goals = z.array(z.object({ id, title: z.string().trim().min(1).max(80), metric: z.string().trim().max(80).optional() })).max(5).default([]);
export const TaskScoreRequestSchema = z.object({
  tasks: z.array(z.object({ id, title: z.string().trim().min(1).max(120), notes: z.string().trim().max(600).optional(), due: day.nullable().optional() })).min(1).max(12),
  goals: Goals,
  today: day,
  business: BusinessProfileSchema.optional(),
});
export type TaskScoreRequest = z.infer<typeof TaskScoreRequestSchema>;

export const TaskSplitRequestSchema = z.object({
  task: z.object({ title: z.string().trim().min(1).max(120), notes: z.string().trim().max(600).optional(), blocker: z.string().trim().max(400).nullable().optional() }),
  goals: Goals,
  today: day,
  business: BusinessProfileSchema.optional(),
});
export type TaskSplitRequest = z.infer<typeof TaskSplitRequestSchema>;

export interface ProposedScores { id: string; impact: Level; effort: Level; urgency: Level; goalId: string | null; theme: string | null; why: string | null }

const level = z.number().min(1).max(5).transform((n) => Math.round(n) as Level);
/** The median level of a belief: the scales are ordinal, and calibration pulls a mean toward the middle. */
const toLevel = (dist: number[]) => {
  let cdf = 0;
  for (let i = 0; i < dist.length; i++) { cdf += dist[i]; if (cdf >= 0.5) return (i + 1) as Level; }
  return dist.length as Level;
};
const num = { type: "number" }, str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const anchors = Object.fromEntries(TASK_SCORES.map((k) => [k, { question: TASK_QUESTIONS[k].question, "1..5": TASK_QUESTIONS[k].levels }]));
const korean = (lang: Locale) => (lang === "ko" ? "\nLANGUAGE: KOREAN. Write `why`, `theme` and step titles in natural Korean (해요체 for sentences). Keep ids in English." : "");
const context = (input: { goals: TaskScoreRequest["goals"]; today: string; business?: TaskScoreRequest["business"] }) => ({
  today: input.today,
  goals: input.goals.length ? input.goals : "No goals declared: judge impact on the person's or company's evident aims, and be modest.",
  company: input.business ? companyBrief(input.business) : undefined,
});

/** Jev: the three scores and the goal each task serves, one request per task. */
export async function scoreTasksWithJev(input: TaskScoreRequest, options: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
  const qs: Record<string, SystemOneQuestion> = {};
  const orbits = Object.fromEntries(TASK_SCORES.map((k) => [k, scoreOrbit(k, `${TASK_QUESTIONS[k].question} Judge only \`task\`.`, [...TASK_QUESTIONS[k].levels], qs)])) as Record<TaskScore, Presented[]>;
  // Which goal it serves: each goal is a label, plus "none"; asked once per rotation so position cancels out.
  const goalOrbit = input.goals.length
    ? choiceOrbit("goal", "Which of these goals would finishing `task` move the most? Choose none when it serves none of them.",
      { ...Object.fromEntries(input.goals.map((g) => [g.id, g.metric ? `${g.title} (${g.metric})` : g.title])), none: "None of these goals" }, qs)
    : [];
  const answers = await Promise.all(input.tasks.map((t) => systemOne(
    // An unknown deadline is left out: "due: none" reads as "no cost of waiting".
    { ...context(input), task: t.title, ...(t.notes ? { notes: t.notes } : {}), ...(t.due ? { due: t.due } : {}) }, qs, { ...options, timeoutMs: options.timeoutMs ?? 20_000 })));
  return input.tasks.map((t, n) => {
    let goalId: string | null = null;
    if (goalOrbit.length) {
      const dist = belief("choice", goalOrbit.map((p) => decode(answers[n].answers[p.qid], p)));
      const best = dist.indexOf(Math.max(...dist));
      goalId = goalOrbit[0].labels[best] === "none" ? null : goalOrbit[0].labels[best];
    }
    return {
      id: t.id, goalId,
      ...Object.fromEntries(TASK_SCORES.map((k) => [k, toLevel(belief("score", orbits[k].map((p) => decode(answers[n].answers[p.qid], p))))])) as Record<TaskScore, Level>,
    };
  });
}

/** A general model: scores (unless Jev gave them), the goal each task serves, the cause theme and a one-line reason. */
export async function scoreTasksWithAI(input: TaskScoreRequest, options: ProviderOptions = {}, lang: Locale = "en"): Promise<ProposedScores[]> {
  const goalIds = new Set(input.goals.map((g) => g.id));
  const Row = z.object({ id: z.string(), impact: level, effort: level, urgency: level, goalId: z.string().nullable(), theme: z.string().trim().max(40).nullable(), why: z.string().trim().max(200) });
  const Out = z.object({ tasks: z.array(Row) }).refine(({ tasks }) => input.tasks.every((t) => tasks.some((r) => r.id === t.id)), "Missing tasks");
  const result = await structured({
    task: "score",
    input: { ...context(input), scale: anchors, tasks: input.tasks },
    instructions: [
      "Propose three 1–5 scores for every task, using exactly the anchors in `scale`: impact is the effect on the declared `goals` (not on anything else); effort is the work for whoever does it; urgency is the deadline or the daily cost of waiting, as of `today` and the task's `due`.",
      "goalId: the id of the goal it serves most, or \"\" when it serves none. theme: when the task is a recurring kind of problem or chore, a 1–3 word label for its underlying cause (\"invoicing errors\", \"supplier delays\"), the same label for the same cause; otherwise \"\".",
      "why: one plain sentence of at most 20 words saying what drove the impact and urgency. No numbers that are not in the task.",
      "Be honest and modest: most tasks are not impact 5. Unknown means 3. Copy ids exactly.",
    ].join("\n") + korean(lang),
    schema: obj({ tasks: { type: "array", items: obj({ id: str, impact: num, effort: num, urgency: num, goalId: str, theme: str, why: str }) } }),
    validate: Out,
  }, options);
  return input.tasks.map((t) => {
    const r = result.data.tasks.find((x) => x.id === t.id)!;
    return { id: t.id, impact: r.impact as Level, effort: r.effort as Level, urgency: r.urgency as Level, goalId: r.goalId && goalIds.has(r.goalId) ? r.goalId : null, theme: r.theme || null, why: r.why || null };
  });
}

/** How long the general model may still take once Jev has answered: the theme and the reason are nice to have, not worth a wait. */
export const GRACE_MS = 6_000;

/**
 * Jev and the general model start together. Jev answers the scores and the goal in about a second; the general model
 * then gets a short grace period for the theme and the reason. Without Jev, the general model answers everything.
 * Throws only when neither answers.
 */
export async function scoreTasks(input: TaskScoreRequest, options: ProviderOptions & { typesafeKey?: string; graceMs?: number }, lang: Locale = "en") {
  const general = scoreTasksWithAI(input, options, lang).catch((error: unknown) => error as Error);
  const scores = options.typesafeKey
    ? await scoreTasksWithJev(input, { apiKey: options.typesafeKey, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs }).catch(() => null)
    : null;
  const rest = scores
    ? await Promise.race([general, new Promise<Error>((resolve) => setTimeout(() => resolve(new Error("grace")), options.graceMs ?? GRACE_MS))])
    : await general;
  if (rest instanceof Error && !scores) throw rest;
  const tasks: ProposedScores[] = input.tasks.map((t) => {
    const g = rest instanceof Error ? null : rest.find((r) => r.id === t.id) ?? null;
    const j = scores?.find((s) => s.id === t.id) ?? null;
    return { id: t.id, impact: (j ?? g)!.impact, effort: (j ?? g)!.effort, urgency: (j ?? g)!.urgency, goalId: j ? j.goalId : g?.goalId ?? null, theme: g?.theme ?? null, why: g?.why ?? null };
  });
  return { tasks, judge: scores ? ("typesafe" as const) : ("ai" as const) };
}

/** A task that keeps slipping, cut into 2–5 concrete steps, each with proposed scores. */
export async function splitTask(input: TaskSplitRequest, options: ProviderOptions = {}, lang: Locale = "en") {
  const Step = z.object({ title: z.string().trim().min(1).max(120), impact: level, effort: level, urgency: level });
  const result = await structured({
    task: "score",
    input: { ...context(input), scale: anchors, task: input.task },
    instructions: [
      "This task keeps being postponed. Cut it into 2 to 5 concrete steps, in order, each small enough to start today (prefer effort 1–2). The first step should be the one that removes the `blocker` when one is given.",
      "Each step title starts with a verb and is at most 12 words. Score each step on the anchors in `scale`; impact is the step's own effect on the `goals`.",
    ].join("\n") + korean(lang),
    schema: obj({ steps: { type: "array", items: obj({ title: str, impact: num, effort: num, urgency: num }) } }),
    validate: z.object({ steps: z.array(Step).min(2).max(5) }),
  }, options);
  return { steps: result.data.steps };
}
