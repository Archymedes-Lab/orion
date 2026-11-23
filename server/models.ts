// Rates checked against official provider documentation on 2026-09-30.
import { DEFAULT_FREE_MODELS, freeProfile } from "./free-models.ts";
export type Task = "parse" | "score" | "triage" | "explain" | "aftermath" | "diverge";
/** `compatible` is any OpenAI-compatible chat-completions endpoint, e.g. a free-model gateway. */
export type Provider = "openai" | "anthropic" | "compatible";
export type Environment = Record<string, string | undefined>;

export const MODELS = {
  "gpt-5.4-nano-2026-03-17": { provider: "openai", input: 0.20, cached: 0.02, output: 1.25 },
  "gpt-5.4-mini-2026-03-17": { provider: "openai", input: 0.75, cached: 0.075, output: 4.50 },
  "claude-haiku-4-5-20251001": { provider: "anthropic", input: 1, cached: 0.10, output: 5 },
} as const;

export const OUTPUT_LIMITS: Record<Task, number> = { parse: 1800, score: 3200, triage: 192, explain: 640, aftermath: 3000, diverge: 1400 };
export interface Route { provider: Provider; model: string; apiKey: string; baseUrl?: string }

// The default free pool and what each model is good at live in server/free-models.ts (measured, dated).
// Free models change week to week: re-test with `bun scripts/free-models.ts`, override with ORION_COMPAT_MODELS.
/** Size of the free pool. One request starts at most eight of them, four that count (server/router.ts). */
const MAX_COMPATIBLE_ROUTES = 8;

/**
 * Routes for an OpenAI-compatible endpoint. On when a key (ORION_COMPAT_API_KEY or OPENROUTER_API_KEY) or a
 * base URL is set; a keyless endpoint needs ORION_COMPAT_BASE_URL and ORION_COMPAT_MODELS.
 * `discovered` are ids from the daily free-model list (OpenRouter only); the operator's own list goes first.
 *
 * Up to two more endpoints can run beside it (ORION_COMPAT_2_* and ORION_COMPAT_3_*: BASE_URL, MODELS and
 * API_KEY), e.g. Groq or Cerebras next to OpenRouter. Their routes are interleaved, so the first two tries, which
 * race for a parse, go to different providers and one provider's rate limit cannot stall both.
 */
export function compatibleRoutes(env: Environment, discovered: string[] = []): Route[] {
  const primary = primaryRoutes(env, discovered);
  const extra = [2, 3].map((n) => extraRoutes(env, n));
  const lists = [primary, ...extra].filter((list) => list.length > 0);
  const longest = Math.max(0, ...lists.map((list) => list.length));
  const mixed: Route[] = [];
  for (let i = 0; i < longest; i++) for (const list of lists) if (list[i]) mixed.push(list[i]);
  return mixed.slice(0, MAX_COMPATIBLE_ROUTES * lists.length);
}

const checkedBase = (url: string, name: string) => {
  if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) throw new Error(`${name} must be https (or localhost).`);
  return url;
};

function primaryRoutes(env: Environment, discovered: string[]): Route[] {
  const apiKey = env.ORION_COMPAT_API_KEY || env.OPENROUTER_API_KEY || "";
  if (!apiKey && !env.ORION_COMPAT_BASE_URL) return [];
  const baseUrl = checkedBase((env.ORION_COMPAT_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, ""), "ORION_COMPAT_BASE_URL");
  const listed = (env.ORION_COMPAT_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const openrouter = baseUrl.startsWith("https://openrouter.ai/");
  const found = openrouter ? discovered : [];
  const all = [...new Set(listed.length ? [...listed, ...found] : openrouter ? [...found, ...DEFAULT_FREE_MODELS] : [])];
  if (!all.length) throw new Error("Set ORION_COMPAT_MODELS for this ORION_COMPAT_BASE_URL.");
  // Providers that say they log or train on prompts get no one's decisions unless the operator opts in, since the
  // privacy policy promises otherwise (ORION_ALLOW_PROMPT_LOGGING=1, e.g. for benchmarking).
  const models = all.filter((m) => freeProfile(m).fit !== "gone" && (env.ORION_ALLOW_PROMPT_LOGGING === "1" || !freeProfile(m).logsPrompts));
  return models.slice(0, MAX_COMPATIBLE_ROUTES).map((model) => ({ provider: "compatible" as const, model, apiKey, baseUrl }));
}

function extraRoutes(env: Environment, n: number): Route[] {
  const prefix = `ORION_COMPAT_${n}_`;
  const base = env[`${prefix}BASE_URL`];
  if (!base) return [];
  const baseUrl = checkedBase(base.replace(/\/+$/, ""), `${prefix}BASE_URL`);
  const models = [...new Set((env[`${prefix}MODELS`] ?? "").split(",").map((m) => m.trim()).filter(Boolean))];
  if (!models.length) throw new Error(`Set ${prefix}MODELS for ${prefix}BASE_URL.`);
  const apiKey = env[`${prefix}API_KEY`] ?? "";
  return models.slice(0, MAX_COMPATIBLE_ROUTES).map((model) => ({ provider: "compatible" as const, model, apiKey, baseUrl }));
}

/** Rates for a model; a fine-tune ("ft:<base>:<org>::<id>") is billed from its base snapshot, which is an underestimate. */
export function priceOf(model: string) {
  const base = model.startsWith("ft:") ? model.split(":")[1] : model;
  return MODELS[base as keyof typeof MODELS] ?? { provider: "openai", input: 0, cached: 0, output: 0 };
}

/**
 * A model fine-tuned on ORION's business decisions (built from scripts/business-eval.ts --export), tried first for
 * business decisions. OpenAI fine-tunes only for now: "ft:gpt-5.4-mini-2026-03-17:org::id" with OPENAI_API_KEY.
 */
function businessRoute(env: Environment): Route | null {
  const model = env.ORION_BUSINESS_MODEL;
  if (!model || !env.OPENAI_API_KEY) return null;
  if (!/^ft:[\w.-]+:[\w.-]*:[\w.-]*:[\w.-]+$/.test(model)) throw new Error("ORION_BUSINESS_MODEL must be an OpenAI fine-tune id (ft:…).");
  return { provider: "openai", model, apiKey: env.OPENAI_API_KEY };
}

function selected(env: Environment, name: string, fallback: keyof typeof MODELS, provider: Provider): keyof typeof MODELS {
  const model = env[name] || fallback;
  if (!(model in MODELS) || MODELS[model as keyof typeof MODELS].provider !== provider) {
    throw new Error(`Unsupported ${name}; use a documented lightweight model snapshot.`);
  }
  return model as keyof typeof MODELS;
}

/**
 * Every route that could serve a task: the free pool first, then one route per paid provider.
 * server/router.ts decides the order and how many are tried. No automatic premium upgrades.
 */
export function routesFor(task: Task, env: Environment, discovered: string[] = [], business = false): Route[] {
  const openai = env.OPENAI_API_KEY ? {
    provider: "openai" as const,
    model: selected(env, task === "score" || task === "explain" || task === "aftermath" ? "ORION_OPENAI_SCORING_MODEL" : "ORION_OPENAI_SMALL_MODEL",
      task === "score" || task === "explain" || task === "aftermath" ? "gpt-5.4-mini-2026-03-17" : "gpt-5.4-nano-2026-03-17", "openai"),
    apiKey: env.OPENAI_API_KEY,
  } satisfies Route : null;
  const anthropic = env.ANTHROPIC_API_KEY ? {
    provider: "anthropic" as const,
    model: selected(env, "ORION_ANTHROPIC_MODEL", "claude-haiku-4-5-20251001", "anthropic"),
    apiKey: env.ANTHROPIC_API_KEY,
  } satisfies Route : null;
  const tuned = business ? businessRoute(env) : null;
  return [tuned, ...compatibleRoutes(env, discovered), ...(task === "explain" || task === "aftermath" ? [anthropic, openai] : [openai, anthropic])].filter((route): route is Route => route !== null);
}
