import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { structured } from "../server/providers.ts";
import { routesFor, OUTPUT_LIMITS } from "../server/models.ts";
import { openaiResponse, anthropicResponse } from "./helpers/ai.js";

const env = { OPENAI_API_KEY: "test-openai", ANTHROPIC_API_KEY: "test-anthropic" };
const request = (task) => ({ task, instructions: "Return a note", input: "data",
  schema: { type: "object", properties: { note: { type: "string" } }, required: ["note"], additionalProperties: false },
  validate: z.object({ note: z.string().min(1) }),
});

describe("lightweight provider routing", () => {
  it("uses nano for extraction/triage, mini for scoring, and Haiku for explanations", () => {
    assert.match(routesFor("parse", env)[0].model, /nano/);
    assert.match(routesFor("triage", env)[0].model, /nano/);
    assert.match(routesFor("score", env)[0].model, /mini/);
    assert.match(routesFor("explain", env)[0].model, /haiku/);
  });
  it("works with either provider configured alone", () => {
    for (const task of ["parse", "score", "triage", "explain"]) {
      assert.equal(routesFor(task, { OPENAI_API_KEY: "test" }).length, 1);
      assert.equal(routesFor(task, { ANTHROPIC_API_KEY: "test" })[0].provider, "anthropic");
    }
  });
  it("rejects arbitrary or premium model overrides", () => {
    assert.throws(() => routesFor("score", { ...env, ORION_OPENAI_SCORING_MODEL: "expensive-model" }), /Unsupported/);
    assert.throws(() => routesFor("parse", { ...env, ORION_OPENAI_SMALL_MODEL: "claude-haiku-4-5-20251001" }), /Unsupported/);
  });
  it("does not call a provider when keys are absent", async () => {
    await assert.rejects(() => structured(request("parse"), { env: {}, fetchImpl: () => { assert.fail("No paid call"); } }), /not_configured/);
  });
});

describe("provider contracts and costs", () => {
  it("uses Responses structured output, disables storage, bounds output and accounts for cached tokens", async () => {
    const result = await structured(request("parse"), { env, fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(init.headers.Authorization, "Bearer test-openai");
      const body = JSON.parse(init.body);
      assert.equal(body.store, false);
      assert.equal(body.max_output_tokens, OUTPUT_LIMITS.parse);
      assert.deepEqual(body.reasoning, { effort: "none" });
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.schema.additionalProperties, false);
      return openaiResponse({ note: "Ready" });
    } });
    assert.equal(result.data.note, "Ready");
    assert.equal(result.ai.attempts, 1);
    assert.ok(Math.abs(result.ai.usage.successfulCallCostUsd - 0.000432) < 1e-12);
  });
  it("uses low reasoning only for scoring", async () => {
    await structured(request("score"), { env, fetchImpl: async (_url, init) => {
      assert.equal(JSON.parse(init.body).reasoning.effort, "low");
      return openaiResponse({ note: "Ready" });
    } });
  });
  it("uses Anthropic Messages with its actual structured-output contract and no thinking budget", async () => {
    const result = await structured(request("explain"), { env, fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(init.headers["x-api-key"], "test-anthropic");
      assert.equal(init.headers["anthropic-version"], "2023-06-01");
      const body = JSON.parse(init.body);
      assert.equal(body.max_tokens, OUTPUT_LIMITS.explain);
      assert.equal(body.output_config.format.type, "json_schema");
      assert.equal(body.thinking, undefined);
      return anthropicResponse({ note: "Ready" });
    } });
    assert.equal(result.ai.provider, "anthropic");
    assert.equal(result.ai.usage.successfulCallCostUsd, 0.002);
  });
  it("does not invent usage when the provider omits it", async () => {
    const result = await structured(request("parse"), { env, fetchImpl: async () => openaiResponse({ note: "Ready" }, { usage: null }) });
    assert.equal(result.ai.usage, null);
  });
});

describe("bounded provider failure", () => {
  it("falls back once on overload, without retrying the same provider", async () => {
    const calls = [];
    const result = await structured(request("parse"), { env, fetchImpl: async (url) => {
      calls.push(url);
      return calls.length === 1 ? new Response("overload", { status: 429 }) : anthropicResponse({ note: "Recovered" });
    } });
    assert.equal(calls.length, 2);
    assert.equal(result.ai.provider, "anthropic");
    assert.equal(result.ai.attempts, 2);
  });
  it("falls back on schema-invalid output and rejects it when both providers fail", async () => {
    let calls = 0;
    await assert.rejects(() => structured(request("parse"), { env, fetchImpl: async () => {
      return ++calls === 1 ? openaiResponse({ note: 3 }) : anthropicResponse({ note: 4 });
    } }), /providers_unavailable/);
    assert.equal(calls, 2);
  });
  it("does not spend a second call on authentication errors or refusals", async () => {
    for (const response of [new Response("secret-key-do-not-expose", { status: 401 }),
      openaiResponse(null, { output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] })]) {
      let calls = 0;
      await assert.rejects(() => structured(request("parse"), { env, fetchImpl: async () => { calls++; return response; } }));
      assert.equal(calls, 1);
    }
  });
  it("rejects incomplete output rather than applying partial data", async () => {
    const result = await structured(request("parse"), { env, fetchImpl: async (url) => url.includes("openai") ?
      openaiResponse({ note: "Partial" }, { status: "incomplete" }) : anthropicResponse({ note: "Complete" }) });
    assert.equal(result.data.note, "Complete");
  });
  it("aborts stalled providers and terminates after two attempts", async () => {
    let calls = 0;
    await assert.rejects(() => structured(request("parse"), { env, timeoutMs: 5, fetchImpl: async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } }), /providers_unavailable/);
    assert.equal(calls, 2);
  });
});

describe("OpenAI-compatible free models", () => {
  const free = { OPENROUTER_API_KEY: "or-key" };
  const chat = (content, extra = {}) => Response.json({ choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 50, completion_tokens: 9 }, ...extra });

  it("keeps a free model free: OpenRouter is told the most it may charge is nothing", async () => {
    const bodies = [];
    const fetchImpl = async (url, init) => { bodies.push({ url: String(url), body: JSON.parse(init.body) }); return chat(JSON.stringify({ keep: [] })); };
    const { structured } = await import("../server/providers.ts");
    const { z } = await import("zod");
    const request = { task: "triage", instructions: "x", input: {}, schema: { type: "object" }, validate: z.object({ keep: z.array(z.string()) }) };
    await structured(request, { env: { ...free, ORION_COMPAT_MODELS: "vendor/model:free" }, fetchImpl });
    assert.deepEqual(bodies[0].body.provider, { max_price: { prompt: 0, completion: 0 } });
    assert.equal(bodies[0].body.reasoning, undefined, "reasoning effort only where a model's profile asks for it");
    await structured(request, { env: { ...free, ORION_COMPAT_MODELS: "cohere/north-mini-code:free" }, fetchImpl });
    assert.deepEqual(bodies.at(-1).body.reasoning, { effort: "low" });
    await structured(request, { env: { ORION_COMPAT_BASE_URL: "https://example.test/v1", ORION_COMPAT_MODELS: "local-model" }, fetchImpl });
    assert.equal(bodies.at(-1).body.provider, undefined, "other endpoints get no OpenRouter-only fields");
  });
  it("is off by default, uses OpenRouter free models with a key, and goes before paid providers", async () => {
    const { compatibleRoutes } = await import("../server/models.ts");
    assert.deepEqual(compatibleRoutes({}), []);
    const routes = routesFor("score", { ...env, ...free });
    // The default free pool (its size changes as free models come and go) goes first, then the paid providers.
    const pool = routes.filter((r) => r.provider === "compatible");
    assert.ok(pool.length >= 2);
    assert.deepEqual(routes.map((r) => r.provider), [...pool.map(() => "compatible"), "openai", "anthropic"]);
    assert.ok(pool.every((r) => r.model.endsWith(":free")));
    assert.equal(routes[0].baseUrl, "https://openrouter.ai/api/v1");
    const custom = compatibleRoutes({ ORION_COMPAT_BASE_URL: "https://example.test/openai/", ORION_COMPAT_MODELS: "a, b, c" });
    assert.deepEqual(custom.map((r) => [r.model, r.baseUrl, r.apiKey]), ["a", "b", "c"].map((m) => [m, "https://example.test/openai", ""]));
    assert.equal(compatibleRoutes({ ORION_COMPAT_BASE_URL: "https://example.test/v1", ORION_COMPAT_MODELS: "a,b,c,d,e,f,g,h,i,j" }).length, 8);
    assert.throws(() => compatibleRoutes({ ORION_COMPAT_BASE_URL: "http://example.test" }), /https/);
    assert.throws(() => compatibleRoutes({ ORION_COMPAT_BASE_URL: "https://example.test" }), /ORION_COMPAT_MODELS/);
  });
  it("runs up to two more endpoints beside the first, interleaved so the first two tries reach different providers", async () => {
    const { compatibleRoutes } = await import("../server/models.ts");
    const routes = compatibleRoutes({
      OPENROUTER_API_KEY: "or", ORION_COMPAT_MODELS: "a:free,b:free",
      ORION_COMPAT_2_BASE_URL: "https://api.groq.com/openai/v1/", ORION_COMPAT_2_API_KEY: "g", ORION_COMPAT_2_MODELS: "fast-1, fast-2, fast-3",
    });
    assert.deepEqual(routes.map((r) => r.model), ["a:free", "fast-1", "b:free", "fast-2", "fast-3"]);
    assert.equal(routes[1].baseUrl, "https://api.groq.com/openai/v1");
    assert.equal(routes[1].apiKey, "g");
    assert.throws(() => compatibleRoutes({ ORION_COMPAT_2_BASE_URL: "https://x.test" }), /ORION_COMPAT_2_MODELS/);
    assert.throws(() => compatibleRoutes({ ORION_COMPAT_3_BASE_URL: "http://x.test", ORION_COMPAT_3_MODELS: "m" }), /https/);
  });
  it("sends the schema in the prompt and accepts JSON wrapped in a code fence, at no cost", async () => {
    const result = await structured(request("parse"), { env: free, fetchImpl: async (url, init) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(init.headers.Authorization, "Bearer or-key");
      const body = JSON.parse(init.body);
      assert.match(body.messages[0].content, /"additionalProperties":false/);
      assert.equal(body.messages[1].content, JSON.stringify("data"));
      return chat('Here you go:\n```json\n{"note": "ok"}\n```');
    } });
    assert.deepEqual(result.data, { note: "ok" });
    assert.equal(result.ai.provider, "compatible");
    assert.equal(result.ai.usage.successfulCallCostUsd, 0);
  });
  it("moves to the next free model when one is rate limited or answers with prose", async () => {
    const seen = [];
    const result = await structured(request("triage"), { env: free, fetchImpl: async (_url, init) => {
      const model = JSON.parse(init.body).model;
      seen.push(model);
      return seen.length === 1 ? new Response("{}", { status: 429 }) : chat('{"note":"second"}');
    } });
    assert.equal(seen.length, 2);
    assert.notEqual(seen[0], seen[1]);
    assert.equal(result.ai.attempts, 2);
    await assert.rejects(() => structured(request("parse"), { env: free, fetchImpl: async () => chat("I cannot produce JSON.") }), /providers_unavailable/);
  });
  it("stops at once on a rejected key and sends no Authorization header to a keyless endpoint", async () => {
    let calls = 0;
    await assert.rejects(() => structured(request("parse"), { env: free, fetchImpl: async () => { calls++; return new Response("{}", { status: 401 }); } }), /provider_http_401/);
    assert.equal(calls, 1);
    await structured(request("parse"), { env: { ORION_COMPAT_BASE_URL: "https://example.test/v1", ORION_COMPAT_MODELS: "m" }, fetchImpl: async (_url, init) => {
      assert.equal("Authorization" in init.headers, false);
      return chat('{"note":"ok"}');
    } });
  });
});
