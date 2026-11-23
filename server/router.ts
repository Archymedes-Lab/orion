// Picks which model answers a request, and learns from how each one behaves.
//
// - Every model has a health record. A failure puts it in a cooldown whose length depends on the kind of
//   failure (rate limit, withdrawn model, timeout, unusable output) and doubles each time it repeats.
// - Candidates are ordered: free before paid, healthy before cooling; among free models, by measured fit for the
//   task first (server/free-models.ts), then by OpenRouter's live uptime, then reliable and fast before unknown.
// - A quick refusal (rate-limited or withdrawn, answered in a moment) does not use up one of the attempts: busy free
//   models refuse in under a second, and moving past them should cost nothing.
// - If the model that was started is slow, a second free model is started beside it and the first valid
//   answer wins ("hedging"). For parse, both start at once. Paid models are never started in parallel: they only run after a failure.
// - One request has an overall time budget and a cap on attempts, so retries cannot run away.
// - Optionally the free pool refreshes itself from the daily list at github.com/ClawLabsAI/free-ai-models.
//
// State is in memory and per server process; it starts fresh on restart.
import { z } from "zod";
import type { Route, Task } from "./models.ts";
import { freeProfile, freeTier } from "./free-models.ts";

export type FailureKind = "rate_limited" | "gone" | "credentials" | "unreachable" | "bad_output" | "refused";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** First cooldown and its ceiling per failure kind; repeats double it. */
const COOLDOWN: Record<Exclude<FailureKind, "refused">, [first: number, max: number]> = {
  rate_limited: [30 * SECOND, 15 * MINUTE],
  unreachable: [20 * SECOND, 10 * MINUTE],
  bad_output: [2 * MINUTE, 30 * MINUTE],
  credentials: [10 * MINUTE, 60 * MINUTE],
  gone: [6 * 60 * MINUTE, 24 * 60 * MINUTE],
};
/** Weight of the newest sample in the running averages. */
const ALPHA = 0.3;
const UNKNOWN_LATENCY = 10 * SECOND;

/** Attempts that count: ones that ran, or failed slowly. */
export const MAX_ATTEMPTS = 4;
/** Models started in all, counting quick refusals. */
export const MAX_LAUNCHES = 8;
/** A refusal faster than this does not use up an attempt. */
const QUICK_REFUSAL_MS = 2_500;
const FAST_HEAD_START_MS = 3_000;
/** Below this percentage over the last 30 minutes, OpenRouter's own figures say an endpoint is down. */
export const DOWN_PERCENT = 30;
const UPTIME_TTL_MS = 5 * MINUTE;
const UPTIME_WAIT_MS = 2_000;
const MAX_PARALLEL = 2;
const DEFAULT_BUDGET_MS = 45 * SECOND;

/** What a thrown provider error means for the model's health. */
export function classify(reason: string): FailureKind {
  const status = Number(/^provider_http_(\d{3})$/.exec(reason)?.[1]);
  if (reason === "provider_refusal") return "refused";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403 || status === 402) return "credentials";
  if (status === 400 || status === 404 || status === 410) return "gone";
  if (status >= 400) return "unreachable";
  if (["incomplete_provider_response", "empty_provider_response", "invalid_provider_structure", "oversized_provider_response", "invalid_output"].includes(reason)) return "bad_output";
  return "unreachable";
}

interface Cooling { until: number; strikes: number; kind: FailureKind }
interface TaskStats { latency: number | null; failureRate: number; successes: number; failures: number }

const modelKey = (route: Route) => `${route.provider}:${route.model}`;
/** Routes that share a key and endpoint fail together when the key is rejected. */
const credentialKey = (route: Route) => `${route.provider}@${route.baseUrl ?? ""}`;

export interface RouterSettings {
  now?: () => number;
  /** Start a second free model after this long. 0 turns hedging off. Default: 1.5× the model's usual time, 3–12 s. */
  hedgeMs?: number;
  /** Time allowed for one request across all attempts. */
  budgetMs?: number;
  /**
   * Read OpenRouter's public uptime figures for free models (no credential) with this fetch. Off unless given:
   * the server turns it on, tests that inject a fetch do not.
   */
  uptimeFetch?: typeof fetch;
}

export class ModelRouter {
  private readonly now: () => number;
  private readonly hedgeMs: number | undefined;
  readonly budgetMs: number;
  /** Model-wide and credential-wide cooldowns (rate limit, withdrawn, key rejected, unreachable). */
  private readonly cooling = new Map<string, Cooling>();
  /** Per model and task: a model that cannot produce one schema may be fine at another. */
  private readonly taskCooling = new Map<string, Cooling>();
  private readonly stats = new Map<string, TaskStats>();
  private discovered: { at: number; models: string[] } = { at: Number.NEGATIVE_INFINITY, models: [] };
  private discovering = false;
  private readonly uptimeFetch: typeof fetch | undefined;
  /** model → best endpoint uptime over the last 30 minutes (undefined: OpenRouter gave no figure). */
  private readonly uptime = new Map<string, { at: number; percent: number | undefined }>();
  private readonly reading = new Map<string, Promise<void>>();

  constructor(settings: RouterSettings = {}) {
    this.now = settings.now ?? Date.now;
    this.hedgeMs = settings.hedgeMs;
    this.budgetMs = settings.budgetMs ?? DEFAULT_BUDGET_MS;
    this.uptimeFetch = settings.uptimeFetch;
  }

  /** Whether OpenRouter's own figures say this free model is down right now. Unknown is never down. */
  isDown(route: Route): boolean {
    const percent = this.uptime.get(route.model)?.percent;
    return route.provider === "compatible" && percent !== undefined && percent < DOWN_PERCENT;
  }

  /**
   * Refresh uptime for the OpenRouter free models among `routes`. Waits (at most UPTIME_WAIT_MS) only for models
   * never read, and not at all when a fast endpoint leads; stale figures are refreshed in the background. Never throws, never delays more than that.
   */
  async prepare(routes: Route[]): Promise<void> {
    if (!this.uptimeFetch) return;
    const time = this.now();
    const first: Promise<void>[] = [];
    for (const route of routes) {
      if (route.provider !== "compatible" || !route.baseUrl?.startsWith("https://openrouter.ai/")) continue;
      const known = this.uptime.get(route.model);
      if (known && time - known.at < UPTIME_TTL_MS) continue;
      const read = this.readUptime(route);
      if (!known) first.push(read);
    }
    // Uptime only orders the free models; with a fast endpoint in front, nobody should wait for it.
    const fastFirst = routes.some((r) => r.provider === "compatible" && freeProfile(r.model).fit === "fast");
    if (first.length && !fastFirst) await Promise.race([Promise.all(first), new Promise((resolve) => setTimeout(resolve, UPTIME_WAIT_MS))]);
  }

  private readUptime(route: Route): Promise<void> {
    const pending = this.reading.get(route.model);
    if (pending) return pending;
    const fetchImpl = this.uptimeFetch!;
    const work = (async () => {
      try {
        const path = route.model.split("/").map(encodeURIComponent).join("/");
        const response = await fetchImpl(`${route.baseUrl}/models/${path}/endpoints`, { signal: AbortSignal.timeout(8 * SECOND), headers: { accept: "application/json" } });
        if (response.ok) this.uptime.set(route.model, { at: this.now(), percent: bestUptime(await response.json()) });
      } catch { /* unknown is not down; asked again next time */ }
      finally { this.reading.delete(route.model); }
    })();
    this.reading.set(route.model, work);
    return work;
  }

  private statsFor(route: Route, task: Task): TaskStats {
    const key = `${modelKey(route)}|${task}`;
    let stats = this.stats.get(key);
    if (!stats) this.stats.set(key, stats = { latency: null, failureRate: 0, successes: 0, failures: 0 });
    return stats;
  }

  /** When this route may be tried again; 0 if it is available now. */
  availableAt(route: Route, task: Task): number {
    const time = this.now();
    const until = Math.max(
      this.cooling.get(modelKey(route))?.until ?? 0,
      this.cooling.get(credentialKey(route))?.until ?? 0,
      this.taskCooling.get(`${modelKey(route)}|${task}`)?.until ?? 0,
    );
    return until > time ? until : 0;
  }

  /**
   * The order to try routes in. Free models come before paid ones; within each group the available ones come
   * first, then those that have answered this task before, the more reliable before the less, the faster
   * before the slower, and otherwise the configured order.
   * If everything is cooling, the two that recover soonest are probed rather than giving up without trying.
   */
  order(routes: Route[], task: Task): Route[] {
    const ranked = routes.flatMap((route, index) => {
      const stats = this.stats.get(`${modelKey(route)}|${task}`);
      // Measured fit for this task; a model OpenRouter will not serve to ORION is never tried.
      const tier = route.provider === "compatible" ? freeTier(route.model, task) : 0;
      if (tier === null) return [];
      return [{
        // A model fine-tuned for this kind of request (ORION_BUSINESS_MODEL) was put there on purpose: it goes first.
        route, index, paid: route.model.startsWith("ft:") ? -1 : route.provider === "compatible" ? 0 : 1, wait: this.availableAt(route, task),
        // A model whose endpoint is down goes behind every free model that is up, whatever its fit.
        tier: tier + (this.isDown(route) ? 10 : 0),
        // A model that has answered this task before is a better bet than one that has not been seen to.
        unproven: stats && stats.successes > 0 ? 0 : 1,
        failing: Math.round((stats?.failureRate ?? 0) * 5), latency: stats?.latency ?? UNKNOWN_LATENCY,
      }];
    });
    const available = ranked.filter((r) => r.wait === 0)
      .sort((a, b) => a.paid - b.paid || a.tier - b.tier || a.unproven - b.unproven || a.failing - b.failing || a.latency - b.latency || a.index - b.index);
    if (available.length) return available.slice(0, MAX_LAUNCHES).map((r) => r.route);
    return ranked.sort((a, b) => a.wait - b.wait || a.tier - b.tier || a.index - b.index).slice(0, 2).map((r) => r.route);
  }

  /** For GET /health: each free model in a pool, what was measured about it, and whether it is up right now. */
  describeFree(models: string[]) {
    return [...new Set(models)].map((model) => {
      const profile = freeProfile(model);
      const route = { provider: "compatible" as const, model, apiKey: "" };
      return { model, fit: profile.fit, weakAt: profile.weak ?? [], logsPrompts: profile.logsPrompts ?? false, note: profile.note,
        uptimePercent: this.uptime.get(model)?.percent ?? null, down: this.isDown(route), cooling: this.availableAt(route, "parse") > 0 };
    });
  }

  /** How long to wait for `route` before starting another free model beside it. */
  hedgeDelay(route: Route, task: Task): number {
    if (this.hedgeMs !== undefined) return this.hedgeMs;
    // A fast endpoint usually answers within a second: give it a head start rather than spending a free-tier request
    // (50 a day) on every read. If it stalls or refuses, the next model starts after this.
    if (route.provider === "compatible" && freeProfile(route.model).fit === "fast") return FAST_HEAD_START_MS;
    // Reading the question is the one call everything waits on, and free models are often rate-limited or slow
    // without warning: two start together and the first valid answer wins (Jev's pick, 2026-10-11, 77%).
    if (task === "parse") return 1; // 1 ms: together. 0 would mean hedging off.
    // New paths are the longest free-model answer and the one most often cut off at the budget (2026-10-20: one in
    // two failed alone). The person asked for them and is waiting: two models write at once.
    if (task === "diverge") return 1;
    const usual = this.stats.get(`${modelKey(route)}|${task}`)?.latency ?? null;
    return usual === null ? 8 * SECOND : Math.max(3 * SECOND, Math.min(12 * SECOND, usual * 1.5));
  }

  success(route: Route, task: Task, ms: number) {
    const stats = this.statsFor(route, task);
    stats.successes += 1;
    stats.latency = stats.latency === null ? ms : stats.latency * (1 - ALPHA) + ms * ALPHA;
    stats.failureRate *= 1 - ALPHA;
    this.cooling.delete(modelKey(route));
    this.cooling.delete(credentialKey(route));
    this.taskCooling.delete(`${modelKey(route)}|${task}`);
  }

  /** A model that was still working when another one answered: not a failure, but it was slower than that. */
  outpaced(route: Route, task: Task, ms: number) {
    const stats = this.statsFor(route, task);
    // It would have taken longer than this; never let a lost race make a model look quick.
    const atLeast = ms * 1.5;
    const known = stats.latency ?? UNKNOWN_LATENCY;
    stats.latency = Math.max(known, known * (1 - ALPHA) + atLeast * ALPHA);
  }

  failure(route: Route, task: Task, kind: FailureKind, retryAfterMs?: number) {
    const stats = this.statsFor(route, task);
    stats.failures += 1;
    stats.failureRate = stats.failureRate * (1 - ALPHA) + ALPHA;
    // A refusal is about the request, not the model's health.
    if (kind === "refused") return;
    const [table, key] = kind === "bad_output" ? [this.taskCooling, `${modelKey(route)}|${task}`]
      : kind === "credentials" ? [this.cooling, credentialKey(route)] : [this.cooling, modelKey(route)];
    const strikes = (table.get(key)?.strikes ?? 0) + 1;
    const [first, max] = COOLDOWN[kind];
    const backoff = Math.min(max, first * 2 ** (strikes - 1));
    // The provider's own Retry-After wins when it asks for longer, up to an hour.
    const wait = Math.max(backoff, Math.min(retryAfterMs ?? 0, 60 * MINUTE));
    table.set(key, { until: this.now() + wait, strikes, kind });
  }

  /** For GET /health: what the router currently believes about each model it has used. */
  snapshot() {
    const time = this.now();
    const models: Record<string, { status: string; retryInSeconds?: number; tasks: Record<string, { successes: number; failures: number; usualMs: number | null }> }> = {};
    for (const [key, stats] of this.stats) {
      const [model, task] = key.split("|");
      const entry = models[model] ??= { status: "ok", tasks: {} };
      entry.tasks[task] = { successes: stats.successes, failures: stats.failures, usualMs: stats.latency === null ? null : Math.round(stats.latency) };
    }
    const mark = (model: string, cooling: Cooling) => {
      if (cooling.until <= time || !models[model]) return;
      models[model].status = cooling.kind;
      models[model].retryInSeconds = Math.max(models[model].retryInSeconds ?? 0, Math.ceil((cooling.until - time) / 1000));
    };
    for (const [key, cooling] of this.taskCooling) mark(key.split("|")[0], cooling);
    for (const [key, cooling] of this.cooling) mark(key, cooling);
    return { models, discovered: this.discovered.models };
  }

  // -------------------------------------------------------------------------
  // Self-refreshing free pool
  // -------------------------------------------------------------------------

  /** Model ids from the daily list, best first. Returns what is known now and refreshes in the background when stale. */
  discoveredModels(fetchImpl: typeof fetch = fetch): string[] {
    if (!this.discovering && this.now() - this.discovered.at > DISCOVERY_TTL_MS) void this.refreshDiscovery(fetchImpl);
    return this.discovered.models;
  }

  async refreshDiscovery(fetchImpl: typeof fetch = fetch): Promise<string[]> {
    this.discovering = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8 * SECOND);
    try {
      const response = await fetchImpl(DISCOVERY_URL, { signal: controller.signal });
      if (!response.ok) throw new Error("list unavailable");
      const text = await response.text();
      if (text.length > 512_000) throw new Error("list too large");
      this.discovered = { at: this.now(), models: pickFreeModels(JSON.parse(text)) };
    } catch {
      // Keep the last good list; look again in half an hour rather than on every request.
      this.discovered = { at: this.now() - DISCOVERY_TTL_MS + 30 * MINUTE, models: this.discovered.models };
    } finally {
      clearTimeout(timer);
      this.discovering = false;
    }
    return this.discovered.models;
  }
}

const DISCOVERY_URL = "https://raw.githubusercontent.com/ClawLabsAI/free-ai-models/main/data/models.json";
const DISCOVERY_TTL_MS = 6 * 60 * MINUTE;
const MAX_DISCOVERED = 6;
/** Providers OpenRouter lists as possibly training on prompts (the list's "Data policy", checked 2026-09-23). */
const TRAINS_ON_PROMPTS = /^(deepseek|liquid|nvidia|thinkingmachines)\//i;

const Listing = z.object({
  models: z.array(z.object({
    id: z.string(), kind: z.string().optional(), source: z.string().optional(),
    health: z.string().nullable().optional(), zo_score: z.number().nullable().optional(), answering_now: z.boolean().nullable().optional(),
    expires: z.string().nullable().optional(),
  }).passthrough()),
});

/**
 * Chooses models from the list. The list is somebody else's file, so it is only allowed to name models:
 * ids must look like OpenRouter ids and end in ":free" (so nothing here can cost money), and models that are
 * unhealthy today, are not chat models, or come from providers that may train on prompts are left out.
 */
export function pickFreeModels(listing: unknown): string[] {
  const parsed = Listing.safeParse(listing);
  if (!parsed.success) return [];
  return parsed.data.models
    .filter((m) => /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*:free$/i.test(m.id) && m.id.length <= 100)
    .filter((m) => (m.kind ?? "chat") === "chat" && (m.source ?? "").startsWith("https://openrouter.ai/"))
    .filter((m) => m.health === "ok" && !TRAINS_ON_PROMPTS.test(m.id) && !/safety|guard/i.test(m.id) && freeProfile(m.id).fit !== "apps-only")
    .sort((a, b) => Number(b.answering_now === true) - Number(a.answering_now === true) || (b.zo_score ?? -1) - (a.zo_score ?? -1))
    .slice(0, MAX_DISCOVERED)
    .map((m) => m.id);
}

// ---------------------------------------------------------------------------
// Running one request across the candidates
// ---------------------------------------------------------------------------

export class AttemptError extends Error {
  constructor(public readonly reason: string, public readonly recoverable: boolean, public readonly retryAfterMs?: number) { super(reason); }
}
export interface Outcome<T> { value: T; route: Route; attempts: number }

/**
 * Tries `routes` until one returns a value. `attempt` must reject with an AttemptError (anything else counts
 * as unreachable) and must stop when its signal aborts.
 */
export async function runWithFallback<T>(
  router: ModelRouter, routes: Route[], task: Task,
  attempt: (route: Route, signal: AbortSignal) => Promise<T>,
  clock: { now?: () => number } = {},
): Promise<Outcome<T>> {
  const now = clock.now ?? Date.now;
  await router.prepare(routes);
  const queue = router.order(routes, task);
  const deadline = now() + router.budgetMs;
  type Settled = { route: Route; ms: number } & ({ ok: true; value: T } | { ok: false; error: AttemptError });
  const running = new Map<Route, { controller: AbortController; started: number; settled: Promise<Settled> }>();
  let attempts = 0;
  /** Attempts that count against MAX_ATTEMPTS: all but quick refusals. */
  let charged = 0;
  let lastError: AttemptError | null = null;
  const more = () => queue.length > 0 && charged < MAX_ATTEMPTS && attempts < MAX_LAUNCHES && now() < deadline;

  const launch = () => {
    const route = queue.shift()!;
    const controller = new AbortController();
    const started = now();
    attempts += 1;
    charged += 1;
    const settled = attempt(route, controller.signal).then(
      (value): Settled => ({ route, ms: now() - started, ok: true, value }),
      (error): Settled => ({ route, ms: now() - started, ok: false, error: error instanceof AttemptError ? error : new AttemptError("provider_unreachable", true) }),
    );
    running.set(route, { controller, started, settled });
  };
  const stopOthers = () => {
    for (const [route, run] of running) {
      router.outpaced(route, task, now() - run.started);
      run.controller.abort();
    }
    running.clear();
  };

  try {
    while (true) {
      if (running.size === 0) {
        if (!more()) break;
        launch();
      }
      const timers: ReturnType<typeof setTimeout>[] = [];
      const after = (ms: number, tag: "hedge" | "deadline") => new Promise<typeof tag>((resolve) => { timers.push(setTimeout(() => resolve(tag), Math.max(0, ms))); });
      const waits: Promise<Settled | "hedge" | "deadline">[] = [...running.values()].map((r) => r.settled);
      waits.push(after(deadline - now(), "deadline"));
      // Only a free model is started beside a running one; paid models wait for a failure.
      const next = queue[0];
      const entries = [...running.entries()];
      const newest = entries[entries.length - 1];
      if (next?.provider === "compatible" && newest && running.size < MAX_PARALLEL && more()) {
        const delay = router.hedgeDelay(newest[0], task);
        if (delay > 0) waits.push(after(newest[1].started + delay - now(), "hedge"));
      }
      const event = await Promise.race(waits);
      timers.forEach(clearTimeout);

      if (event === "deadline") break;
      if (event === "hedge") { launch(); continue; }
      running.delete(event.route);
      if (event.ok) {
        router.success(event.route, task, event.ms);
        stopOthers();
        return { value: event.value, route: event.route, attempts };
      }
      lastError = event.error;
      const kind = classify(event.error.reason);
      router.failure(event.route, task, kind, event.error.retryAfterMs);
      // Turned away at the door (busy or withdrawn) in a moment: nothing was spent, so the attempt is given back.
      if ((kind === "rate_limited" || kind === "gone") && event.ms < QUICK_REFUSAL_MS) charged -= 1;
      // A rejected key or a refusal ends the request: no shopping a refused prompt around, no surprise spend.
      if (!event.error.recoverable) { stopOthers(); throw event.error; }
    }
  } finally {
    for (const run of running.values()) run.controller.abort();
  }
  if (lastError && !lastError.recoverable) throw lastError;
  throw new AttemptError("providers_unavailable", true);
}

/** The best last-30-minutes uptime among a model's endpoints, from OpenRouter's /models/{id}/endpoints. */
export function bestUptime(body: unknown): number | undefined {
  const endpoints = (body as { data?: { endpoints?: unknown } } | null)?.data?.endpoints;
  if (!Array.isArray(endpoints)) return undefined;
  let best: number | undefined;
  for (const e of endpoints.slice(0, 32)) {
    const value = (e as { uptime_last_30m?: unknown; uptime_last_1d?: unknown } | null);
    const raw = typeof value?.uptime_last_30m === "number" ? value.uptime_last_30m : value?.uptime_last_1d;
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 100) best = Math.max(best ?? 0, raw);
  }
  return best;
}
