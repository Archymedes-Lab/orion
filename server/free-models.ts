// The free models ORION may use, and how each one actually behaves: measured, dated, never assumed.
//
// Two sets of measurements are merged here:
//   - archymedes-cli (../archymedes-cli, packages/core/src/providers/free-model-profiles.ts, 2026-10-16): whether
//     a model is served to this kind of app at all, whether its upstream accepts requests, how long it takes.
//   - ORION's own (scripts/free-models.ts, 2026-10-20): which of ORION's tasks each model gets right. A model can
//     be fine at reading a question and fail every scoring schema.
//
// The router (server/router.ts) orders free candidates by tier first, then by what it has learned this session:
// a slow model eventually answers every request, a perfect success rate that still costs most of the time budget,
// and it must not outrank a fast, capable one that happened to be refused once. Busy models stay as fallbacks:
// their refusals come back in under a second, and those do not use up one of the request's attempts.
// Models OpenRouter serves only to apps it lists (403 here) are never tried.
import type { Task } from "./models.ts";

export type FreeFit =
  /** A keyed fast endpoint (Cerebras): answers in about a second. Ahead of every OpenRouter free model. */
  | "fast"
  /** Answers ORION's tasks, and quickly enough. What the router prefers among the free models. */
  | "good"
  /** Works whenever a request gets through, but the upstream refuses many of them (429/502). */
  | "busy"
  /** Works, but often near or past the time budget. */
  | "slow"
  /** Chat-sized: well-formed but unreliable on structured tasks. */
  | "small"
  /** OpenRouter answers 403 "only available on agentic harnesses" to an app it doesn't list. */
  | "apps-only"
  /** Not measured yet. Tried after the good ones, before the busy ones. */
  | "unmeasured"
  /** No longer offered free. Never tried, even if a stale ORION_COMPAT_MODELS still lists it. */
  | "gone";

export interface FreeProfile {
  fit: FreeFit;
  /** Tasks it failed when measured; it goes behind other models for these. */
  weak?: Task[];
  /** Whether the provider says it logs or trains on prompts. Free endpoints may log; this is the stated case. */
  logsPrompts?: boolean;
  /**
   * Reasoning effort to send (OpenRouter's `reasoning.effort`, `reasoning_effort` elsewhere). Only where measured to
   * help: it made minimax 6× faster, and made nemotron-3.5 think until it ran out of output (2026-10-20, same
   * new-paths prompt, one run each). Cerebras qwen defaults to high and once spent a parse's whole output on it.
   */
  reasoning?: "low" | "none";
  note: string;
}

export const FREE_PROFILES_MEASURED = "2026-10-20";

export const FREE_PROFILES: Readonly<Record<string, FreeProfile>> = {
  // Cerebras (ORION_COMPAT_2_*), measured 2026-10-25: under a second per request. Its rate limits differ by model:
  // qwen allowed 450 requests a minute on this key, gpt-oss 5 a minute and 150 an hour, so qwen leads.
  "qwen-3.8-27b": { fit: "fast", reasoning: "none", note: "Cerebras: parse and score in about 1 s; 450 requests/min on the 2026-10-25 key" },
  "gpt-oss-120b": { fit: "fast", reasoning: "low", note: "Cerebras: about 1 s, but only 5 requests/min and 150/hour on the 2026-10-25 key" },
  "nvidia/nemotron-3.5-super-vl:free": { fit: "good", logsPrompts: true, note: "parse 18 s, score 14 s, paths 28 s; archymedes: finished its agent task in 78 s" },
  "minimax/minimax-m3.1-flash:free": { fit: "gone", reasoning: "low", note: "withdrawn from OpenRouter's free list by 2026-10-27; was score 2–5 s, parse 7–32 s" },
  "dots-studio/dots-3-note-preview:free": { fit: "good", weak: ["diverge"], note: "parse 37 s, score 14 s; new paths in 27 s once, then twice used its whole output on thinking" },
  "cohere/north-mini-code:free": { fit: "good", reasoning: "low", note: "parse 27 s, score 9 s; new paths 14 s (10 s at low effort) in a direct test, missed them twice in the pool" },
  "nvidia/nemotron-3-super-120b-a12b:free": { fit: "gone", logsPrompts: true, note: "withdrawn from OpenRouter's free list by 2026-10-27" },
  "poolside/laguna-xs-2.1:free": { fit: "busy", weak: ["score"], note: "parse 5–9 s, paths 3 s when it answers; never scored; upstream rate-limits most requests" },
  "poolside/laguna-s-2.1:free": { fit: "busy", weak: ["score"], note: "parse 14 s, paths 7 s; never scored; upstream rate-limits most requests" },
  "google/gemma-4-31b-it:free": { fit: "busy", note: "upstream rate-limited 9 of 10 requests (2026-10-16), all of them on 2026-10-20" },
  "google/gemma-4-26b-a4b-it:free": { fit: "busy", note: "upstream rate-limited 9 of 10 requests (2026-10-16), all of them on 2026-10-20" },
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": { fit: "busy", logsPrompts: true, note: "upstream capacity often exhausted" },
  "xingchen-agi/xing4.0-29b-a4b:free": { fit: "busy", weak: ["score", "diverge"], note: "parse 17 s; failed scoring and new paths" },
  "nvidia/nemotron-3-ultra-550b-a55b:free": { fit: "slow", logsPrompts: true, note: "passed all three tasks on 2026-10-20 (score 41 s); archymedes saw every probe time out" },
  "nvidia/nemotron-3.5-lightning:free": { fit: "slow", logsPrompts: true, note: "15 s–3 min before the first token; failed parse and new paths" },
  "openrouter/free": { fit: "slow", weak: ["parse", "score"], note: "OpenRouter picks a model per request: unpredictable, a last resort" },
  "liquid/lfm-2.5-2.6b:free": { fit: "small", note: "2.6B: well-formed but unreliable on multi-part schemas" },
  "thinkingmachines/inkling:free": { fit: "apps-only", note: "403: served only to apps OpenRouter lists" },
  "thinkingmachines/inkling-small:free": { fit: "apps-only", note: "403: served only to apps OpenRouter lists" },
};

/** The pool when nothing is configured: every "good" model, then the busy ones that are good at something. */
export const DEFAULT_FREE_MODELS = [
  "nvidia/nemotron-3.5-super-vl:free",
  "cohere/north-mini-code:free",
  "dots-studio/dots-3-note-preview:free",
  "poolside/laguna-xs-2.1:free",
  "poolside/laguna-s-2.1:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];

/** A model id whose parameter count is chat-sized (under 8B), when it isn't measured. */
const SMALL = /(?:^|[^0-9.])(?:0?\.\d+|[1-7](?:\.\d+)?)b(?:[^a-z0-9]|$)/i;

export function freeProfile(model: string): FreeProfile {
  return FREE_PROFILES[model] ?? (SMALL.test(model.split("/")[1] ?? "")
    ? { fit: "small", note: "chat-sized by its id; not measured" }
    : { fit: "unmeasured", note: "not measured yet" });
}

const TIER: Readonly<Record<FreeFit, number | null>> = { fast: -1, good: 0, unmeasured: 1, busy: 2, slow: 3, small: 4, "apps-only": null, gone: null };

/**
 * Where a free model goes for a task: lower first; null means never. A task it failed when measured moves it
 * two tiers back (behind the busy models), so it is still tried before giving up.
 */
export function freeTier(model: string, task: Task): number | null {
  const profile = freeProfile(model);
  const tier = TIER[profile.fit];
  if (tier === null) return null;
  return tier + (profile.weak?.includes(task) ? 2 : 0);
}
