// Pure model builders: extraction + Scores → engine inputs (no network).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyAnswerToWeights,
  applyLearnedPriors,
  buildOptionsFromScores,
  hasSignal,
  weightsFromImportance,
} from "../src/ai/model.ts";

const factors = weightsFromImportance([
  { id: "f1", label: "Cost", importance: 1 },
  { id: "f2", label: "Time", importance: 0.5 },
]);

describe("weightsFromImportance", () => {
  it("normalizes to sum 1", () => {
    const sum = factors.reduce((a, f) => a + f.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    assert.ok(factors[0].weight > factors[1].weight);
  });
});

describe("buildOptionsFromScores", () => {
  const opts = [
    { id: "a", label: "Cook" },
    { id: "b", label: "Order" },
  ];
  it("maps scores to values, mean confidence", () => {
    const built = buildOptionsFromScores(opts, factors, [
      { optionId: "a", factorId: "f1", value: 6, probabilityConfidence: 0.8 },
      { optionId: "a", factorId: "f2", value: -2, probabilityConfidence: 0.6 },
    ]);
    const oc = built[0].outcomes[0];
    assert.equal(oc.probability, 1);
    assert.equal(oc.probabilityConfidence, 0.7);
    assert.equal(oc.factors.find((x) => x.factorId === "f1").value, 6);
    // Missing score → neutral 0, not fabricated.
    assert.equal(built[1].outcomes[0].factors.every((x) => x.value === 0), true);
  });
  it("offline null scores → neutral, low confidence", () => {
    const built = buildOptionsFromScores(opts, factors, null);
    assert.equal(hasSignal(built), false);
    assert.equal(built[0].outcomes[0].probabilityConfidence, 0.15);
  });
  it("hasSignal detects real scores", () => {
    const built = buildOptionsFromScores(opts, factors, [
      { optionId: "a", factorId: "f1", value: 3, probabilityConfidence: 0.9 },
    ]);
    assert.equal(hasSignal(built), true);
  });
});

describe("applyAnswerToWeights", () => {
  it("boosts the chosen factor and renormalizes", () => {
    const out = applyAnswerToWeights(factors, "f2");
    const sum = out.reduce((a, f) => a + f.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-3);
    assert.ok(out.find((f) => f.id === "f2").weight > factors[1].weight);
  });
  it("null (equal) and unknown ids leave weights unchanged", () => {
    assert.deepEqual(applyAnswerToWeights(factors, null), factors);
    assert.deepEqual(applyAnswerToWeights(factors, "nope"), factors);
  });
});

describe("applyLearnedPriors", () => {
  it("empty priors leave weights unchanged", () => {
    assert.deepEqual(applyLearnedPriors(factors, {}), factors);
  });
  it("boosts previously-chosen labels, gently and renormalized", () => {
    const out = applyLearnedPriors(factors, { time: 3, cost: 1 });
    const sum = out.reduce((a, f) => a + f.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-3);
    const time = out.find((f) => f.id === "f2").weight;
    // share 0.75 → boost ×1.375 max; must stay a nudge, not a takeover
    assert.ok(time > factors[1].weight);
    assert.ok(time < 0.6);
  });
  it("case-insensitive labels", () => {
    const out = applyLearnedPriors(factors, { COST: 5 });
    assert.ok(out.find((f) => f.id === "f1").weight > factors[0].weight);
  });
});
