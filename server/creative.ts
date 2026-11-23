// New paths: creative decision making on top of the comparison (cdm, ../creative-decision).
//
//   DIVERGE  a general model writes up to three paths the person did not list, each a different type of approach
//            (APPROACHES, the "niches"), plus the cheapest check that would show it breaks a hard limit. Decision models select;
//            they do not generate, so this is the one step a generative model owns.
//   JUDGE    Jev answers typed questions about every option, listed and new, one parallel request per option:
//            a Score per factor and for novelty (asked twice, levels reversed, to cancel direction bias), a Noul per
//            limit, a Choice of niche (asked once per rotation, to cancel position bias).
//   BELIEFS  decoded, smoothed, averaged over the orbit and tempered (src/decision-engine/creative.ts belief()).
//
// The server returns beliefs, not a verdict: the app runs creativeDecide() itself, so the factor weights the person
// adjusts re-rank everything without another request. Without a Jev key, a general model gives point estimates
// that are spread into beliefs (fromPoint), so the feature still works, less sharply.
import { z } from "zod";
import { BusinessProfileSchema } from "../src/business/schema.ts";
import { belief, cyclicOrbit, fromPoint, noulBelief, relabel, reversalOrbit, type CreativeJudgment } from "../src/decision-engine/creative.ts";
import { FACTOR_LEVELS, systemOne, type SystemOneAnswer, type SystemOneQuestion } from "./typesafe.ts";
import { structured, type ProviderOptions } from "./providers.ts";
import { businessInstructions, businessState, isBusinessDecision } from "./business.ts";
import type { Locale } from "../src/i18n/index.ts";

const id = z.string().min(1).max(100);
const label = z.string().trim().min(1).max(80);
export const CreativeRequestSchema = z.object({
  context: z.string().trim().min(1).max(4000),
  stakes: z.enum(["tiny", "normal", "significant", "major"]).default("normal"),
  options: z.array(z.object({ id, label })).min(1).max(4),
  factors: z.array(z.object({ id, label: label.max(40) })).min(1).max(8),
  /** How many new paths to write; 0 judges only the listed options. */
  paths: z.number().int().min(0).max(3).default(3),
  business: BusinessProfileSchema.optional(),
});
export type CreativeRequest = z.infer<typeof CreativeRequestSchema>;

/** checkOnly: the person's own limit as a model read it: it can ask for a check, never veto (creative.ts gate). */
export interface Limit { id: string; label: string; hard: boolean; violation: string; checkOnly?: boolean }
export interface Path { id: string; label: string; description: string; check: string; niche: string }
export interface CreativeResponse {
  paths: Path[];
  niches: Record<string, string>;
  limits: Limit[];
  baselineId: string | null;
  judgments: CreativeJudgment[];
  judge: "typesafe" | "ai";
  /** New paths were asked for but none could be written (the generative models were unavailable). */
  divergeFailed: boolean;
}

/** Limits every decision has. Hard ones gate (check first, else keep the status quo); the soft one costs. */
export const BASE_LIMITS: Limit[] = [
  { id: "harm", label: "Serious harm that can’t be undone", hard: true, violation: "cause serious harm to someone that could not be undone" },
  { id: "law", label: "Breaking the law or misleading someone", hard: true, violation: "break the law, or deceive or mislead someone" },
  { id: "stretch", label: "More than they can give", hard: false, violation: "need more time, money or energy than the person plausibly has" },
];
/** Types of approach, by mechanism. The portfolio keeps the best of each, so the bold bets don't all look alike. */
export const APPROACHES: Record<string, string> = {
  direct: "Do it yourself, head on",
  staged: "Try a small, reversible version first",
  borrow: "Use someone else's help, skills, reach or resources",
  reorder: "Change the order or timing: one thing first, the rest later",
  reframe: "Change the goal: solve the need behind the question another way",
  combine: "Combine with something else so each makes the other worth more",
};
export const NOVELTY_LEVELS = [
  "Essentially the same as one of the `precedents`",
  "A minor variation on a precedent",
  "Recombines precedents in a way none of them does alone",
  "A different mechanism from every precedent, though known elsewhere",
  "A mechanism with no clear precedent in this kind of decision",
];
const OTHER = "other";

/** Words that make an option the status quo. Used when the diverging model is unavailable. */
const STATUS_QUO = /\b(?:stay|keep|remain|do nothing|don['’]t|not now|as (?:it|things) (?:is|are)|current|wait|status quo)\b|그대로|지금처럼|유지|안\s*하|하지\s*않/i;
export const guessBaseline = (options: { id: string; label: string }[]) => options.find((o) => STATUS_QUO.test(o.label))?.id ?? null;

// --- DIVERGE ----------------------------------------------------------------------------------------------------

const str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const text = (max: number) => z.string().trim().min(1).transform((s) => s.slice(0, max).trim());

const Diverged = z.object({
  paths: z.array(z.object({ label: text(80), description: text(160), niche: z.string().optional().transform((v) => v ?? OTHER), check: text(140) })).max(3),
  limits: z.array(z.object({ label: text(60), violation: text(140), quote: z.string().optional().transform((q) => q ?? "") })).optional().transform((l) => (l ?? []).slice(0, 2)),
  statusQuo: z.string().optional().transform((v) => v ?? ""),
});

/**
 * Lean on purpose: on 2026-10-20 a version that also invented its own niches ran out of output on the free models
 * (25–100 s, then cut off). The approach types are fixed (APPROACHES) and Jev re-reads each path's type anyway.
 */
export async function divergeWithAI(input: CreativeRequest, options: ProviderOptions = {}, lang: Locale = "en") {
  const business = isBusinessDecision(input.context, input.business) ? businessInstructions("diverge", input.business, lang) : "";
  const listed = input.options.map((o) => o.label);
  const result = await structured({
    task: "diverge", business: business !== "",
    input: { decision: input.context, stakes: input.stakes, listedOptions: listed, factors: input.factors.map((f) => f.label), approaches: APPROACHES, count: input.paths },
    instructions:
      "Write exactly `count` new paths for this decision that the person did not list, each from a different approach id in `approaches`, " +
      "preferring approaches no listed option takes. A path is concrete, legal and specific to their situation; not a mix of listed options, " +
      "not 'do more research'. It changes the mechanism: who does it, in what order, at what scale, with whose resources, or against which goal. " +
      "label ≤80 chars, an action. description ≤160 chars: how it works. check ≤140 chars: the cheapest test, doable within days, that would show " +
      "it is unsafe, unlawful or unworkable before committing. limits: usually none. Only a line the person explicitly drew as non-negotiable " +
      "(\"no more than €5,000\", \"must be done by June\", \"I won't move without my kids\"), never a factor they are weighing or a downside they " +
      "mention; quote: their exact words, copied from the decision; violation phrased to follow 'Would this …'. statusQuo: copy the listed option that keeps things as they are, exactly, or \"\". " +
      "Never invent facts about the person. No winner." +
      business + (lang === "ko" ? "\n\nLANGUAGE: KOREAN. Write label, description, check and limit labels in natural Korean (해요체 for sentences). Keep ids and violation in English." : ""),
    schema: obj({
      paths: { type: "array", items: obj({ label: str, description: str, niche: { type: "string", enum: Object.keys(APPROACHES) }, check: str }) },
      limits: { type: "array", items: obj({ label: str, violation: str, quote: str }) },
      statusQuo: str,
    }),
    validate: Diverged,
  }, options);
  const taken = new Set(listed.map((l) => l.toLowerCase()));
  const paths: Path[] = result.data.paths
    .filter((p) => !taken.has(p.label.toLowerCase()))
    .slice(0, input.paths)
    .map((p, i) => ({ id: `path_${i + 1}`, ...p, niche: p.niche && p.niche in APPROACHES ? p.niche : OTHER }));
  // A hard limit can rule options out, the person's own included, so it must be theirs: the quote has to be in what
  // they wrote, and even then it only asks for a check (checkOnly). On 2026-10-20 a model turned "I would leave my
  // family" (a downside being weighed) into a hard limit, and Jev's yes on it ruled out "Take the Berlin job".
  const limits: Limit[] = (result.data.limits ?? [])
    .filter((l) => grounded(l.quote ?? "", input.context))
    .map((l, i) => ({ id: `own_${i + 1}`, label: l.label, violation: l.violation, hard: true, checkOnly: true }));
  const baselineId = input.options.find((o) => o.label === (result.data.statusQuo ?? "").trim())?.id ?? guessBaseline(input.options);
  return { paths, limits, baselineId, ai: result.ai };
}

/** The quote is the person's own words: at least 3 characters, found in the decision ignoring case, spacing and quote marks. */
export function grounded(quote: string, context: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[“”"'‘’`]/g, "").replace(/\s+/g, " ").trim();
  const q = norm(quote);
  return q.length >= 3 && norm(context).includes(q);
}

// --- JUDGE (Jev) ------------------------------------------------------------------------------------------------

export interface Presented { qid: string; kind: "score" | "choice"; labels: string[]; order: number[] }
type Questions = Record<string, SystemOneQuestion>;

export function scoreOrbit(key: string, instructions: string, levels: string[], qs: Questions): Presented[] {
  return reversalOrbit(levels.length).map((order, g) => {
    const qid = `${key}@${g}`;
    qs[qid] = { type: "score", instructions, criteria: order.map((i) => levels[i]) };
    return { qid, kind: "score", labels: levels, order };
  });
}
export function choiceOrbit(key: string, instructions: string, criteria: Record<string, string>, qs: Questions): Presented[] {
  const labels = Object.keys(criteria);
  return cyclicOrbit(labels.length).map((order, g) => {
    const qid = `${key}@${g}`;
    qs[qid] = { type: "choice", instructions, criteria: Object.fromEntries(order.map((i) => [labels[i], criteria[labels[i]]])) };
    return { qid, kind: "choice", labels, order };
  });
}

/** One question set, asked once per option with that option in the state. All questions are independent. */
export function buildQuestions(factors: { id: string; label: string }[], limits: Limit[], niches: Record<string, string>) {
  const qs: Questions = {};
  const orbits: Record<string, Presented[]> = {};
  factors.forEach((f, k) => {
    orbits[`f${k}`] = scoreOrbit(`f${k}`, `If the person chooses \`option\`, what is the expected impact on ${JSON.stringify(f.label)}? Judge only \`option\`, in the situation described by \`decision\`.`, FACTOR_LEVELS, qs);
  });
  limits.forEach((c) => {
    qs[`lim_${c.id}`] = { type: "noul", instructions: `Would carrying out \`option\` ${c.violation}?`, criteria: { true: `Yes, it would ${c.violation}`, false: "No, it would not" } };
  });
  orbits.novelty = scoreOrbit("novelty", "How different is the approach in `option` from every approach listed in `precedents`?", NOVELTY_LEVELS, qs);
  orbits.niche = choiceOrbit("niche", "Which type of approach does `option` mainly take?", { ...niches, [OTHER]: "None of the other approach types fits" }, qs);
  return { qs, orbits };
}

/** Pull one presented answer back to label order. */
export function decode(answer: SystemOneAnswer | undefined, p: Presented): number[] {
  if (!answer || answer.type !== p.kind) throw new Error("Incomplete Jev answers");
  const probs = answer.probabilities;
  return p.kind === "score"
    ? relabel(p.order.map((_, k) => Number(probs[String(k)] ?? 0)), p.order)
    : p.labels.map((l) => Number(probs[l] ?? 0));
}

export async function judgeWithJev(
  input: CreativeRequest, all: { id: string; label: string; description?: string }[], limits: Limit[], niches: Record<string, string>, baselineId: string | null,
  options: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<CreativeJudgment[]> {
  const { qs, orbits } = buildQuestions(input.factors, limits, niches);
  const lens = isBusinessDecision(input.context, input.business) ? businessState(input.business) : {};
  const precedents = input.options.map((o) => o.label);
  const answers = await Promise.all(all.map((o) => systemOne(
    { decision: input.context, stakes: input.stakes, ...lens, precedents, option: o.description ? `${o.label}: ${o.description}` : o.label },
    qs, { ...options, timeoutMs: options.timeoutMs ?? 12_000 },
  )));
  return all.map((o, n) => {
    const a = answers[n].answers;
    const of = (key: string) => belief(orbits[key][0].kind, orbits[key].map((p) => decode(a[p.qid], p)));
    const niche = of("niche");
    return {
      optionId: o.id,
      baseline: o.id === baselineId,
      dims: Object.fromEntries(input.factors.map((f, k) => [f.id, of(`f${k}`)])),
      violations: Object.fromEntries(limits.map((c) => {
        const ans = a[`lim_${c.id}`];
        if (!ans || ans.type !== "noul") throw new Error("Incomplete Jev answers");
        return [c.id, noulBelief(ans.noul)];
      })),
      novelty: of("novelty"),
      niche: Object.fromEntries(orbits.niche[0].labels.map((l, i) => [l, niche[i]])),
    };
  });
}

// --- JUDGE (general model fallback) ---------------------------------------------------------------------------

export async function judgeWithAI(
  input: CreativeRequest, all: { id: string; label: string; description?: string }[], limits: Limit[], niches: Record<string, string>, baselineId: string | null,
  options: ProviderOptions = {},
): Promise<CreativeJudgment[]> {
  const nicheIds = [...Object.keys(niches), OTHER];
  const Judged = z.object({ options: z.array(z.object({
    optionId: z.string(),
    factors: z.array(z.object({ factorId: z.string(), level: z.number().min(0).max(4), confidence: z.number().min(0).max(1) })),
    limits: z.array(z.object({ limitId: z.string(), probability: z.number().min(0).max(1) })),
    novelty: z.number().min(0).max(4),
    niche: z.string(),
  })) }).refine(({ options: rows }) => all.every((o) => {
    const row = rows.find((r) => r.optionId === o.id);
    return row && input.factors.every((f) => row.factors.some((x) => x.factorId === f.id)) && limits.every((c) => row.limits.some((x) => x.limitId === c.id));
  }), "Incomplete judgments");
  const num = { type: "number" };
  const result = await structured({
    task: "score",
    input: { decision: input.context, stakes: input.stakes, precedents: input.options.map((o) => o.label), options: all, factors: input.factors, limits: limits.map(({ id: lid, violation }) => ({ id: lid, violation })), niches },
    instructions:
      "Judge every option. For each factor, level 0–4 (0 strongly negative … 2 neutral … 4 strongly positive impact) and confidence 0–1 in that level. " +
      "For each limit, the probability 0–1 that carrying out the option would do what `violation` says; 0.5 means you genuinely cannot tell. " +
      "novelty 0–4: 0 is the same as a precedent, 4 a mechanism with no clear precedent here. niche: the id of the type of approach it mainly takes, or \"other\". " +
      "Copy every id exactly. Do not pick a winner.",
    schema: obj({ options: { type: "array", items: obj({
      optionId: str,
      factors: { type: "array", items: obj({ factorId: str, level: num, confidence: num }) },
      limits: { type: "array", items: obj({ limitId: str, probability: num }) },
      novelty: num, niche: { type: "string", enum: nicheIds },
    }) } }),
    validate: Judged,
  }, options);
  return all.map((o) => {
    const row = result.data.options.find((r) => r.optionId === o.id)!;
    const niche = Object.fromEntries(nicheIds.map((n) => [n, n === row.niche ? 0.8 : 0.2 / (nicheIds.length - 1)]));
    return {
      optionId: o.id,
      baseline: o.id === baselineId,
      dims: Object.fromEntries(input.factors.map((f) => { const x = row.factors.find((s) => s.factorId === f.id)!; return [f.id, fromPoint(x.level, x.confidence)]; })),
      // A general model's probabilities are not calibrated either; the same Noul temperature is the honest default.
      violations: Object.fromEntries(limits.map((c) => [c.id, noulBelief(row.limits.find((s) => s.limitId === c.id)!.probability)])),
      novelty: fromPoint(row.novelty, 0.6),
      niche,
    };
  });
}

// --- The whole step ---------------------------------------------------------------------------------------------

/**
 * How long writing new paths may take before ORION judges the listed options without them. Production functions
 * stop at 60 s (scripts/vercel-output.sh), and judging still needs its share: Jev takes 1–7 s, a general model
 * up to the router's 45 s.
 */
export const DIVERGE_BUDGET_MS = 30_000;

/** The promise's value, or `fallback` once `ms` have passed. The late answer is ignored. */
function within<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); })])
    .finally(() => clearTimeout(timer));
}

export async function creativeWithAI(
  input: CreativeRequest,
  options: ProviderOptions & { typesafeKey?: string; divergeBudgetMs?: number },
  lang: Locale = "en",
): Promise<CreativeResponse> {
  const niches = APPROACHES;
  let paths: Path[] = [], own: Limit[] = [], baselineId = guessBaseline(input.options);
  if (input.paths > 0) {
    // No new paths in time, or none at all: still judge the listed ones, so check-first and the bold bet work on
    // what is there.
    const none = { paths: [] as Path[], limits: [] as Limit[], baselineId };
    const written = await within(divergeWithAI(input, options, lang).catch(() => none), options.divergeBudgetMs ?? DIVERGE_BUDGET_MS, () => none);
    ({ paths, limits: own, baselineId } = written);
  }
  const divergeFailed = input.paths > 0 && paths.length === 0;
  const limits = [...BASE_LIMITS, ...own];
  const all = [...input.options, ...paths.map((p) => ({ id: p.id, label: p.label, description: p.description }))];
  if (options.typesafeKey) {
    try {
      const judgments = await judgeWithJev(input, all, limits, niches, baselineId, { apiKey: options.typesafeKey, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs });
      return { paths, niches, limits, baselineId, judgments, judge: "typesafe", divergeFailed };
    } catch { /* fall through */ }
  }
  const judgments = await judgeWithAI(input, all, limits, niches, baselineId, options);
  return { paths, niches, limits, baselineId, judgments, judge: "ai", divergeFailed };
}
