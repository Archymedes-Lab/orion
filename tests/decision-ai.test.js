import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWithAI, scoreWithAI, scoreWithJev, triageWithAI, explainWithAI } from "../server/decision-ai.ts";
import { buildOptionsFromScores, weightsFromImportance } from "../src/ai/model.ts";
import { scoreAll } from "../src/decision-engine/uncertainty.ts";
import { extraction, scoreInput, scoresFor, openaiResponse, anthropicResponse } from "./helpers/ai.js";

const env = { OPENAI_API_KEY: "test" };

describe("semantic AI pipeline", () => {
  it("generates application ids rather than accepting model-generated references", async () => {
    const result = await parseWithAI("Should I cook or order food?", { env, fetchImpl: async () => openaiResponse(extraction) });
    assert.equal(result.fallback, false);
    assert.equal(result.options.length, 2);
    assert.notEqual(result.options[0].id, result.options[1].id);
    assert.notEqual(result.factors[0].id, result.factors[1].id);
  });
  it("preserves local high-stakes flags when the model misses them", async () => {
    const result = await parseWithAI("My doctor suggested surgery", { env, fetchImpl: async () => openaiResponse(extraction) });
    assert.equal(result.safety, "health-high-stakes");
  });
  it("rejects duplicate alternatives and all-zero importance", async () => {
    for (const data of [{ ...extraction, options: ["Cook", "Cook"] },
      { ...extraction, factors: extraction.factors.map((f) => ({ ...f, importance: 0 })) }]) {
      await assert.rejects(() => parseWithAI("Cook or order?", { env, fetchImpl: async () => openaiResponse(data) }));
    }
  });
  it("sends the original context to scoring and leaves weighted math to the engine", async () => {
    const result = await scoreWithAI(scoreInput, { env, fetchImpl: async (_url, init) => {
      const payload = JSON.parse(JSON.parse(init.body).input);
      assert.equal(payload.context, scoreInput.context);
      return openaiResponse({ scores: scoresFor(scoreInput) });
    } });
    const factors = weightsFromImportance(extraction.factors.map((f, i) => ({ ...f, id: scoreInput.factors[i].id })));
    const options = buildOptionsFromScores(scoreInput.options, factors, result.scores);
    assert.deepEqual(scoreAll(options, factors).map((o) => o.jev), [2.8, 0]);
  });
  it("rejects missing, duplicate, unknown, or out-of-range scores", async () => {
    const valid = scoresFor(scoreInput);
    for (const scores of [valid.slice(1), [valid[0], ...valid.slice(0, -1)],
      valid.map((s) => ({ ...s, factorId: "unknown" })), valid.map((s) => ({ ...s, value: 11 })),
      valid.map((s) => ({ ...s, probabilityConfidence: 1.1 }))]) {
      await assert.rejects(() => scoreWithAI(scoreInput, { env, fetchImpl: async () => openaiResponse({ scores }) }));
    }
  });
  it("respects an empty triage result, and rejects invented or duplicate questions", async () => {
    const input = { context: scoreInput.context, candidates: ["Cost or time?", "Energy or enjoyment?"], budget: 2 };
    assert.deepEqual((await triageWithAI(input, { env, fetchImpl: async () => openaiResponse({ keep: [] }) })).keep, []);
    for (const keep of [["Invented question"], [input.candidates[0], input.candidates[0]]]) {
      await assert.rejects(() => triageWithAI(input, { env, fetchImpl: async () => openaiResponse({ keep }) }));
    }
  });
  it("explains the engine's comparison without returning a new model-selected winner", async () => {
    const factors = [{ id: "cost", label: "Cost", weight: 0.6 }, { id: "time", label: "Time", weight: 0.4 }];
    const input = { options: buildOptionsFromScores(scoreInput.options, factors, scoresFor(scoreInput)), factors, safety: "normal" };
    const before = scoreAll(input.options, input.factors);
    const result = await explainWithAI(input, { env: { ANTHROPIC_API_KEY: "test" }, fetchImpl: async (_url, init) => {
      const supplied = JSON.parse(JSON.parse(init.body).messages[0].content);
      assert.equal(supplied.summary.leaderLabel, "Cook");
      assert.equal(supplied.summary.leaderJev, 2.8);
      return anthropicResponse({ tradeoffs: "Cooking saves money but takes time. These estimates are subjective." });
    } });
    assert.match(result.explanation, /Cook comes out ahead/);
    assert.match(result.explanation, /subjective/);
    assert.deepEqual(scoreAll(input.options, input.factors), before);
  });
});

describe("Jev scoring", () => {
  const jevFetch = (score, confidence = 0.8) => async (_url, init) => {
    const { questions } = JSON.parse(init.body);
    const answers = Object.fromEntries(Object.keys(questions).map((k) => [k, { type: "score", score, legend: {}, probabilities: {}, confidence }]));
    return new Response(JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  };
  it("scores every option × factor in one request and maps levels to −10..10", async () => {
    let calls = 0;
    const result = await scoreWithJev(scoreInput, { apiKey: "k", fetchImpl: async (...args) => { calls++; return jevFetch(4, 0.9)(...args); } });
    assert.equal(calls, 1);
    assert.equal(result.scores.length, scoreInput.options.length * scoreInput.factors.length);
    assert.ok(result.scores.every((s) => s.value === 10 && s.probabilityConfidence === 0.9));
  });
  it("rejects an incomplete answer set instead of guessing", async () => {
    const partial = async () => new Response(JSON.stringify({ model: "m", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    await assert.rejects(() => scoreWithJev(scoreInput, { apiKey: "k", fetchImpl: partial }));
  });
});
