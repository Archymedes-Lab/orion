import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { structured } from "../server/providers.ts";
import { compatibleRoutes } from "../server/models.ts";
import { AttemptError, MAX_ATTEMPTS, MAX_LAUNCHES, ModelRouter, bestUptime, classify, pickFreeModels, runWithFallback } from "../server/router.ts";
import { DEFAULT_FREE_MODELS, FREE_PROFILES, freeTier } from "../server/free-models.ts";
import { handler } from "../server/index.ts";
import { invoke, openaiResponse } from "./helpers/ai.js";

const free = (model) => ({ provider: "compatible", model, apiKey: "k", baseUrl: "https://openrouter.ai/api/v1" });
const paid = { provider: "openai", model: "gpt-5.4-nano-2026-03-17", apiKey: "p" };
const [A, B, C, D, E] = ["a", "b", "c", "d", "e"].map(free);
const names = (routes) => routes.map((r) => r.model);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new AttemptError("provider_unreachable", true)); }, { once: true });
});
const chat = (content) => Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
const request = (task = "parse") => ({ task, instructions: "Return a note", input: "data",
  schema: { type: "object", properties: { note: { type: "string" } }, required: ["note"], additionalProperties: false },
  validate: z.object({ note: z.string().min(1) }) });

describe("what a failure means", () => {
  it("sorts provider errors into kinds", () => {
    assert.equal(classify("provider_http_429"), "rate_limited");
    assert.equal(classify("provider_http_404"), "gone");
    assert.equal(classify("provider_http_401"), "credentials");
    assert.equal(classify("provider_http_503"), "unreachable");
    assert.equal(classify("invalid_output"), "bad_output");
    assert.equal(classify("provider_refusal"), "refused");
    assert.equal(classify("anything else"), "unreachable");
  });
});

describe("cooldowns", () => {
  it("skips a rate-limited model, doubles the wait when it repeats, and clears it on success", () => {
    let now = 0;
    const router = new ModelRouter({ now: () => now });
    router.failure(A, "parse", "rate_limited");
    assert.deepEqual(names(router.order([A, B], "parse")), ["b"]);
    assert.equal(router.availableAt(A, "parse"), 30_000);
    now = 30_000;
    assert.deepEqual(names(router.order([A, B], "parse")).sort(), ["a", "b"]);
    router.failure(A, "parse", "rate_limited");
    assert.equal(router.availableAt(A, "parse"), 30_000 + 60_000);
    router.success(A, "parse", 500);
    assert.equal(router.availableAt(A, "parse"), 0);
    router.failure(A, "parse", "rate_limited");
    assert.equal(router.availableAt(A, "parse"), now + 30_000, "strikes start over after a success");
  });
  it("honours a longer Retry-After, capped at an hour", () => {
    const router = new ModelRouter({ now: () => 0 });
    router.failure(A, "parse", "rate_limited", 120_000);
    assert.equal(router.availableAt(A, "parse"), 120_000);
    router.failure(B, "parse", "rate_limited", 9e9);
    assert.equal(router.availableAt(B, "parse"), 3_600_000);
  });
  it("benches a withdrawn model for hours", () => {
    const router = new ModelRouter({ now: () => 0 });
    router.failure(A, "parse", "gone");
    assert.equal(router.availableAt(A, "score"), 6 * 3_600_000);
  });
  it("keeps unusable output to the task it failed at", () => {
    const router = new ModelRouter({ now: () => 0 });
    router.failure(A, "score", "bad_output");
    assert.ok(router.availableAt(A, "score") > 0);
    assert.equal(router.availableAt(A, "parse"), 0);
  });
  it("benches every model behind a rejected key, and nothing else", () => {
    const router = new ModelRouter({ now: () => 0 });
    router.failure(A, "parse", "credentials");
    assert.deepEqual(names(router.order([A, B, paid], "parse")), [paid.model]);
  });
  it("probes the two that recover soonest when everything is cooling", () => {
    const router = new ModelRouter({ now: () => 0 });
    router.failure(A, "parse", "gone");
    router.failure(B, "parse", "rate_limited");
    router.failure(C, "parse", "unreachable");
    assert.deepEqual(names(router.order([A, B, C], "parse")), ["c", "b"]);
  });
});

describe("ordering", () => {
  it("puts free before paid, reliable before flaky, fast before slow, and otherwise keeps the configured order", () => {
    const router = new ModelRouter({ now: () => 0 });
    assert.deepEqual(names(router.order([paid, A, B], "parse")), ["a", "b", paid.model]);
    router.success(B, "parse", 2_000);
    router.success(A, "parse", 9_000);
    assert.deepEqual(names(router.order([A, B, C], "parse")), ["b", "a", "c"], "c has never answered: proven models go first");
    router.outpaced(C, "parse", 300);
    assert.deepEqual(names(router.order([A, B, C], "parse")), ["b", "a", "c"], "losing a race quickly does not make a model look fast");
    for (let i = 0; i < 3; i++) router.outpaced(B, "parse", 20_000);
    assert.deepEqual(names(router.order([A, B], "parse")), ["a", "b"], "a model that keeps losing the race drops back");
  });
  it("never lines up more than the launch cap", () => {
    const many = "abcdefghijk".split("").map(free);
    assert.equal(new ModelRouter().order([...many, paid], "parse").length, MAX_LAUNCHES);
  });
});

describe("measured fit and live uptime", () => {
  const good = free("nvidia/nemotron-3.5-super-vl:free"), busy = free("google/gemma-4-31b-it:free"), slow = free("nvidia/nemotron-3.5-lightning:free");
  const appsOnly = free("thinkingmachines/inkling:free"), laguna = free("poolside/laguna-xs-2.1:free"), unknown = free("someone/new-model:free");

  it("orders free models by measured fit before configured order, and never tries an apps-only model", () => {
    const order = names(new ModelRouter({ now: () => 0 }).order([slow, busy, appsOnly, unknown, good], "parse"));
    assert.deepEqual(order, [good.model, unknown.model, busy.model, slow.model]);
  });
  it("tries a fast keyed endpoint before every free model, and gives it a head start instead of racing it", () => {
    const fast = { provider: "compatible", model: "qwen-3.8-27b", apiKey: "c", baseUrl: "https://api.cerebras.ai/v1" };
    const router = new ModelRouter({ now: () => 0 });
    assert.equal(names(router.order([good, unknown, fast], "parse"))[0], fast.model);
    assert.equal(router.hedgeDelay(fast, "parse"), 3_000, "a free model starts only if the fast one is slow");
    assert.equal(router.hedgeDelay(good, "parse"), 1, "free models still race each other");
  });
  it("puts a model behind others for a task it failed when measured, but still tries it", () => {
    const router = new ModelRouter({ now: () => 0 });
    assert.equal(names(router.order([laguna, busy], "parse"))[0], laguna.model, "laguna is fine at reading questions");
    assert.deepEqual(names(router.order([laguna, busy, slow], "score")), [busy.model, slow.model, laguna.model], "but never scored");
  });
  it("fit outranks luck: a slow model that answered does not jump a good one that was refused once", () => {
    const router = new ModelRouter({ now: () => 0 });
    router.success(slow, "score", 40_000);
    router.failure(good, "score", "refused");
    assert.equal(names(router.order([slow, good], "score"))[0], good.model);
  });
  it("moves a model whose endpoint is down behind every one that is up, using OpenRouter's own figures", async () => {
    const asked = [];
    const uptimeFetch = async (url) => {
      asked.push(String(url));
      const percent = String(url).includes("nemotron-3.5-super-vl") ? 0 : 100;
      return Response.json({ data: { endpoints: [{ uptime_last_30m: percent }] } });
    };
    const router = new ModelRouter({ now: () => 0, uptimeFetch });
    await router.prepare([good, busy]);
    assert.ok(asked.every((u) => u.startsWith("https://openrouter.ai/api/v1/models/") && u.endsWith("/endpoints")));
    assert.ok(asked.some((u) => u.includes("nemotron-3.5-super-vl%3Afree")), "the ':' in the id is escaped");
    assert.equal(router.isDown(good), true);
    assert.deepEqual(names(router.order([good, busy], "parse")), [busy.model, good.model]);
    await router.prepare([good, busy]);
    assert.equal(asked.length, 2, "figures are cached");
  });
  it("never waits long for uptime, and never fails a request over it", async () => {
    const router = new ModelRouter({ uptimeFetch: () => new Promise(() => {}) });
    const began = Date.now();
    await router.prepare([good]);
    assert.ok(Date.now() - began < 2_500);
    assert.equal(router.isDown(good), false, "unknown is not down");
    const broken = new ModelRouter({ uptimeFetch: async () => { throw new Error("offline"); } });
    await broken.prepare([good]);
    assert.equal(broken.isDown(good), false);
  });
  it("reads the best endpoint's uptime and ignores nonsense", () => {
    assert.equal(bestUptime({ data: { endpoints: [{ uptime_last_30m: 12 }, { uptime_last_30m: 97.5 }] } }), 97.5);
    assert.equal(bestUptime({ data: { endpoints: [{ uptime_last_1d: 40 }] } }), 40);
    assert.equal(bestUptime({ data: { endpoints: [{ uptime_last_30m: 140 }, { uptime_last_30m: "x" }] } }), undefined);
    assert.equal(bestUptime(null), undefined);
  });
  it("the default pool is all measured, routable models, and every profile is dated by its note", () => {
    for (const model of DEFAULT_FREE_MODELS) {
      assert.ok(FREE_PROFILES[model], `${model} is measured`);
      assert.notEqual(freeTier(model, "parse"), null);
      assert.match(model, /:free$/);
    }
    for (const [model, profile] of Object.entries(FREE_PROFILES)) assert.ok(profile.note.length > 10, model);
  });
});

describe("running a request", () => {
  it("moves on at once when a model fails, and remembers it for the next request", async () => {
    const router = new ModelRouter({ hedgeMs: 0 });
    const tried = [];
    const attempt = async (route) => { tried.push(route.model); if (route.model === "a") throw new AttemptError("provider_http_429", true); return route.model; };
    const first = await runWithFallback(router, [A, B], "parse", attempt);
    assert.deepEqual([first.value, first.attempts], ["b", 2]);
    const second = await runWithFallback(router, [A, B], "parse", attempt);
    assert.equal(second.attempts, 1);
    assert.deepEqual(tried, ["a", "b", "b"]);
  });
  it("starts a second free model when the first is slow, takes the first answer and aborts the other", async () => {
    const router = new ModelRouter({ hedgeMs: 20 });
    let aborted = false;
    const outcome = await runWithFallback(router, [A, B], "parse", async (route, signal) => {
      if (route.model === "a") { signal.addEventListener("abort", () => { aborted = true; }); await sleep(400, signal); return "slow"; }
      await sleep(10, signal);
      return "fast";
    });
    assert.deepEqual([outcome.value, outcome.route.model, outcome.attempts], ["fast", "b", 2]);
    assert.equal(aborted, true);
    assert.equal(router.availableAt(A, "parse"), 0, "losing a race is not a failure");
    assert.deepEqual(names(router.order([A, B], "parse")), ["b", "a"], "but the winner goes first next time");
  });
  it("does not start a second model when the first answers in time", async () => {
    const outcome = await runWithFallback(new ModelRouter({ hedgeMs: 200 }), [A, B], "parse", async () => "quick");
    assert.equal(outcome.attempts, 1);
  });
  it("never runs a paid model beside another one", async () => {
    const started = [];
    const outcome = await runWithFallback(new ModelRouter({ hedgeMs: 10 }), [A, paid], "parse", async (route, signal) => {
      started.push(route.model);
      await sleep(60, signal);
      return route.model;
    });
    assert.deepEqual(started, ["a"]);
    assert.equal(outcome.value, "a");
  });
  it("a quick refusal does not use up an attempt, so busy models are moved past for free", async () => {
    const many = "abcdefg".split("").map(free);
    const tried = [];
    const outcome = await runWithFallback(new ModelRouter({ hedgeMs: 0 }), many, "parse", async (route) => {
      tried.push(route.model);
      if (tried.length < 6) throw new AttemptError("provider_http_429", true);
      return route.model;
    });
    assert.equal(tried.length, 6, "five quick 429s, then an answer: more than MAX_ATTEMPTS models were reached");
    assert.equal(outcome.value, "f");
    // A refusal that took 3 s (on a fake clock) is not "quick": it counts.
    let t = 0, slowCalls = 0;
    const clock = { now: () => t };
    await assert.rejects(runWithFallback(new ModelRouter({ hedgeMs: 0, now: clock.now }), many, "parse", async () => { slowCalls++; t += 3_000; throw new AttemptError("provider_http_429", true); }, clock), /providers_unavailable/);
    assert.equal(slowCalls, MAX_ATTEMPTS, "a slow refusal still counts");
  });
  it("stops at the attempt cap and at the time budget", async () => {
    let calls = 0;
    await assert.rejects(runWithFallback(new ModelRouter({ hedgeMs: 0 }), [A, B, C, D, E], "parse", async () => { calls++; throw new AttemptError("provider_http_503", true); }), /providers_unavailable/);
    assert.equal(calls, MAX_ATTEMPTS);
    const began = Date.now();
    let aborted = 0;
    await assert.rejects(runWithFallback(new ModelRouter({ hedgeMs: 0, budgetMs: 40 }), [A, B], "parse", (_route, signal) => {
      signal.addEventListener("abort", () => { aborted++; });
      return sleep(5_000, signal);
    }), /providers_unavailable/);
    assert.ok(Date.now() - began < 1_000);
    assert.equal(aborted, 1);
  });
  it("ends the request on a refusal or a rejected key without trying another model", async () => {
    for (const reason of ["provider_refusal", "provider_http_401"]) {
      let calls = 0;
      await assert.rejects(runWithFallback(new ModelRouter({ hedgeMs: 0 }), [A, B], "parse", async () => { calls++; throw new AttemptError(reason, false); }), new RegExp(reason));
      assert.equal(calls, 1);
    }
  });
});

describe("through the provider layer", () => {
  const env = { OPENROUTER_API_KEY: "k", ORION_COMPAT_MODELS: "a,b,c" };
  it("routes around a rate-limited model on later requests and reads Retry-After", async () => {
    const router = new ModelRouter({ hedgeMs: 0 });
    const seen = [];
    const fetchImpl = async (_url, init) => {
      const model = JSON.parse(init.body).model;
      seen.push(model);
      return model === "a" ? new Response("{}", { status: 429, headers: { "retry-after": "300" } }) : chat('{"note":"ok"}');
    };
    assert.equal((await structured(request(), { env, fetchImpl, router })).ai.attempts, 2);
    assert.equal((await structured(request(), { env, fetchImpl, router })).ai.attempts, 1);
    assert.deepEqual(seen, ["a", "b", "b"]);
    assert.ok(router.availableAt(compatibleRoutes(env)[0], "parse") >= Date.now() + 290_000);
  });
  it("stops asking a model for a schema it cannot produce, but still uses it elsewhere", async () => {
    const router = new ModelRouter({ hedgeMs: 0 });
    const seen = [];
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      seen.push(body.model);
      return body.model === "a" && seen.length === 1 ? chat("Sure! Here is my answer.") : chat('{"note":"ok"}');
    };
    await structured(request("score"), { env, fetchImpl, router });
    await structured(request("score"), { env, fetchImpl, router });
    await structured(request("triage"), { env, fetchImpl, router });
    assert.deepEqual(seen, ["a", "b", "b", "a"]);
  });
  it("hedges a stalled free model with the next one", async () => {
    const router = new ModelRouter({ hedgeMs: 15 });
    const fetchImpl = (_url, init) => JSON.parse(init.body).model === "a"
      ? new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
      : Promise.resolve(chat('{"note":"from b"}'));
    const began = Date.now();
    const result = await structured(request(), { env, fetchImpl, router });
    assert.equal(result.data.note, "from b");
    assert.equal(result.ai.attempts, 2);
    assert.ok(Date.now() - began < 2_000);
  });
  it("reports each model's state on /health", async () => {
    const handle = handler({ env, fetchImpl: async (_url, init) => JSON.parse(init.body).model === "a" ? new Response("{}", { status: 404 }) : chat('{"keep":[]}') });
    await invoke(handle, "/decision/triage", { context: "Cook or order?", candidates: ["Which matters most?", "Cost or time?"], budget: 1 });
    const health = await new Promise((resolve) => handle({ method: "GET", url: "/health", headers: {} }, { writeHead() {}, end: (body) => resolve(JSON.parse(body)) }));
    assert.equal(health.models["compatible:a"].status, "gone");
    assert.ok(health.models["compatible:a"].retryInSeconds > 3600);
    assert.equal(health.models["compatible:b"].status, "ok");
    assert.equal(health.routing.triage[0].model, "b", "health shows the order the next request will use");
  });
});

describe("self-refreshing free pool", () => {
  const listing = { models: [
    { id: "qwen/q:free", kind: "chat", source: "https://openrouter.ai/qwen/q:free", health: "ok", zo_score: 59, answering_now: false },
    { id: "cohere/c:free", kind: "chat", source: "https://openrouter.ai/cohere/c:free", health: "ok", zo_score: 18, answering_now: true },
    { id: "google/sick:free", kind: "chat", source: "https://openrouter.ai/google/sick:free", health: "sick", zo_score: 90 },
    { id: "nvidia/n:free", kind: "chat", source: "https://openrouter.ai/nvidia/n:free", health: "ok", zo_score: 99 },
    { id: "google/music", kind: "other", source: "https://openrouter.ai/google/music", health: "ok" },
    { id: "openai/gpt-paid", kind: "chat", source: "https://openrouter.ai/openai/gpt-paid", health: "ok", zo_score: 100 },
    { id: "x/unprobed:free", kind: "chat", source: "https://openrouter.ai/x/unprobed:free", health: null },
    { id: "pollinations/p", kind: "chat", source: "https://pollinations.ai", health: "ok" },
    { id: "../evil:free", kind: "chat", source: "https://openrouter.ai/x", health: "ok" },
  ] };
  it("takes only healthy, free, chat models from non-training providers, the one answering now first", () => {
    assert.deepEqual(pickFreeModels(listing), ["cohere/c:free", "qwen/q:free"]);
    assert.deepEqual(pickFreeModels({ nope: true }), []);
    assert.deepEqual(pickFreeModels("<html>"), []);
  });
  it("adds discovered models after the operator's own, refreshes in the background and keeps the last list on failure", async () => {
    let now = 0, up = true, fetches = 0;
    const router = new ModelRouter({ now: () => now });
    const fetchImpl = async () => { fetches++; return up ? Response.json(listing) : new Response("", { status: 500 }); };
    assert.deepEqual(router.discoveredModels(fetchImpl), [], "nothing yet: the first request is not held up");
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(router.discoveredModels(fetchImpl), ["cohere/c:free", "qwen/q:free"]);
    assert.equal(fetches, 1, "cached");
    assert.deepEqual(names(compatibleRoutes({ OPENROUTER_API_KEY: "k", ORION_COMPAT_MODELS: "mine/one:free" }, router.discoveredModels(fetchImpl))), ["mine/one:free", "cohere/c:free", "qwen/q:free"]);
    assert.deepEqual(names(compatibleRoutes({ ORION_COMPAT_BASE_URL: "https://example.test/v1", ORION_COMPAT_MODELS: "m" }, ["cohere/c:free"])), ["m"], "only OpenRouter gets OpenRouter ids");
    now = 7 * 3_600_000; up = false;
    router.discoveredModels(fetchImpl);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(router.discoveredModels(fetchImpl), ["cohere/c:free", "qwen/q:free"]);
    assert.equal(fetches, 2);
  });
  it("is off unless asked for", async () => {
    let listed = 0;
    await structured(request(), { env: { OPENROUTER_API_KEY: "k" }, fetchImpl: async (url) => { if (String(url).includes("githubusercontent")) listed++; return chat('{"note":"ok"}'); } });
    assert.equal(listed, 0);
  });
});

describe("racing for the question", () => {
  it("starts two models together for parse, and keeps the usual delay for other tasks", () => {
    const router = new ModelRouter();
    const route = { provider: "compatible", model: "m", apiKey: "", baseUrl: "https://x.test" };
    assert.ok(router.hedgeDelay(route, "parse") > 0 && router.hedgeDelay(route, "parse") < 10);
    assert.ok(router.hedgeDelay(route, "score") >= 3000);
    assert.equal(new ModelRouter({ hedgeMs: 0 }).hedgeDelay(route, "parse"), 0, "an operator can still turn hedging off");
  });
});
