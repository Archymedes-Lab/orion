import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWithAI, scoreWithAI, scoreWithJev, explainWithAI } from "../server/decision-ai.ts";
import { BUSINESS_PLAYBOOK, companyBrief, isBusinessDecision } from "../server/business.ts";
import { BusinessProfileSchema, profileSummary } from "../src/business/schema.ts";
import { ParseRequestSchema, ScoreRequestSchema } from "../src/ai/contracts.ts";
import { parseLocally } from "../src/ai/extractDecision.ts";
import { BUSINESS_TEMPLATES } from "../src/decision-engine/templates.ts";
import { buildOptionsFromScores } from "../src/ai/model.ts";
import { extraction, scoreInput, scoresFor, openaiResponse } from "./helpers/ai.js";

const env = { OPENAI_API_KEY: "test" };
const profile = { name: "Acme", industry: "B2B software", stage: "early", team: "2–10", runwayMonths: 7, risk: "cautious", goal: "survive" };
/** Captures the instructions each provider call was given. */
const capture = (data) => {
  const seen = [];
  return { seen, fetchImpl: async (_url, init) => { seen.push(JSON.parse(init.body).instructions); return openaiResponse(data); } };
};

describe("business detection", () => {
  it("reads company questions as business and personal ones as personal", () => {
    for (const q of ["Should we raise our prices or keep them?", "Hire a contractor for our startup or wait?", "Which vendor for payroll?",
      "Should we take the seed round on these terms?", "Is our churn high enough to change the pricing model?"]) {
      assert.ok(isBusinessDecision(q), q);
    }
    for (const q of ["Pizza or tacos?", "Should I take the job or stay at my company?", "Should I hire a cleaner?", "Buy a car or lease?"]) {
      assert.ok(!isBusinessDecision(q), q);
    }
  });
  it("treats an explicit business mode as business whatever the wording", () => {
    assert.ok(isBusinessDecision("Coffee machine A or B?", {}));
  });
});

describe("company profile", () => {
  it("accepts a partial profile and rejects unknown fields and out-of-range runway", () => {
    assert.ok(BusinessProfileSchema.safeParse({}).success);
    assert.ok(BusinessProfileSchema.safeParse(profile).success);
    assert.ok(!BusinessProfileSchema.safeParse({ runwayMonths: -1 }).success);
    assert.ok(!BusinessProfileSchema.safeParse({ revenue: 1000 }).success);
    assert.ok(!ParseRequestSchema.safeParse({ input: "x", business: { stage: "unicorn" } }).success);
    assert.ok(ScoreRequestSchema.parse({ ...scoreInput, business: profile }).business);
  });
  it("only describes what was given and says the rest is unknown", () => {
    const brief = companyBrief({ stage: "growing", runwayMonths: 14 });
    assert.match(brief, /Stage: Growing/);
    assert.match(brief, /about 14 months/);
    assert.doesNotMatch(brief, /Team size|Industry/);
    assert.match(brief, /not listed is unknown/);
    assert.match(companyBrief(undefined), /Do not assume/);
    assert.equal(profileSummary(profile), "Acme · B2B software · Early: first customers · 2–10 people · 7 months runway");
  });
});

describe("business playbook in model calls", () => {
  it("is sent for a business decision with the company brief, and not for a personal one", async () => {
    const business = capture({ ...extraction, category: ["Money"] });
    const result = await parseWithAI("Should we hire or use contractors?", { env, fetchImpl: business.fetchImpl }, profile);
    assert.ok(business.seen[0].includes(BUSINESS_PLAYBOOK));
    assert.match(business.seen[0], /BUSINESS PARSING RULES/);
    assert.match(business.seen[0], /about 7 months at current burn/);
    // Business mode files the decision under Business even when the model did not.
    assert.equal(result.category[0], "Business");

    const personal = capture(extraction);
    await parseWithAI("Should I cook or order food?", { env, fetchImpl: personal.fetchImpl });
    assert.ok(!personal.seen[0].includes("BUSINESS"));
  });
  it("scores with the business rubric and keeps code in charge of the numbers", async () => {
    const calls = capture({ scores: scoresFor(scoreInput) });
    const result = await scoreWithAI({ ...scoreInput, business: profile }, { env, fetchImpl: calls.fetchImpl });
    assert.match(calls.seen[0], /BUSINESS SCORING RUBRIC/);
    assert.equal(result.scores.length, 4);
  });
  it("tells Jev it is scoring for a company", async () => {
    let state = null;
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      state = body.state;
      const answers = Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: "score", score: 2, legend: {}, probabilities: {}, confidence: 0.6 }]));
      return Response.json({ model: "jev-test", answers, usage: { input_tokens: 1, output_tokens: 1 } });
    };
    await scoreWithJev({ ...scoreInput, business: profile }, { apiKey: "k", fetchImpl });
    assert.match(state.lens, /business decision/);
    assert.match(state.company, /Acme/);
    await scoreWithJev(scoreInput, { apiKey: "k", fetchImpl });
    assert.equal(state.lens, undefined);
  });
  it("explains in business terms only when asked for a business", async () => {
    const factors = [{ id: "cost", label: "Cost", weight: 0.6 }, { id: "time", label: "Time", weight: 0.4 }];
    const model = { options: buildOptionsFromScores(scoreInput.options, factors, scoresFor(scoreInput)), factors, safety: "normal" };
    const calls = capture({ tradeoffs: "Cash dominates." });
    await explainWithAI({ ...model, business: {} }, { env, fetchImpl: calls.fetchImpl });
    await explainWithAI(model, { env, fetchImpl: calls.fetchImpl });
    assert.match(calls.seen[0], /BUSINESS EXPLANATION/);
    assert.ok(!calls.seen[1].includes("BUSINESS"));
  });
});

describe("business offline", () => {
  it("files business questions under Business with business factors", () => {
    const e = parseLocally("Should we raise our prices or keep them?");
    assert.equal(e.category[0], "Business");
    assert.ok(e.factors.some((f) => f.label === "Cash and runway"));
    assert.equal(parseLocally("Coffee machine A or B?", true).category[0], "Business");
    assert.equal(parseLocally("Accept this offer or keep looking?").category[0], "Career");
  });
  it("has complete business templates phrased for a team", () => {
    assert.ok(BUSINESS_TEMPLATES.length >= 6);
    for (const t of BUSINESS_TEMPLATES) {
      assert.equal(t.audience, "business");
      assert.ok(t.category.includes("Business"), t.id);
      assert.ok(t.factors.length >= 4 && t.factors.length <= 7, t.id);
    }
    assert.equal(BUSINESS_TEMPLATES[0].question(["Hire full-time", "Use a contractor"]), "Should we hire full-time or use a contractor?");
  });
});

describe("lean, forgiving parse", () => {
  it("asks only for what the answer needs, and fits small models' shapes instead of rejecting them", async () => {
    const sloppy = {
      title: "Decision: " + "x".repeat(200), category: "Money", stakes: "normal", safety: "normal", missingInformation: [],
      options: [{ label: "Stay", generated: false }, { label: "Go", generated: false }],
      factors: [{ label: "A very long factor label that runs well past forty characters", importance: 0.6, reason: "r", pace: "fast" }, { label: "Cost", importance: 0.4, reason: "r", pace: "sideways" }],
    };
    const call = capture(sloppy);
    const result = await parseWithAI("Stay or go?", { env, fetchImpl: call.fetchImpl });
    assert.doesNotMatch(call.seen[0], /obligations|generatedOptions|rationale/);
    assert.deepEqual(result.category, ["Money"]);
    assert.ok(result.title.length <= 120);
    assert.ok(result.factors[0].label.length <= 40);
    assert.equal(result.factors[0].pace, "fast");
    assert.equal(result.factors[1].pace, undefined);
  });
});
