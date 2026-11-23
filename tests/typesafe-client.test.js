// The System One transport (server/typesafe.ts) against the current HTTP contract (docs.typesafe.ai/api/system-one.md,
// api/errors.md): the pinned model, the override, which statuses are retried, Retry-After, and error codes. No network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JEV_MODEL, TypeSafeError, jevModel, systemOne } from "../server/typesafe.ts";

const ok = (model = JEV_MODEL) => Response.json({ model, answers: { q: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: null } });
const questions = { q: { type: "noul", instructions: "Is `x` a fruit?" } };
function fake(replies) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); const r = replies.shift(); return typeof r === "function" ? r() : r; } };
}

describe("System One client", () => {
  it("pins Jev 1.14 by default, and TYPESAFE_MODEL overrides it", async () => {
    assert.equal(JEV_MODEL, "jev-1.14.0");
    assert.equal(jevModel({}), "jev-1.14.0");
    assert.equal(jevModel({ TYPESAFE_MODEL: " jev-preview " }), "jev-preview");
    const f = fake([ok()]);
    const res = await systemOne({ x: "apple" }, questions, { apiKey: "k", fetchImpl: f.fetchImpl });
    assert.equal(f.calls[0].url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(f.calls[0].body.model, "jev-1.14.0");
    assert.equal(f.calls[0].auth, "Bearer k");
    assert.equal(res.answers.q.noul, 0.9);
    assert.equal(res.usage.output_tokens, null, "usage counts may be null");
  });
  it("retries 529 and 429, waiting what Retry-After says", async () => {
    const f = fake([new Response("busy", { status: 529 }), new Response("slow down", { status: 429, headers: { "Retry-After": "0.05" } }), ok()]);
    const started = performance.now();
    await systemOne("s", questions, { apiKey: "k", fetchImpl: f.fetchImpl });
    assert.equal(f.calls.length, 3);
    assert.ok(performance.now() - started >= 390, "exponential backoff before the second attempt");
  });
  it("fails at once on the request's own errors, with the status and code", async () => {
    for (const [status, body, code] of [[401, '{"detail":"Not authenticated"}', undefined], [422, '{"detail":[{"loc":["body","model"],"msg":"Field required","type":"missing"}]}', undefined], [400, '{"detail":"max_tokens_exceeded"}', "max_tokens_exceeded"]]) {
      const f = fake([new Response(body, { status })]);
      await assert.rejects(systemOne("s", questions, { apiKey: "k", fetchImpl: f.fetchImpl }), (e) => e instanceof TypeSafeError && e.status === status && e.code === code && !e.retryable);
      assert.equal(f.calls.length, 1, `${status} is not retried`);
    }
  });
  it("retries a network failure, then gives up with a retryable error", async () => {
    const f = fake([() => { throw new TypeError("fetch failed"); }, () => { throw new TypeError("fetch failed"); }]);
    await assert.rejects(systemOne("s", questions, { apiKey: "k", fetchImpl: f.fetchImpl, attempts: 2 }), (e) => e instanceof TypeSafeError && e.code === "network" && e.retryable);
    assert.equal(f.calls.length, 2);
  });
  it("needs a key", async () => {
    await assert.rejects(systemOne("s", questions, { apiKey: "", fetchImpl: async () => ok() }), /TYPESAFE_API_KEY/);
  });
});
