// Property tests live with unit tests: monotonicity, identity, normalization (§48).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expectedUtility, normalizeProbabilities, normalizeWeights } from "../src/decision-engine/expectedValue.ts";
import { scoreAll } from "../src/decision-engine/uncertainty.ts";
import { runScenarios } from "../src/decision-engine/scenarios.ts";
import { sensitivity } from "../src/decision-engine/sensitivity.ts";
import { shouldStop } from "../src/decision-engine/stoppingRule.ts";
import { parseLocally } from "../src/ai/extractDecision.ts";
import { classifySafety } from "../src/decision-engine/safety.ts";

const factors = [
  { id: "money", label: "Money", weight: 0.6 },
  { id: "time", label: "Time", weight: 0.4 },
];
const optA = {
  id: "a", label: "Cook", reversibility: 0.95,
  outcomes: [
    { id: "a1", label: "good", probability: 0.7, probabilityConfidence: 0.8, factors: [{ factorId: "money", value: 6 }, { factorId: "time", value: -2 }] },
    { id: "a2", label: "bad", probability: 0.3, probabilityConfidence: 0.8, factors: [{ factorId: "money", value: 2 }, { factorId: "time", value: -6 }] },
  ],
};
const optB = {
  id: "b", label: "Order", reversibility: 0.9,
  outcomes: [
    { id: "b1", label: "good", probability: 0.9, probabilityConfidence: 0.9, factors: [{ factorId: "money", value: -3 }, { factorId: "time", value: 6 }] },
    { id: "b2", label: "bad", probability: 0.1, probabilityConfidence: 0.9, factors: [{ factorId: "money", value: -5 }, { factorId: "time", value: 2 }] },
  ],
};

describe("expected utility", () => {
  it("weighted outcome value", () => {
    // A: 0.7*(6*.6 + -2*.4) + 0.3*(2*.6 + -6*.4) = 0.7*2.8 + 0.3*-1.2 = 1.6
    assert.equal(Math.round(expectedUtility(optA, factors) * 100) / 100, 1.6);
  });
  it("normalizes probabilities", () => {
    const outs = normalizeProbabilities([
      { id: "x", label: "x", probability: 2, probabilityConfidence: 1, factors: [] },
      { id: "y", label: "y", probability: 2, probabilityConfidence: 1, factors: [] },
    ]);
    assert.equal(outs[0].probability + outs[1].probability, 1);
  });
  it("identical options identical JEV", () => {
    assert.equal(expectedUtility(optA, factors), expectedUtility({ ...optA, id: "a2" }, factors));
  });
  it("monotonicity: raising upside never lowers EU", () => {
    const better = { ...optA, outcomes: optA.outcomes.map((o, i) => (i === 0 ? { ...o, factors: [{ factorId: "money", value: 9 }, { factorId: "time", value: -2 }] } : o)) };
    assert.ok(expectedUtility(better, factors) >= expectedUtility(optA, factors));
  });
  it("weights normalize to 1", () => {
    const n = normalizeWeights([{ id: "a", label: "a", weight: 2 }, { id: "b", label: "b", weight: 2 }]);
    assert.equal(n[0].weight + n[1].weight, 1);
  });
});

describe("uncertainty + scenarios + sensitivity", () => {
  it("low confidence widens band", () => {
    const hi = scoreAll([{ ...optA, outcomes: optA.outcomes.map((o) => ({ ...o, probabilityConfidence: 0.95 })) }], factors)[0];
    const lo = scoreAll([{ ...optA, outcomes: optA.outcomes.map((o) => ({ ...o, probabilityConfidence: 0.1 })) }], factors)[0];
    assert.ok(lo.uncertaintyWidth > hi.uncertaintyWidth);
  });
  it("scenarios report stability", () => {
    const s = runScenarios([optA, optB], factors);
    assert.ok(["high", "medium", "low"].includes(s.stability));
  });
  it("sensitivity names dominant factors", () => {
    const s = sensitivity([optA, optB], factors);
    assert.ok(s.dominantFactors.length > 0 && s.flips.length > 0);
  });
});

describe("sensitivity wording", () => {
  const factors = [{ id: "f", label: "Cost", weight: 1 }];
  const option = (id, value) => ({ id, label: id, reversibility: 0.5,
    outcomes: [{ id: `${id}-o`, label: id, probability: 1, probabilityConfidence: 0.8, factors: [{ factorId: "f", value }] }] });
  it("calls a wide lead wide, not nearly equivalent", () => {
    const wide = sensitivity([option("A", 8), option("B", -2)], factors).flips[0];
    assert.match(wide.description, /"A" leads by a wide margin \(gap 10\.0\)/);
    assert.doesNotMatch(wide.description, /equivalent/);
  });
  it("still names a factor flip when the lead is narrow", () => {
    assert.match(sensitivity([option("A", 3), option("B", 1)], factors).flips[0].description, /becomes competitive/);
  });
});

describe("stopping rule", () => {
  it("stops on strong leader", () => {
    assert.equal(shouldStop({ gap: 5, stakes: "normal", reversibility: 0.5, questionsAsked: 1, maxQuestions: 3 }).stop, true);
  });
  it("keeps asking on close call", () => {
    assert.equal(shouldStop({ gap: 0.2, stakes: "significant", reversibility: 0.3, questionsAsked: 0, maxQuestions: 3 }).stop, false);
  });
});

describe("parsing + safety", () => {
  it("extracts A/B options", () => {
    const e = parseLocally("Should I cook tonight or order something?");
    assert.equal(e.options.length, 2);
  });
  it("flags health advice", () => {
    assert.equal(classifySafety("My doctor suggested surgery, should I do it?"), "health-high-stakes");
  });
});
