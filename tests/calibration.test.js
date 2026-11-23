// Calibration must stay honest: no verdict without reviews, no feedback into
// the model, and no claim of a pattern from one or two data points.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OUTCOME_RATINGS,
  calibrate,
  calibrationSummary,
  outcomeError,
  ratingToImpact,
  ratingToProbability,
} from "../src/decision-engine/calibration.ts";

const rec = (rating, expected = 6) => ({ decisionId: "d", expectedOutcome: expected, rating });

describe("rating scales", () => {
  it("maps ratings onto the model's own -10..+10 range", () => {
    assert.equal(ratingToImpact("much-better"), 10);
    assert.equal(ratingToImpact("as-expected"), 0);
    assert.equal(ratingToImpact("much-worse"), -10);
  });

  it("is symmetric around the middle", () => {
    assert.equal(ratingToProbability("as-expected"), 0.5);
    assert.equal(ratingToProbability("better") + ratingToProbability("worse"), 1);
  });

  it("descends from best to worst", () => {
    const p = OUTCOME_RATINGS.map(ratingToProbability);
    assert.deepEqual(p, [...p].sort((a, b) => b - a));
  });
});

describe("calibrate", () => {
  it("returns every band, empty ones included", () => {
    const bands = calibrate([]);
    assert.equal(bands.length, 5);
    assert.ok(bands.every((b) => b.count === 0 && b.actual === null && b.bias === null));
  });

  it("ignores unreviewed and unpredicted decisions", () => {
    assert.equal(calibrate([rec(null, 6)]).reduce((n, b) => n + b.count, 0), 0);
    assert.equal(calibrate([rec("better", null)]).reduce((n, b) => n + b.count, 0), 0);
  });

  it("groups by what ORION predicted, not by the rating", () => {
    const bands = calibrate([
      rec("much-worse", -9),
      rec("better", 7),
      rec("as-expected", 7),
    ]);
    const negatives = bands[0];
    const high = bands[4];
    assert.equal(negatives.count, 1);
    assert.equal(negatives.predicted, -9);
    assert.equal(negatives.actual, -10);
    assert.equal(negatives.bias, -1);
    assert.equal(high.count, 2);
    assert.equal(high.predicted, 7);
    assert.equal(high.actual, 2.5);
  });

  it("keeps bands fixed as records arrive", () => {
    const one = calibrate([rec("better", 3)]);
    const many = calibrate([rec("better", 3), rec("worse", -8), rec("better", 9)]);
    assert.deepEqual(one.map((b) => [b.from, b.to]), many.map((b) => [b.from, b.to]));
  });

  it("reads a positive bias as ORION having been too cautious", () => {
    const cautious = calibrate(Array.from({ length: 4 }, () => rec("better", -4)));
    assert.ok(cautious[1].bias > 0);
    const bold = calibrate(Array.from({ length: 4 }, () => rec("worse", 9)));
    assert.ok(bold[4].bias < 0);
  });
});

describe("calibrationSummary", () => {
  it("says so plainly when there is nothing to report", () => {
    assert.match(calibrationSummary([]).message, /No decisions/);
    assert.equal(calibrationSummary([]).bias, null);
  });

  it("asks for a review rather than guessing", () => {
    const s = calibrationSummary([rec(null, 6), rec(null, -2)]);
    assert.equal(s.reviewed, 0);
    assert.equal(s.pending, 2);
    assert.equal(s.bias, null);
    assert.match(s.message, /Review a past decision/);
  });

  it("refuses to call a pattern from a handful of reviews", () => {
    for (const n of [1, 2, 3, 4]) {
      const s = calibrationSummary(Array.from({ length: n }, () => rec("worse", 8)));
      assert.match(s.message, /too few/);
      assert.equal(s.reviewed, n);
    }
  });

  it("reports over-optimism in plain language", () => {
    const bold = calibrationSummary(Array.from({ length: 8 }, () => rec("worse", 8)));
    assert.ok(bold.bias < 0);
    assert.match(bold.message, /too optimistic/);

    const cautious = calibrationSummary(Array.from({ length: 8 }, () => rec("better", -8)));
    assert.ok(cautious.bias > 0);
    assert.match(cautious.message, /too cautious/);
  });

  it("reports agreement when there is no consistent skew", () => {
    const pairs = [rec("better", 5), rec("worse", -5), rec("as-expected", 0)];
    const s = calibrationSummary([...pairs, ...pairs]);
    assert.ok(s.bias !== null && Math.abs(s.bias) <= 1);
    assert.match(s.message, /close to how things turned out/);
  });

  it("cancels opposite errors instead of stacking them", () => {
    const s = calibrationSummary([
      rec("much-better", -5), rec("much-worse", 5),
      rec("much-better", -5), rec("much-worse", 5),
      rec("as-expected", 0),
    ]);
    assert.equal(s.bias, 0);
  });
});

describe("outcomeError", () => {
  it("is null when there is nothing to compare", () => {
    assert.equal(outcomeError(rec("better", null)), null);
    assert.equal(outcomeError(rec(null, 6)), null);
  });

  it("measures distance on the model's own scale", () => {
    assert.equal(outcomeError(rec("better", 5)), 0);
    assert.equal(outcomeError(rec("worse", 5)), 10);
  });
});