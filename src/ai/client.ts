// App-side server client (§37). One place for all /decision/* calls.
// Offline-first: every function degrades to the deterministic local path
// when no endpoint is configured or the request fails. Keys: the app never
// holds provider keys — it talks to our own server, which does.
import { DecisionExtractionSchema, type DecisionExtractionValidated } from "./schemas.ts";
import { extractDecision, parseLocally } from "./extractDecision.ts";
import { classifySafety } from "../decision-engine/safety.ts";
import { AftermathRequestSchema, AftermathWordingSchema, ExplanationRequestSchema, FactorScoreSchema, type AftermathRequest, type AftermathWording, type ExplanationRequest } from "./contracts.ts";
import { API_BASE, HttpError, apiEnabled, endpoint, postJSON } from "./http.ts";
import { licenceHeader, usePlan } from "../billing/plan.ts";
import type { SafetyClass, ScenarioScore, Stakes } from "../types.ts";
import { businessContext } from "../business/profile.ts";

export { API_BASE, apiEnabled };

const isSafety = (s: unknown): s is SafetyClass =>
  s === "normal" ||
  s === "financial-high-stakes" ||
  s === "health-high-stakes" ||
  s === "legal-high-stakes" ||
  s === "crisis" ||
  s === "dangerous";

export interface ParseResult {
  extraction: DecisionExtractionValidated;
  safety: SafetyClass;
  offline: boolean;
}

/** Phase 1: structure the decision. Validates server output with zod. */
export async function parseDecision(rawInput: string): Promise<ParseResult> {
  if (apiEnabled()) {
    try {
      const json = (await extractDecision(rawInput, { endpoint: API_BASE, business: businessContext() })) as unknown as Record<string, unknown>;
      const { safety, ...rest } = json;
      const extraction = DecisionExtractionSchema.parse(rest);
      return {
        extraction,
        safety: isSafety(safety) ? safety : classifySafety(rawInput),
        offline: json.fallback === true,
      };
    } catch {
      // Fall through to the local parser — the app works offline (§39).
    }
  }
  return { extraction: parseLocally(rawInput, businessContext() !== undefined), safety: classifySafety(rawInput), offline: true };
}

export interface FactorScore {
  optionId: string;
  factorId: string;
  /** -10..+10 expected impact */
  value: number;
  /** 0..1 Score confidence (§7) */
  probabilityConfidence: number;
}

/**
 * Scores plus, optionally, the weighted ways each option can play out.
 * `scores` is the flat expectation and is always required to be complete;
 * `scenarios` is either fully valid or null, never partially trusted.
 */
export interface ScoreBatch {
  scores: FactorScore[] | null;
  scenarios: ScenarioScore[] | null;
  /**
   * Set when the server chose not to produce scenarios. Without this, a null
   * `scenarios` is indistinguishable from "this decision has no variation".
   */
  scenarioNotice: string | null;
}

const isFactorScore = (s: unknown): s is FactorScore => {
  const r = s as Record<string, unknown>;
  return (
    typeof r?.optionId === "string" &&
    typeof r?.factorId === "string" &&
    typeof r?.value === "number" && Number.isFinite(r.value) && r.value >= -10 && r.value <= 10 &&
    typeof r?.probabilityConfidence === "number" && Number.isFinite(r.probabilityConfidence) &&
    r.probabilityConfidence >= 0 && r.probabilityConfidence <= 1
  );
};

const isUnitInterval = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;


/**
 * Validate scenarios against the known options and factors. Any malformed
 * entry rejects the whole set: a model with some real branches and some
 * invented ones is worse than one with none.
 */
function parseScenarios(
  raw: unknown,
  options: { id: string }[],
  factors: { id: string }[]
): ScenarioScore[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const optionIds = new Set(options.map((o) => o.id));
  const factorIds = new Set(factors.map((f) => f.id));

  for (const entry of raw) {
    const r = entry as Record<string, unknown>;
    if (typeof r?.optionId !== "string" || !optionIds.has(r.optionId)) return null;
    if (typeof r.label !== "string" || r.label.trim() === "") return null;
    if (!isUnitInterval(r.probability) || !isUnitInterval(r.probabilityConfidence)) return null;
    const values = r.values;
    if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
    for (const [factorId, value] of Object.entries(values as Record<string, unknown>)) {
      if (!factorIds.has(factorId)) return null;
      if (typeof value !== "number" || !Number.isFinite(value) || value < -10 || value > 10) return null;
    }
  }

  // Every option must be covered, or the options are not comparable.
  if (!options.every((o) => raw.some((e) => (e as { optionId: string }).optionId === o.id))) {
    return null;
  }

  return raw as ScenarioScore[];
}

/**
 * Phase 2: per option×factor Scores, plus optional outcome scenarios. Returns
 * null scores offline or on failure — the caller builds neutral outcomes
 * instead of fabricating signal.
 */
export async function fetchFactorScores(
  options: { id: string; label: string }[],
  factors: { id: string; label: string }[],
  decision: { context: string; stakes: Stakes },
  /** The decision's categories: a question read as Business is scored with the business playbook. */
  category: readonly string[] = []
): Promise<ScoreBatch> {
  const empty: ScoreBatch = { scores: null, scenarios: null, scenarioNotice: null };
  if (!apiEnabled()) return empty;
  try {
    const json = await postJSON(endpoint("/decision/score-factors"), { options, factors, ...decision, business: businessContext(category) }, licenceHeader()) as {
      scores?: unknown; scenarios?: unknown; scenarioNotice?: unknown;
    };
    usePlan.getState().noteQuota(false);
    // Only trust a notice that is actually a string, and only when no valid
    // scenarios came back, so the two can never contradict each other.
    const notice =
      json.scenarios == null && typeof json.scenarioNotice === "string" && json.scenarioNotice.trim().length > 0
        ? json.scenarioNotice.trim().slice(0, 300)
        : null;
    if (!Array.isArray(json.scores)) return { ...empty, scenarioNotice: notice };
    const parsed = FactorScoreSchema.array().safeParse(json.scores);
    if (!parsed.success || !parsed.data.every(isFactorScore)) return { ...empty, scenarioNotice: notice };
    const scores = parsed.data;
    const pairs = new Set(scores.map((s) => JSON.stringify([s.optionId, s.factorId])));
    if (scores.length !== options.length * factors.length || pairs.size !== scores.length ||
        !options.every((o) => factors.every((f) => pairs.has(JSON.stringify([o.id, f.id]))))) {
      return { ...empty, scenarioNotice: notice };
    }
    const scenarios = parseScenarios(json.scenarios, options, factors);
    return { scores, scenarios, scenarioNotice: scenarios ? null : notice };
  } catch (error) {
    // 402: today's free scored decisions are used up. The app carries on with its quick questions.
    if (error instanceof HttpError && error.status === 402) usePlan.getState().noteQuota(true);
    return empty;
  }
}

/**
 * §5 triage: rank candidate follow-ups by "would knowing this plausibly
 * change the winner?" Ask only high ones. Offline: keep bank order.
 */
export async function triageCandidates(
  context: string,
  candidates: string[],
  budget: number,
  category: readonly string[] = []
): Promise<string[]> {
  const limit = Math.max(0, Math.min(3, Math.floor(budget)));
  const shortlist = [...new Set(candidates)].slice(0, 8);
  if (limit === 0) return [];
  if (!apiEnabled() || shortlist.length <= 1) return shortlist.slice(0, limit);
  try {
    const json = await postJSON(endpoint("/decision/triage"), { context, candidates: shortlist, budget: limit, business: businessContext(category) }) as { keep?: unknown };
    if (!Array.isArray(json.keep)) return shortlist.slice(0, limit);
    return [...new Set(json.keep.filter((k): k is string => typeof k === "string" && shortlist.includes(k)))].slice(0, limit);
  } catch {
    return shortlist.slice(0, limit);
  }
}

/** Explicit request only; explanations do not run on render or weight changes. */
export async function fetchExplanation(model: ExplanationRequest): Promise<{ explanation: string; fallback: boolean } | null> {
  if (!apiEnabled()) return null;
  try {
    const parsed = ExplanationRequestSchema.parse({ ...model, business: model.business ?? businessContext() });
    const json = await postJSON(endpoint("/decision/explain"), parsed) as { explanation?: unknown; fallback?: unknown };
    if (typeof json.explanation !== "string" || json.explanation.length === 0 || json.explanation.length > 4000) return null;
    return { explanation: json.explanation, fallback: json.fallback === true };
  } catch { return null; }
}

/** AI wording for an aftermath picture, one entry per step; null offline or when the server falls back. */
export async function fetchAftermathWording(request: AftermathRequest): Promise<AftermathWording["steps"] | null> {
  if (!apiEnabled()) return null;
  try {
    const parsed = AftermathRequestSchema.parse({ ...request, business: request.business ?? businessContext() });
    const json = await postJSON(endpoint("/decision/aftermath"), parsed) as { steps?: unknown };
    if (json.steps === null || json.steps === undefined) return null;
    return AftermathWordingSchema.parse({ steps: json.steps }).steps;
  } catch { return null; }
}

export interface ServiceHealth { online: boolean; aiConfigured: boolean; jev: boolean }

/** Whether the ORION server answers, and whether it has a scoring provider. Never throws. */
export async function fetchHealth(): Promise<ServiceHealth> {
  const down = { online: false, aiConfigured: false, jev: false };
  if (!apiEnabled()) return down;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(endpoint("/health"), { signal: controller.signal });
    if (!response.ok) return down;
    const json = await response.json() as { ok?: unknown; aiConfigured?: unknown; jev?: unknown };
    return { online: json.ok === true, aiConfigured: json.aiConfigured === true, jev: json.jev === true };
  } catch { return down; } finally { clearTimeout(timer); }
}
