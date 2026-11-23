import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handler } from "../server/index.ts";
import { explainLocal } from "../src/ai/explainDecision.ts";

const parse = (input) => new Promise((resolve, reject) => {
  const request = Readable.from([JSON.stringify({ input })]);
  request.method = "POST";
  request.url = "/decision/parse";
  const response = {
    writeHead(code) { this.status = code; },
    end(body) { resolve({ status: this.status, body: JSON.parse(body) }); },
  };
  // An explicit empty environment: Bun loads .env, and tests must never reach a real provider.
  handler({ env: {} })(request, response).catch(reject);
});

describe("API local fallback", () => {
  it("preserves safety classification and reports fallback when there is no provider key", async () => {
    const crisis = await parse("I want to kill myself");
    assert.equal(crisis.status, 200);
    assert.equal(crisis.body.safety, "crisis");
    assert.equal(crisis.body.fallback, true);
    const health = await parse("Should I have surgery?");
    assert.equal(health.body.safety, "health-high-stakes");
  });
});

it("explains equal scores as a tie", () => {
  const text = explainLocal({ leaderLabel: "Cook", runnerLabel: "Order", leaderJev: 0,
    runnerJev: 0, topFactors: [], flipNote: "", nextAction: "", stability: "high" });
  assert.match(text, /tied/);
  assert.doesNotMatch(text, /comes out ahead/);
});
