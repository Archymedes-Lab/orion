import { z } from "zod";
import { DecisionExtractionSchema } from "../src/ai/schemas.ts";
import { SafetySchema, FactorScoreSchema, AftermathWordingSchema, ProvenanceSchema, ReversibilityLevelSchema, type AftermathRequest, type ExplanationRequest } from "../src/ai/contracts.ts";
import { classifySafety } from "../src/decision-engine/safety.ts";
import { uid } from "../src/decision-engine/normalize.ts";
import { CATEGORY_CRITERIA, factorScoreQuestion, scoreToValue, systemOne, type SystemOneQuestion } from "./typesafe.ts";
import { structured, type ProviderOptions } from "./providers.ts";
import { scoreAll } from "../src/decision-engine/uncertainty.ts";
import { sensitivity } from "../src/decision-engine/sensitivity.ts";
import { runScenarios } from "../src/decision-engine/scenarios.ts";
import { bestThingToLearn } from "../src/decision-engine/informationGain.ts";
import { explainLocal } from "../src/ai/explainDecision.ts";
import { aftermath, type Pace } from "../src/decision-engine/aftermath.ts";
import { PACES } from "../src/types.ts";
import { businessInstructions, businessState, isBusinessDecision, type BusinessProfile } from "./business.ts";
import { withLocale, type Locale } from "../src/i18n/index.ts";

/** The business addendum when the playbook applies (business mode, or a question that plainly is one), else nothing. */
const forBusiness = (task: Parameters<typeof businessInstructions>[0], text: string, profile?: BusinessProfile, lang: Locale = "en") =>
  isBusinessDecision(text, profile) ? businessInstructions(task, profile, lang) : "";

/**
 * The one rule each prompt gains when the person uses ORION in Korean: what they read is Korean, what code reads is
 * not. Empty in English, so English prompts stay exactly as they were. It goes last, after any business playbook,
 * so it is the rule the model sees freshest.
 */
const KOREAN = `

LANGUAGE: KOREAN
The person uses ORION in Korean. Write every user-facing text field (the title, option labels, factor labels, reasons,
questions, explanations, likely, goodTurn, hardTurn and any other sentence the person reads) in natural, warm Korean,
in polite 해요체 (for example "~해요", "~할 수 있어요", "~일 가능성이 높아요"), the way a Korean product writer would
write it, never word for word from English. Labels are short Korean noun phrases (for example "지금 회사에 남기",
"출퇴근 시간"). Address the person without overusing "당신". Keep JSON keys, ids and enum values (category, pace,
stakes, safety, generated and every other fixed value) exactly as the schema defines them, in English. Keep names,
numbers and anything the person typed exactly as they wrote it.`;

/** The language rule for a prompt, plus anything specific to the task. */
function languageRule(lang: Locale, extra = ""): string {
  return lang === "ko" ? `${KOREAN}${extra ? `\n${extra}` : ""}` : "";
}

// Basic JSON Schema subset supported by both providers. Zod enforces bounds
// and reference integrity after decoding; no provider confidence is calibrated.
const str = { type: "string" };
const num = { type: "number" };
const array = (items: unknown, opts?: { optional?: boolean }) => ({ type: "array", items, ...(opts?.optional ? {} : {}) });
const object = (properties: Record<string, unknown>, opts?: { optional?: boolean; required?: string[] }) => ({ type: "object", properties, required: opts?.required ?? Object.keys(properties), additionalProperties: false });
const enumeration = (values: readonly string[]) => ({ type: "string", enum: values });

/** Over-long text is cut to fit rather than costing a whole retry on another model. */
const text = (max: number) => z.string().trim().min(1).transform((s) => s.slice(0, max).trim());

const Extraction = z.object({
  title: text(120),
  // Small models often send one category as a string, or a name ORION does not use: keep the ones it knows.
  category: z.union([z.string().transform((c) => [c]), z.array(z.string())])
    .transform((list) => list.filter((c) => Object.prototype.hasOwnProperty.call(CATEGORY_CRITERIA, c)).slice(0, 3))
    .pipe(z.array(z.string()).min(1).max(3)),
  options: z.array(z.object({ 
    label: text(80),
    description: z.string().max(280).optional(),
    rationale: z.string().max(500).optional(),
    risks: z.array(z.string().max(200)).optional(),
    reversibilityLevel: ReversibilityLevelSchema.optional(),
    generated: z.boolean().optional(),
  })).min(2).max(4)
    .refine((options) => new Set(options.map((s) => s.label.toLowerCase())).size === options.length),
  factors: z.array(z.object({ 
    label: text(40), 
    importance: z.number().min(0).max(1), 
    reason: z.string().default("").transform((s) => s.slice(0, 200)),
    provenance: ProvenanceSchema.optional(),
    source: z.string().optional(),
    // A wrong or missing pace is not worth failing the parse over: the label's keywords stand in.
    pace: z.enum(PACES).optional().catch(undefined),
  }))
    .min(1).max(8).refine((factors) => factors.some((f) => f.importance > 0))
    .refine((factors) => new Set(factors.map((f) => f.label.toLowerCase())).size === factors.length),
  missingInformation: z.array(z.object({ question: text(200), expectedInformationGain: z.number().min(0).max(1) })).transform((q) => q.slice(0, 3)),
  stakes: z.enum(["tiny", "normal", "significant", "major"]), 
  safety: SafetySchema,
  provenance: z.object({
    options: z.record(ProvenanceSchema).optional(),
    factors: z.record(ProvenanceSchema).optional(),
    stakes: ProvenanceSchema.optional(),
    category: ProvenanceSchema.optional(),
  }).optional(),
  obligations: z.array(z.object({
    id: z.string(),
    description: z.string().min(1).max(200),
    type: z.enum(["need", "constraint", "preference"]),
    provenance: ProvenanceSchema,
  })).optional(),
  generatedOptions: z.array(z.object({
    id: z.string(),
    label: z.string().min(1).max(80),
    rationale: z.string().max(500),
    assumptions: z.array(z.string().max(200)),
    risks: z.array(z.string().max(200)),
    reversibility: ReversibilityLevelSchema,
    requiredResources: z.string().max(200),
  })).optional(),
});

export async function parseWithAI(input: string, providerOptions: ProviderOptions = {}, business?: BusinessProfile, lang: Locale = "en") {
  const businessRules = forBusiness("parse", input, business, lang);
  const result = await structured({ task: "parse", input, business: businessRules !== "",
    // Lean on purpose (measured 2026-10-11): the full model (rationale, risks, provenance, obligations) ran to ~3,000
    // characters and most free models got some part of its shape wrong, so a parse took two or three failed attempts.
    // The answer needs only what is asked here; the detailed analysis words the rest itself.
    instructions: "Extract the user's decision faithfully into 2–4 distinct options (include doing nothing when implied; if the user names no options, suggest the most sensible ones and mark them generated: true) and 1–8 factors that matter. Never invent biographical facts. Title ≤120 chars, option labels ≤80, factor labels ≤40, reasons ≤80. Importance 0–1, at least one positive. For each factor, pace: how its effect plays out after choosing — fast (felt at once and stays: costs, conveniences, commute), fading (felt at once then fades: the strain of a change), adapting (felt at once then people get used to it: pleasures, novelty), slow (builds over months: health, relationships, growth), compounding (grows on itself for years: income, savings, skills, reputation), steady (none of these). Up to 3 missingInformation questions, ≤200 chars each, ONLY asking which listed factor matters most; none if unnecessary. Determine stakes and safety; crisis/dangerous routes must not be scored. No winner or recommendation." + businessRules +
      languageRule(lang, "The title, every option label, factor label, reason and missingInformation question is Korean. Doing nothing is \"지금처럼 지내기\" or the person's own words."),
    schema: object({
      title: str,
      category: array(enumeration(Object.keys(CATEGORY_CRITERIA))),
      options: array(object({ label: str, generated: { type: "boolean" } })),
      factors: array(object({ label: str, importance: num, reason: str, pace: enumeration(PACES) })),
      missingInformation: array(object({ question: str, expectedInformationGain: num })),
      stakes: enumeration(["tiny", "normal", "significant", "major"]),
      safety: enumeration(SafetySchema.options),
    }), validate: Extraction,
  }, providerOptions);
  const { safety, ...data } = result.data;
  // Models like to label the title ("Decision: …"); the page already says what it is.
  data.title = data.title.replace(/^(?:decision|question|choice|dilemma|결정|질문|선택|고민)\s*[:\-–]\s*/i, "").replace(/^./, (c) => c.toUpperCase()) || data.title;
  // Business mode files the decision under Business whatever the model said, so History and Insights can tell them apart.
  if (business && !data.category.includes("Business")) data.category = ["Business", ...data.category].slice(0, 3);
  const localSafety = classifySafety(input);
  // A local domain/crisis flag cannot be downgraded by a model. A model can
  // escalate normal/domain input to a crisis or dangerous support path.
  const effectiveSafety = localSafety === "crisis" || localSafety === "dangerous" ? localSafety :
    safety === "crisis" || safety === "dangerous" || localSafety === "normal" ? safety : localSafety;
  
  // Build options with all new fields
  const builtOptions = data.options.map((opt) => ({
    id: uid("opt"),
    label: opt.label,
    description: opt.description,
    rationale: opt.rationale,
    risks: opt.risks ?? [],
    reversibilityLevel: opt.reversibilityLevel,
    generated: opt.generated ?? false,
  }));
  
  // Build factors with new fields
  const builtFactors = data.factors.map((f) => ({
    id: uid("fac"),
    label: f.label,
    importance: f.importance,
    reason: f.reason,
    provenance: f.provenance,
    source: f.source,
    pace: f.pace,
  }));
  
  return { ...DecisionExtractionSchema.parse({ ...data,
    options: builtOptions,
    factors: builtFactors,
    provenance: data.provenance,
    obligations: data.obligations,
    generatedOptions: data.generatedOptions,
  }), safety: effectiveSafety, fallback: false, ai: result.ai };
}

type ScoreInput = { context: string; stakes: string; options: { id: string; label: string }[]; factors: { id: string; label: string }[]; business?: BusinessProfile };

export async function scoreWithAI(input: ScoreInput, options: ProviderOptions = {}, lang: Locale = "en") {
  const businessRules = forBusiness("score", input.context, input.business, lang);
  const expected = new Set(input.options.flatMap((o) => input.factors.map((f) => JSON.stringify([o.id, f.id]))));
  const Scores = z.object({ scores: z.array(FactorScoreSchema).max(32) }).refine(({ scores }) =>
    scores.length === expected.size && new Set(scores.map((s) => JSON.stringify([s.optionId, s.factorId]))).size === expected.size &&
    scores.every((s) => expected.has(JSON.stringify([s.optionId, s.factorId]))), "Incomplete or unknown score references");
  const result = await structured({ task: "score", input, business: businessRules !== "",
    instructions: "Estimate each option's expected impact on EACH factor in the decision context. Return every optionId × factorId pair exactly once. value −10..10: negative = harmful to the user's factor, positive = helpful (for Cost, cheaper is positive). probabilityConfidence 0..1 is subjective confidence in the estimate, NOT probability of success; missing context lowers confidence, unknown impacts are 0 with confidence ≤0.2. Never infer personal facts, guarantee an outcome, give medical/legal/financial instructions, invent source-backed claims, weight factors, or pick a winner. For significant/major stakes be conservative about unknowns." + businessRules +
      languageRule(lang, "The decision, options and factors may be written in Korean; read them as they are. Copy optionId and factorId exactly."),
    schema: object({ scores: array(object({ optionId: str, factorId: str, value: num, probabilityConfidence: num })) }), validate: Scores,
  }, options);
  return { ...result.data, ai: result.ai };
}

/**
 * Jev scores every option × factor in ONE request (independent Score questions over the same decision).
 * Score 0–4 maps to −10..10 and Jev's confidence becomes probabilityConfidence; code owns the weights and JEV.
 * It takes no language: its typed questions stay in English and it returns numbers only, so nothing it says reaches the
 * person. Korean option and factor labels are read as they are.
 */
export async function scoreWithJev(
  input: ScoreInput,
  options: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }
) {
  const questions: Record<string, SystemOneQuestion> = {};
  const pairs: { key: string; optionId: string; factorId: string }[] = [];
  input.options.forEach((o, i) => input.factors.forEach((f, j) => {
    const key = `s_${i}_${j}`;
    questions[key] = factorScoreQuestion(o.label, f.label);
    pairs.push({ key, optionId: o.id, factorId: f.id });
  }));
  const state = isBusinessDecision(input.context, input.business)
    ? { decision: input.context, stakes: input.stakes, ...businessState(input.business) }
    : { decision: input.context, stakes: input.stakes };
  const response = await systemOne(state, questions, { ...options, timeoutMs: options.timeoutMs ?? 20_000 });
  const scores = pairs.map(({ key, optionId, factorId }) => {
    const answer = response.answers[key];
    if (!answer || answer.type !== "score") throw new Error("Incomplete Jev scores");
    return FactorScoreSchema.parse({
      optionId, factorId,
      value: scoreToValue(answer.score),
      probabilityConfidence: Math.max(0, Math.min(1, answer.confidence)),
    });
  });
  return { scores, ai: { provider: "typesafe" as const, model: response.model } };
}

export async function triageWithAI(input: { context: string; candidates: string[]; budget: number; business?: BusinessProfile }, options: ProviderOptions = {}, lang: Locale = "en") {
  const result = await structured({ task: "triage", input,
    instructions: "Keep only follow-up questions whose answer could materially change factor priorities or the comparison. Copy candidate text exactly. No new questions or duplicates. Keep at most budget questions. Return an empty keep array if none are useful." + forBusiness("triage", input.context, input.business, lang) +
      languageRule(lang, "The candidates are already Korean: copy each kept candidate character for character, never translate, shorten or reword it."),
    schema: object({ keep: array(str) }), validate: z.object({ keep: z.array(z.string()).max(input.budget) })
      .refine(({ keep }) => new Set(keep).size === keep.length && keep.every((q) => input.candidates.includes(q))),
  }, options);
  return { ...result.data, ai: result.ai };
}

/** The engine's reading of the comparison. Its sentences (the flip, what to learn next) are in the current language. */
export function explanationSummary(input: ExplanationRequest) {
  const scored = scoreAll(input.options, input.factors).sort((a, b) => b.jev - a.jev);
  const sens = sensitivity(input.options, input.factors);
  const scenarios = runScenarios(input.options, input.factors);
  return {
    leaderLabel: input.options.find((o) => o.id === scored[0].optionId)!.label, leaderJev: scored[0].jev,
    runnerLabel: input.options.find((o) => o.id === scored[1].optionId)!.label, runnerJev: scored[1].jev,
    topFactors: sens.dominantFactors, flipNote: sens.flips[0]?.description ?? "",
    nextAction: bestThingToLearn(input.options, input.factors), stability: scenarios.stability,
  };
}

export async function explainWithAI(input: ExplanationRequest, options: ProviderOptions = {}, lang: Locale = "en") {
  // The engine writes in the person's language; nothing inside awaits, so the language cannot leak to another request.
  const { summary, canonical } = withLocale(lang, () => {
    const summary = explanationSummary(input);
    return { summary, canonical: explainLocal(summary) };
  });
  // Explanations carry no question text: only an explicit business request switches the playbook on.
  const businessRules = input.business ? businessInstructions("explain", input.business, lang) : "";
  const result = await structured({ task: "explain", input: { summary, factors: input.factors, safety: input.safety }, business: businessRules !== "",
    instructions: "Write 2–4 short sentences (≤1400 chars) explaining the supplied deterministic trade-offs and uncertainty in plain language. No new winner, recalculated numbers, new facts, professional advice, guarantees, or commands to choose. If scores tie, explicitly preserve the tie. Clarify that estimates are subjective. Focus on the factor impacts and what information might change the comparison. Return tradeoffs only; code provides the authoritative result." + businessRules +
      languageRule(lang, "tradeoffs is 2–4 short Korean sentences. A tie is described as 우열을 가리기 어려워요."),
    schema: object({ tradeoffs: str }), validate: z.object({ tradeoffs: z.string().trim().min(1).max(1400) }),
  }, options);
  return { explanation: `${canonical}\n\n${result.data.tradeoffs}`, fallback: false, ai: result.ai };
}

/** How a factor stands at a moment, in words the wording model can reason with. */
function trend(pace: Pace, felt: number, days: number): string {
  if (pace === "compounding") return felt > 1.05 ? "compounding past the first estimate" : "still building, will compound";
  if (pace === "fading") return felt >= 0.95 ? "felt in full now, will fade" : felt > 0.5 ? "easing" : "mostly faded";
  if (pace === "adapting") return felt > 0.85 ? "felt in full, novelty still fresh" : "settling as you get used to it";
  if (pace === "fast") return "felt at once and stays";
  return felt >= 0.95 ? "fully felt" : days < 60 ? "only beginning" : "still building";
}

/** Phrases from the examples above; an answer that reuses them copied instead of picturing this decision. */
const COPIED = /smaller pay cheque|anchor of your day|who looks after the dog|word of mouth probably does|quietly adding up, while keeping old friendships/i;
const ECHO = /\b(?:is|are) (?:better|worse|about the same)\b|felt in full now|still building|compounding past the first estimate|will fade|only beginning\b|felt at once and stays|novelty still fresh/i;

// Long horizons are where general models go vague or melodramatic. These rules and examples are how ORION's wording
// model is taught to see years out: what changes with time, what to say, and what never to invent.
const LONG_RANGE = `
SEEING FAR AHEAD
Steps run from the first days to years out; each has daysAfter and horizon ("near" up to six months, "far" from a year).
How life (or a company) changes with time, and how to write each horizon:
- First days and weeks: the friction of the change itself dominates (logistics, effort, uncertainty, missing the old
  routine). Gains that build slowly are barely visible yet; say so.
- One to six months: a new routine forms. Early strain eases; pleasures and novelty start to feel normal (people adapt);
  slow gains begin to show in small, concrete ways. Name what the new normal looks like.
- One year: judge by the slow effects, not the early friction. Describe how daily life has reorganised around the
  choice, and what has become hard to undo.
- Three to five years: compounding effects (money, skills, reputation, network) have had time to grow past their first
  size; relationships and health have drifted in a direction; the path not taken has moved on too, so some doors it
  offered are now closed or harder to reopen. Write about trajectory and identity ("the kind of life or work you now
  have"), not events. Be more tentative the further out you go.
Each factor comes with a direction and a trend ("easing", "settling", "still building", "compounding past the first
estimate"…). They are for your reasoning only: NEVER quote them, and never write "is better", "is worse" or a factor
name followed by a status. Translate them into lived experience: what the person (or the company) actually notices
that day. A fading cost must read as receding, a compounding gain as growing on itself.
Good and hard turns at far horizons are about direction: a gain that kept compounding, or one that plateaued; a cost
that stayed small, or one that quietly grew. Never repeat an earlier step's wording; each moment must feel different.
Examples of the register, from unrelated decisions (illustrative only; never copy or adapt their wording):
- Going part-time to study; daysAfter 7, money worse, felt at once and stays; energy worse, felt in full now, will
  fade: "Most likely the smaller pay cheque is the first thing you notice, and juggling classes with work leaves
  evenings short while you find a rhythm."
- Adopting a dog; daysAfter 365, routine better, fully felt; travel freedom worse, fully felt: "A year in, the morning
  walks have likely become the anchor of your day, while trips now take planning around who looks after the dog."
- Opening a bakery; daysAfter 1825, reputation better, compounding past the first estimate; time off worse, fully
  felt: "Five years on, word of mouth probably does much of your marketing, though long weekends may still be rare."`.trim();

/**
 * The aftermath picture in natural language. The server recomputes the picture from the model, so the steps, the factors
 * each step features and the odds are ORION's; the model only words what happens. Null when there is nothing to picture.
 */
export async function aftermathWithAI(input: AftermathRequest, options: ProviderOptions = {}, lang: Locale = "en") {
  const picture = withLocale(lang, () => aftermath({ ...input, signal: true }));
  if (!picture) return null;
  const steps = picture.steps.map((s) => ({
    when: s.when,
    daysAfter: s.days,
    horizon: s.horizon,
    shows: s.featured.map((f) => ({
      factor: f.label,
      direction: f.value > 0.5 ? "better" : f.value < -0.5 ? "worse" : "about the same",
      trend: trend(f.pace, f.felt, s.days),
    })),
    odds: { goesWell: Math.round(s.odds.well * 100) + "%", mixed: Math.round(s.odds.mixed * 100) + "%", goesBadly: Math.round(s.odds.hard * 100) + "%" },
  }));
  const count = steps.length;
  const result = await structured({ task: "aftermath", input: { decision: input.title, choice: picture.optionLabel, steps, safety: input.safety },
    instructions: `Picture, in plain warm language, what plausibly follows from making this choice, one entry per supplied step, in order (exactly ${count}). For each step write: likely (≤220 chars, what most plausibly happens by then, in lived terms: cover EVERY factor listed for that step, each in its listed direction and trend — a "worse" factor must read as a cost or strain — and nothing else; never say "than expected" here), goodTurn (≤120 chars, one concrete way it goes better than expected by then), hardTurn (≤120 chars, one concrete way it goes worse by then). Second person ("you"). Concrete, everyday, specific to the decision, but never invent personal facts, names, places, numbers, dates, money amounts, or percentages; never restate or change the odds. No guarantees, no advice to switch or stay, no medical/legal/financial instructions. Hedge: "likely", "may", "could", more so further out. Every step needs its own goodTurn and hardTurn; never repeat one across steps.\n\n${LONG_RANGE}` + forBusiness("aftermath", input.title, input.business, lang) +
      languageRule(lang, "likely, goodTurn and hardTurn are Korean sentences. The examples above are English only to show the register; write fresh Korean, never a translation of them. Hedge in Korean (\"~할 가능성이 높아요\", \"~할 수도 있어요\"), more so further out."),
    schema: object({ steps: array(object({ likely: str, goodTurn: str, hardTurn: str })) }),
    validate: AftermathWordingSchema.refine((w) => w.steps.length === count, "One entry per step")
      // Free models like to echo the input's labels back ("Income is better and still building"); that reads as a
      // report, not a picture. Reject it so the router tries another model.
      .refine((w) => !w.steps.some((x) => ECHO.test(x.likely)), "Echoed the input's labels")
      .refine((w) => !w.steps.some((x) => COPIED.test(`${x.likely} ${x.goodTurn} ${x.hardTurn}`)), "Copied an example"),
  }, options);
  const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return { steps: result.data.steps.map((x) => ({ likely: capital(x.likely), goodTurn: capital(x.goodTurn), hardTurn: capital(x.hardTurn) })), ai: result.ai };
}
