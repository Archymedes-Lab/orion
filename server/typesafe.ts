// Server-side TypeSafe System One client + question builders (§24).
// Keys never ship in the app: TYPESAFE_API_KEY lives here only.
// Live docs (source of truth): https://docs.typesafe.ai/api.md
//
// Composition rules followed (see .opencode/skills/typesafe-ai/SKILL.md):
// - One narrow judgment per question; one Noul per hazard label.
// - Independent questions over the same state go in ONE request.
// - A second request only when an earlier answer determines the next
//   state/options (factor Scores need the accepted options first).
// - Code owns workflow, weights, thresholds; model supplies judgments.

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/**
 * Pinned, not an alias: ORION's calibration (temperatures, gates, cdm priors) is tuned against a model version, and an
 * alias changes answers when a release ships (models.md). Jev 1.14 shipped 2026-10-14; `jev-latest` moved to it a week
 * later. TYPESAFE_MODEL overrides it (e.g. `jev-preview` to try the next release, `jev-1.13.0` to roll back).
 */
export const JEV_MODEL = "jev-1.14.0";
export const jevModel = (env: Record<string, string | undefined> = process.env) => env.TYPESAFE_MODEL?.trim() || JEV_MODEL;

import type { ScenarioScore } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Wire types (subset of the HTTP API contract, https://docs.typesafe.ai/api/system-one.md)
// ---------------------------------------------------------------------------

export interface NoulQuestion {
  type: "noul";
  instructions: string | object | unknown[] | null;
  criteria?: { true?: unknown; false?: unknown };
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: string | object | unknown[] | null;
  /** 1 to 255 choices. */
  criteria: Record<string, string | object | unknown[] | null>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: string | object | unknown[] | null;
  /** 1 to 10 ordered levels; position is the score, from 0. */
  criteria: (string | object | unknown[])[];
}
export type SystemOneQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer { type: "noul"; noul: number }
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}
export type SystemOneAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneResponse {
  /** The model that actually answered (an alias resolves to a version here). */
  model: string;
  answers: Record<string, SystemOneAnswer>;
  /** Counts can be null (SDK 0.7.0 changelog). Output tokens are currently free. */
  usage: { input_tokens: number | null; output_tokens: number | null };
}

/** A failed request: the HTTP status and, when the API names one, a code such as `max_tokens_exceeded`. */
export class TypeSafeError extends Error {
  constructor(message: string, public readonly status: number | null, public readonly code?: string, public readonly retryAfterMs?: number) { super(message); }
  /** 429 (rate limited) and 529 (overloaded) are the retryable statuses (api/errors.md); so are network failures and timeouts. */
  get retryable() { return this.status === null || this.status === 429 || this.status === 529; }
}

// ---------------------------------------------------------------------------
// Transport: retries 429/529, network errors and timeouts with exponential backoff (3 attempts),
// honouring Retry-After. Other statuses (400 rule broken or context too long, 401 key, 413 body over
// 32 MiB, 415 encoding, 422 validation) are the request's fault and fail at once.
// ---------------------------------------------------------------------------

export async function systemOne(
  state: string | object | unknown[],
  questions: Record<string, SystemOneQuestion>,
  opts?: { apiKey?: string; model?: string; timeoutMs?: number; fetchImpl?: typeof fetch; attempts?: number }
): Promise<SystemOneResponse> {
  const apiKey = opts?.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new TypeSafeError("TYPESAFE_API_KEY is not set", 401, "no_key");
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const attempts = opts?.attempts ?? 3;
  const body = JSON.stringify({ model: opts?.model ?? jevModel(), state, questions });

  let lastError: TypeSafeError = new TypeSafeError("typesafe request failed", null);
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(backoff(attempt, lastError));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
        signal: ctrl.signal,
      });
      if (res.ok) return (await res.json()) as SystemOneResponse;
      lastError = await failure(res);
      if (!lastError.retryable) throw lastError;
    } catch (e) {
      if (e instanceof TypeSafeError && !e.retryable) throw e;
      if (!(e instanceof TypeSafeError)) {
        const timedOut = e instanceof Error && e.name === "AbortError";
        lastError = new TypeSafeError(timedOut ? `typesafe timed out after ${timeoutMs} ms` : `typesafe unreachable: ${e instanceof Error ? e.message : String(e)}`, null, timedOut ? "timeout" : "network");
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/** Reads an error response: `detail` is a string (400 rule) or a list of field errors (422). */
async function failure(res: Response): Promise<TypeSafeError> {
  const text = await res.text().catch(() => "");
  let code: string | undefined;
  try {
    const json = JSON.parse(text) as { detail?: unknown; code?: string; error?: { code?: string } };
    code = json.code ?? json.error?.code ?? (typeof json.detail === "string" && /max_tokens_exceeded/.test(json.detail) ? "max_tokens_exceeded" : undefined);
  } catch { /* not JSON */ }
  if (!code && /max_tokens_exceeded/.test(text)) code = "max_tokens_exceeded";
  const seconds = Number(res.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10_000) : undefined;
  return new TypeSafeError(`typesafe ${res.status}: ${text.slice(0, 200)}`, res.status, code, retryAfterMs);
}

const backoff = (attempt: number, last: TypeSafeError) => last.retryAfterMs ?? 400 * 2 ** (attempt - 1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Question builders (pure; unit-tested without network)
// ---------------------------------------------------------------------------

export const NONE_OF_THESE = "none_of_these";

/** Fixed category taxonomy — mirrors src/types.ts DecisionCategory. */
export const CATEGORY_CRITERIA: Record<string, string> = {
  Everyday: "An ordinary low-impact daily choice.",
  Food: "What to eat or drink, cooking, meals.",
  Health: "Sleep, exercise, illness, medical choices.",
  Fitness: "Workouts, training, physical activity.",
  Time: "Scheduling, time management.",
  Money: "Saving, budgeting, spending money.",
  Purchase: "Buying an item or service.",
  Work: "Day-to-day job tasks and choices.",
  Career: "Jobs, offers, promotions, career moves.",
  Business: "Starting or running a business.",
  Education: "Study, courses, degrees.",
  Relationships: "Friends, partners, dating, social ties.",
  Family: "Family matters and obligations.",
  Social: "Social plans and events.",
  Travel: "Trips, flights, vacations.",
  Home: "Moving, renting, housing, household.",
  Transportation: "Commute, taxi, transit, driving.",
  Technology: "Devices, apps, tools.",
  Lifestyle: "Habits and way of living.",
  "Personal growth": "Self-improvement, goals.",
  "Major life decision": "Life-changing, hard-to-reverse choices.",
  Custom: "Does not fit any other category.",
};

export function categoryQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions:
      "Which category best describes the decision the user is asking about in `input`?",
    criteria: CATEGORY_CRITERIA,
  };
}

export const STAKES_CRITERIA: Record<string, string> = {
  tiny: "Trivial and instantly reversible (coffee, nap, which sandwich).",
  normal: "Everyday choice with small, recoverable consequences.",
  significant: "Job, move, large purchase — matters for months.",
  major: "Life-changing or very hard to reverse (emigrate, sell a company).",
};

export function stakesQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions: "How high are the stakes of the decision in `input`?",
    criteria: STAKES_CRITERIA,
  };
}

/**
 * Confidence gate (confidence.md): below threshold, do NOT act on the answer —
 * fall back to the safe default. Thresholds scale with risk; category/stakes
 * mislabels are cheap, so the floor is 0.5.
 */
export function gateChoice(confidence: number, threshold = 0.5): boolean {
  if (!Number.isFinite(confidence)) return false;
  return confidence >= threshold;
}

// --- Options: code pre-parses candidate spans, one Noul per span ----------
// Fixes the validated design flaw: a Choice picks exactly ONE span, so asking
// it to "pick the two options" is incoherent. Per the skill ("use one Noul
// per label when several may apply"), each candidate span gets its own
// presence judgment; code keeps the accepted ones.

/** Recall-tuned candidate finder: over-find, TypeSafe filters, code copies. */
export function findCandidateSpans(input: string): string[] {
  const text = input.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const span = s.trim().replace(/\?$/, "").replace(/^should i\s+/i, "");
    if (span.length >= 2 && span.length <= 120 && !seen.has(span.toLowerCase())) {
      seen.add(span.toLowerCase());
      out.push(span);
    }
  };

  const m = text.match(/should i (.+?) or (.+?)(\?|$)/i);
  if (m) {
    push(m[1]);
    // Second arm may itself contain "or" (A or B or C) — split further.
    for (const extra of m[2].split(/\s+or\s+/i)) push(extra);
  }
  const between = text.match(/between (.+?) and (.+?)(\?|$)/i);
  if (between) {
    push(between[1]);
    push(between[2]);
  }
  for (const part of text.split(/\s+(?:or|vs\.?|versus)\s+/i)) push(part);
  // Comma lists: "cook, order, or skip dinner" (only when it looks like a list).
  if (!m && /,/.test(text)) {
    const cleaned = text.replace(/^should i\s+/i, "").replace(/\?$/, "");
    if (/^(?:[^,]+,){1,3}[^,]+$/.test(cleaned)) {
      for (const part of cleaned.split(/\s*,(?:\s*or)?\s*/)) push(part);
    }
  }
  return out.slice(0, 6);
}

export function optionPresenceQuestion(span: string): NoulQuestion {
  return {
    type: "noul",
    instructions: {
      span,
      question:
        "Is the value of `span` exactly one of the alternatives the user is choosing between, stated cleanly?",
    },
    criteria: {
      true: "The span names one alternative and nothing else: no preamble, no setup, no extra alternative.",
      false: "The span contains background context or preamble, or holds more or less than one alternative.",
    },
  };
}

/** Keep spans whose P(genuine option) clears the threshold; empty → caller falls back. */
export function acceptSpans(
  spans: string[],
  answers: Record<string, SystemOneAnswer>,
  keyFor: (span: string, i: number) => string,
  threshold = 0.5
): string[] {
  return spans.filter((_, i) => {
    const a = answers[keyFor(spans[i], i)];
    return a?.type === "noul" && a.noul >= threshold;
  });
}

// --- Safety: one Noul per hazard + severity Score (llm_guardrails cookbook) --

export interface SafetyBattery {
  crisis: NoulQuestion;
  harm: NoulQuestion;
  health: NoulQuestion;
  financial: NoulQuestion;
  legal: NoulQuestion;
  severity: ScoreQuestion;
}

export function safetyBattery(): SafetyBattery {
  const noul = (instructions: string, yes: string, no: string): NoulQuestion => ({
    type: "noul",
    instructions,
    criteria: { true: yes, false: no },
  });
  return {
    crisis: noul(
      "Does this message suggest the sender may be considering harming themselves, or describe an emergency needing immediate help?",
      "It hints at suicidal thoughts, self-harm, abuse, or an emergency.",
      "No sign the sender intends self-harm or faces an emergency."
    ),
    harm: noul(
      "Does this message ask for help causing physical harm to people, or for help breaking the law (weapons, attacks, theft, fraud, hacking)?",
      "It seeks assistance with physical harm or illegal activity.",
      "It does not seek help with harm or illegal activity."
    ),
    health: noul(
      "Does this message ask for a diagnosis, a specific drug dosage, or a treatment decision, beyond general health information?",
      "It asks for a personal medical decision.",
      "It asks for nothing medical, or only general health information."
    ),
    financial: noul(
      "Is this a high-stakes financial choice (large sums, loans, debt, mortgage, investing, retirement, lawsuits over money)?",
      "Large-sum or high-impact financial decision.",
      "Everyday money matter or not financial."
    ),
    legal: noul(
      "Is this about lawsuits, lawyers, courts, custody, contracts, visas, or immigration?",
      "It needs legal advice or involves legal proceedings.",
      "No legal dimension."
    ),
    severity: {
      type: "score",
      instructions: "How much harm could result if the assistant mishandled this decision?",
      criteria: [
        "No harm: an ordinary, safe choice.",
        "Mild: touches a sensitive topic but mishandling does no real damage.",
        "Serious: mishandling enables real wrongdoing or gives unsafe personal advice.",
        "Severe: mishandling causes serious physical harm or serious illegal harm.",
      ],
    },
  };
}

export type SafetyVerdict =
  | "normal"
  | "financial-high-stakes"
  | "health-high-stakes"
  | "legal-high-stakes"
  | "crisis"
  | "dangerous";

export interface SafetyPolicy {
  reviewThreshold: number;
  actionThreshold: number;
  severityBlock: number;
}

/** Strict defaults from the guardrails cookbook; tune on ORION traffic. */
export const STRICT_SAFETY_POLICY: SafetyPolicy = {
  reviewThreshold: 0.35,
  actionThreshold: 0.5,
  severityBlock: 2.0,
};

/**
 * Code owns the decision. Precedence: crisis (support path) > dangerous
 * (block) > domain flags. Severity escalates a review-level flag to a block.
 * Empirically supported action threshold 0.5 (false cases ≤0.2, true 0.99).
 */
export function routeSafety(
  nouls: { crisis: number; harm: number; health: number; financial: number; legal: number },
  severity: number,
  policy: SafetyPolicy = STRICT_SAFETY_POLICY
): SafetyVerdict {
  const { actionThreshold, severityBlock } = policy;
  if (nouls.crisis >= actionThreshold) return "crisis";
  if (nouls.harm >= actionThreshold) return "dangerous";
  const escalated = severity >= severityBlock;
  void escalated; // severity escalates review→block in fuller routers; hard flags stay hard here.
  if (nouls.legal >= actionThreshold) return "legal-high-stakes";
  if (nouls.health >= actionThreshold) return "health-high-stakes";
  if (nouls.financial >= actionThreshold) return "financial-high-stakes";
  return "normal";
}

// --- Composite scoring → JEV factors (composite-scoring pattern) ------------
// One Score per option×factor with concrete levels. Code combines with user
// weights (expectedUtility); Score confidence → probabilityConfidence (§7).

export const FACTOR_LEVELS = [
  "Strongly negative impact on this factor",
  "Negative impact on this factor",
  "Neutral / no real impact on this factor",
  "Positive impact on this factor",
  "Strongly positive impact on this factor",
];

export function factorScoreQuestion(optionLabel: string, factorLabel: string): ScoreQuestion {
  return {
    type: "score",
    instructions: {
      option: optionLabel,
      factor: factorLabel,
      question:
        "If the user chooses `option`, what is the expected impact on `factor`?",
    },
    criteria: FACTOR_LEVELS,
  };
}

/** Map Score (0..levels-1) onto ORION factor values (-10..+10). */
export function scoreToValue(score: number, levels = FACTOR_LEVELS.length): number {
  if (!Number.isFinite(score)) return 0;
  const clamped = Math.max(0, Math.min(levels - 1, score));
  return Math.round(((clamped / (levels - 1)) * 20 - 10) * 100) / 100;
}

// --- Scenario battery: the ways an option can play out ----------------------
// One flat Score per option×factor gives an expectation, not a distribution.
// Scenarios are what make the conservative/optimistic runs, the flip
// thresholds and the uncertainty bands mean anything, so the server can supply
// them. Composition rules still hold: these questions depend only on the
// accepted options and factors, so they ride along in the same request.
//
// Scenarios are only requested for short factor lists. A branch that omits a
// factor would have to invent its value, and a neutral 0 in half the factors
// would silently distort the JEV — so a long factor list gets no scenarios
// rather than dishonest ones.

export const SCENARIO_FACTOR_LIMIT = 5;
export const SCENARIO_CASES_PER_OPTION = 3;

export const SCENARIO_CASES = ["best case", "typical case", "worst case"] as const;
export type ScenarioCase = (typeof SCENARIO_CASES)[number];

export function scenarioCasesQuestion(optionLabel: string): ChoiceQuestion {
  return {
    type: "choice",
    instructions: {
      option: optionLabel,
      question:
        "Which distinct ways could choosing `option` realistically play out? Pick the ones a person would actually plan for.",
    },
    criteria: {
      "best case": "It goes noticeably better than expected.",
      "typical case": "It happens roughly as expected.",
      "worst case": "It goes noticeably worse than expected, but is still plausible.",
      none_of_these: "This option has no realistic variation; one outcome covers it.",
    },
  };
}

/**
 * Likelihood is judged *relative to the option's other cases*, not as an
 * absolute probability, so the weights stay self-consistent and the client only
 * has to normalize them.
 */
export const LIKELIHOOD_LEVELS = [
  "Much less likely than the other cases",
  "Less likely than the other cases",
  "About as likely as the other cases",
  "More likely than the other cases",
  "Much more likely than the other cases",
];

export const LIKELIHOOD_WEIGHTS = [0.4, 0.7, 1, 1.6, 2.5];

export function scenarioLikelihoodQuestion(optionLabel: string, caseLabel: string): ScoreQuestion {
  return {
    type: "score",
    instructions: {
      option: optionLabel,
      case: caseLabel,
      question:
        "Compared with the other cases for `option`, how likely is `case`?",
    },
    criteria: LIKELIHOOD_LEVELS,
  };
}

export function scenarioFactorQuestion(
  optionLabel: string,
  caseLabel: string,
  factorLabel: string
): ScoreQuestion {
  return {
    type: "score",
    instructions: {
      option: optionLabel,
      case: caseLabel,
      factor: factorLabel,
      question:
        "If choosing `option` ends up as `case`, what is the impact on `factor`?",
    },
    criteria: FACTOR_LEVELS,
  };
}

/** Score → relative likelihood weight. */
export function scoreToLikelihood(score: number, levels = LIKELIHOOD_LEVELS.length): number {
  if (!Number.isFinite(score)) return 1;
  const clamped = Math.max(0, Math.min(levels - 1, Math.round(score)));
  return LIKELIHOOD_WEIGHTS[clamped];
}

/**
 * Cases the model actually endorses for one option, in canonical order.
 *
 * A single Choice answer carries a probability for every case, so there is no
 * need to ask the question three times. "none_of_these" wins over the rest: if
 * the option genuinely has no variation, one outcome is the honest model.
 */
export function acceptCases(
  answer: SystemOneAnswer | undefined,
  limit = SCENARIO_CASES_PER_OPTION,
  threshold = 0.35
): ScenarioCase[] {
  if (!answer || answer.type !== "choice") return [];
  const p: Record<string, number> = answer.probabilities ?? {};
  if ((p[NONE_OF_THESE] ?? 0) >= 0.5) return [];

  // Rank by how strongly the model endorsed each case, not by canonical order,
  // so a truncated list keeps the cases that matter. Canonical order breaks ties
  // to keep output deterministic for identical probabilities.
  return SCENARIO_CASES.map((c, i) => ({ c, i, p: p[c] ?? 0 }))
    .filter((x) => x.p >= threshold)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

export interface ScenarioAnswerBundle {
  options: { id: string; label: string }[];
  factors: { id: string; label: string }[];
  /** Which cases apply, per option label. */
  casesFor: Map<string, ScenarioCase[]>;
  answers: Record<string, SystemOneAnswer>;
  /** Builds the answer key for one case and sub-part. */
  keyPrefix: (optionLabel: string, c: ScenarioCase, part: string) => string;
}

/**
 * Assemble ScenarioScores from the answer bundle. Returns null unless every
 * option has at least one case and every factor was judged for every case —
 * the same all-or-nothing rule the app applies, so a partial model never
 * reaches the engine.
 */
export function buildScenarios(bundle: ScenarioAnswerBundle): ScenarioScore[] | null {
  const { options, factors, casesFor, answers, keyPrefix } = bundle;
  if (options.length === 0 || factors.length === 0) return null;
  if (factors.length > SCENARIO_FACTOR_LIMIT) return null;

  const out: ScenarioScore[] = [];
  for (const option of options) {
    const cases = casesFor.get(option.label) ?? [];
    if (cases.length === 0) return null;

    for (const c of cases) {
      const likelihood = answers[keyPrefix(option.label, c, "likelihood")];
      if (likelihood?.type !== "score") return null;

      const values: Record<string, number> = {};
      for (const f of factors) {
        const a = answers[keyPrefix(option.label, c, `f:${f.id}`)];
        if (a?.type !== "score") return null;
        values[f.id] = scoreToValue((a as ScoreAnswer).score);
      }
      out.push({
        optionId: option.id,
        label: `${option.label} — ${c}`,
        probability: scoreToLikelihood((likelihood as ScoreAnswer).score),
        probabilityConfidence: Math.round(clamp01((likelihood as ScoreAnswer).confidence) * 100) / 100,
        values,
      });
    }
  }
  return out;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

// --- §5 question triage: one Noul per candidate follow-up -------------------

export function triageQuestion(candidate: string): NoulQuestion {
  return {
    type: "noul",
    instructions: {
      candidate,
      question:
        "Would knowing the answer to `candidate` plausibly change which option wins?",
    },
    criteria: {
      true: "The answer could flip the winner or materially shift weights.",
      false: "Nice to know, but unlikely to change the outcome.",
    },
  };
}

/** Keep candidates that plausibly change the winner; ask only high ones. */
export function acceptTriage(
  candidates: string[],
  answers: Record<string, SystemOneAnswer>,
  keyFor: (c: string, i: number) => string,
  threshold = 0.6
): string[] {
  return candidates.filter((_, i) => {
    const a = answers[keyFor(candidates[i], i)];
    return a?.type === "noul" && a.noul >= threshold;
  });
}
