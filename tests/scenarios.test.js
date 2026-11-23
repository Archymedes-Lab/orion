// Real multi-outcome behaviour: scenarios must actually change the ranking,
// and the all-or-nothing validation rules must hold on both entry paths.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOptionsFromScores, weightsFromImportance } from "../src/ai/model.ts";
import { expectedUtility } from "../src/decision-engine/expectedValue.ts";
import { scoreAll, uncertaintyBand } from "../src/decision-engine/uncertainty.ts";
import { runScenarios } from "../src/decision-engine/scenarios.ts";
import { flipThresholds } from "../src/decision-engine/sensitivity.ts";
import {
  acceptCases,
  buildScenarios,
  scoreToLikelihood,
  scoreToValue,
} from "../server/typesafe.ts";

const factors = weightsFromImportance([
  { id: "f1", label: "Cost", importance: 1 },
  { id: "f2", label: "Time", importance: 0.5 },
]);

const options = [
  { id: "a", label: "Cook", reversibility: 1 },
  { id: "b", label: "Order", reversibility: 1 },
];

// Same expected impact for both options. Only the spread separates them, so a
// single-outcome model must produce a tie and a scenario model must not.
const flat = [
  { optionId: "a", factorId: "f1", value: 6, probabilityConfidence: 0.6 },
  { optionId: "a", factorId: "f2", value: 6, probabilityConfidence: 0.6 },
  { optionId: "b", factorId: "f1", value: 6, probabilityConfidence: 0.6 },
  { optionId: "b", factorId: "f2", value: 6, probabilityConfidence: 0.6 },
];

const scenarios = [
  {
    optionId: "a",
    label: "Cook — worst case",
    probability: 0.5,
    probabilityConfidence: 0.6,
    values: { f1: -10, f2: -10 },
  },
  {
    optionId: "a",
    label: "Cook — as expected",
    probability: 0.5,
    probabilityConfidence: 0.6,
    values: { f1: 10, f2: 10 },
  },
  {
    optionId: "b",
    label: "Order — as expected",
    probability: 1,
    probabilityConfidence: 0.6,
    values: { f1: 6, f2: 6 },
  },
];

const jevOf = (built, id) =>
  expectedUtility(built.find((o) => o.id === id), factors);
const outcomeCount = (built, id) =>
  built.find((o) => o.id === id).outcomes.length;

describe("multi-outcome scoring", () => {
  it("leaves the single-outcome fallback exactly as before", () => {
    const built = buildOptionsFromScores(options, factors, flat);
    assert.ok(Math.abs(jevOf(built, "a") - jevOf(built, "b")) < 1e-9);
    assert.equal(outcomeCount(built, "a"), 1);
  });

  it("keeps a missing scenarios array backward compatible", () => {
    const built = buildOptionsFromScores(options, factors, flat, {});
    assert.equal(outcomeCount(built, "a"), 1);
  });

  it("separates options with identical expectations once outcomes exist", () => {
    const built = buildOptionsFromScores(options, factors, flat, { scenarios });
    // Cook averages to 0 across its two branches, so Order must win outright.
    assert.ok(Math.abs(jevOf(built, "a")) < 1e-9);
    assert.ok(jevOf(built, "b") > 4);
    assert.equal(outcomeCount(built, "a"), 2);
  });

  it("reorders the ranking, it does not just decorate it", () => {
    const ranked = (opts) =>
      scoreAll(opts, factors)
        .slice()
        .sort((a, b) => b.jev - a.jev)
        .map((o) => o.optionId);
    const flatRank = ranked(buildOptionsFromScores(options, factors, flat));
    const scenRank = ranked(
      buildOptionsFromScores(options, factors, flat, { scenarios })
    );
    assert.notDeepEqual(flatRank, scenRank);
    assert.deepEqual(scenRank, ["b", "a"]);
  });

  it("normalizes branch probabilities instead of trusting them", () => {
    const over = JSON.parse(JSON.stringify(scenarios));
    over[0].probability = 2;
    over[1].probability = 2;
    over[2].probability = 3;
    const built = buildOptionsFromScores(options, factors, flat, { scenarios: over });
    const outs = built.find((o) => o.id === "a").outcomes;
    const sum = outs.reduce((n, o) => n + o.probability, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });

  it("produces usable scenario runs", () => {
    const built = buildOptionsFromScores(options, factors, flat, { scenarios });
    const runs = runScenarios(built, factors);
    assert.ok(runs.conservative.length === 2);
    assert.ok(runs.expected.length === 2);
    assert.ok(runs.optimistic.length === 2);
    assert.ok(["high", "medium", "low"].includes(runs.stability));
    assert.ok(Number.isFinite(runs.expected[0].jev));
  });

  it("gives the risky option a wider band and an exact flip threshold", () => {
    const built = buildOptionsFromScores(options, factors, flat, { scenarios });
    const bandA = uncertaintyBand(built[0], factors);
    const bandB = uncertaintyBand(built[1], factors);
    assert.ok(bandA.dispersion > bandB.dispersion);

    const [lead, runner] = built;
    const gap = expectedUtility(lead, factors) - expectedUtility(runner, factors);
    const leadJev = expectedUtility(lead, factors);
    const t = flipThresholds(lead, runner, factors, gap);
    assert.ok(t.length > 0);

    // Reachable flips are listed before impossible ones.
    const reach = t.map((x) => (x.reachable ? 0 : 1));
    assert.deepEqual(reach, reach.slice().sort());

    // The solve is exact: applying deltaNeeded to that factor closes the gap.
    for (const row of t.filter((x) => x.reachable)) {
      const patched = runner.outcomes.map((o) => ({
        ...o,
        factors: o.factors.map((fv) =>
          fv.factorId === row.factorId
            ? { ...fv, value: Math.min(10, fv.value + row.deltaNeeded) }
            : fv
        ),
      }));
      assert.ok(
        Math.abs(expectedUtility({ ...runner, outcomes: patched }, factors) - leadJev) < 0.01
      );
    }
  });

  it("drops an incomplete scenario set rather than half-using it", () => {
    const partial = scenarios.filter((s) => s.optionId === "a");
    const built = buildOptionsFromScores(options, factors, flat, { scenarios: partial });
    assert.ok(Math.abs(jevOf(built, "a") - jevOf(built, "b")) < 1e-9);
  });

  it("ignores unknown factor ids and out-of-range values", () => {
    const bad = JSON.parse(JSON.stringify(scenarios));
    bad[0].values.nope = 5;
    bad[1].values.f2 = 99;
    const built = buildOptionsFromScores(options, factors, flat, { scenarios: bad });
    assert.equal(outcomeCount(built, "a"), 1);
  });

  it("rejects unknown option ids", () => {
    const bad = JSON.parse(JSON.stringify(scenarios));
    bad[0].optionId = "zzz";
    const built = buildOptionsFromScores(options, factors, flat, { scenarios: bad });
    assert.equal(outcomeCount(built, "a"), 1);
  });
});

describe("scenario battery (server)", () => {
  it("accepts only endorsed cases, in canonical order", () => {
    const answer = {
      type: "choice",
      probabilities: {
        "best case": 0.9,
        "typical case": 0.8,
        "worst case": 0.05,
        none_of_these: 0,
      },
    };
    assert.deepEqual(acceptCases(answer), ["best case", "typical case"]);
  });

  it("treats none_of_these as no variation", () => {
    const answer = { type: "choice", probabilities: { "best case": 0.9, none_of_these: 0.95 } };
    assert.deepEqual(acceptCases(answer), []);
  });

  it("returns no cases for a missing or non-choice answer", () => {
    assert.deepEqual(acceptCases(undefined), []);
    assert.deepEqual(acceptCases({ type: "score", score: 3, confidence: 0.5 }), []);
  });

  it("maps likelihood scores onto relative weights", () => {
    assert.ok(scoreToLikelihood(0) < scoreToLikelihood(2));
    assert.ok(scoreToLikelihood(4) > scoreToLikelihood(3));
    assert.equal(scoreToLikelihood(2), 1);
  });

  it("reuses the shared score→value mapping", () => {
    assert.equal(scoreToValue(0), -10);
    assert.equal(scoreToValue(4), 10);
    assert.equal(scoreToValue(2), 0);
  });

  it("builds a complete scenario set", () => {
    const key = (o, c, part) => `${o}|${c}|${part}`;
    const answers = {
      [`A|best case|likelihood`]: { type: "score", score: 3, confidence: 0.8 },
      [`A|best case|f:f1`]: { type: "score", score: 4, confidence: 0.8 },
      [`A|best case|f:f2`]: { type: "score", score: 3, confidence: 0.8 },
      [`B|typical case|likelihood`]: { type: "score", score: 2, confidence: 0.5 },
      [`B|typical case|f:f1`]: { type: "score", score: 2, confidence: 0.5 },
      [`B|typical case|f:f2`]: { type: "score", score: 2, confidence: 0.5 },
    };
    const out = buildScenarios({
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      factors: [{ id: "f1", label: "F1" }, { id: "f2", label: "F2" }],
      casesFor: new Map([["A", ["best case"]], ["B", ["typical case"]]]),
      answers,
      keyPrefix: key,
    });
    assert.equal(out.length, 2);
    assert.equal(out[0].values.f1, 10);
    assert.equal(out[0].probabilityConfidence, 0.8);
    assert.equal(out[1].values.f1, 0);
  });

  it("returns null rather than a partial set", () => {
    const key = (o, c, part) => `${o}|${c}|${part}`;
    assert.equal(
      buildScenarios({
        options: [{ id: "a", label: "A" }],
        factors: [{ id: "f1", label: "F1" }],
        casesFor: new Map([["A", []]]),
        answers: {},
        keyPrefix: key,
      }),
      null
    );
    assert.equal(
      buildScenarios({
        options: [{ id: "a", label: "A" }],
        factors: [{ id: "f1", label: "F1" }],
        casesFor: new Map([["A", ["best case"]]]),
        answers: { "A|best case|likelihood": { type: "score", score: 2, confidence: 0.5 } },
        keyPrefix: key,
      }),
      null
    );
  });

  it("declines to model more factors than it can ask about", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, label: `F${i}` }));
    assert.equal(
      buildScenarios({
        options: [{ id: "a", label: "A" }],
        factors: many,
        casesFor: new Map([["A", ["best case"]]]),
        answers: {},
        keyPrefix: (o, c, p) => `${o}|${c}|${p}`,
      }),
      null
    );
  });
});