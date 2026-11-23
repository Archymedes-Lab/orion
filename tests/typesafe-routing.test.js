// Pure-helper tests for the TypeSafe integration (no network, no key).
// Covers the validated design fix: one Noul per candidate span, not one
// Choice picking two spans.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptSpans,
  acceptTriage,
  findCandidateSpans,
  gateChoice,
  routeSafety,
  scoreToValue,
} from "../server/typesafe.ts";

const noul = (n) => ({ type: "noul", noul: n });

describe("findCandidateSpans", () => {
  it("over-finds A/B options", () => {
    const spans = findCandidateSpans("Should I cook tonight or order something?");
    assert.ok(spans.includes("cook tonight"));
    assert.ok(spans.includes("order something"));
  });
  it("splits three-way lists", () => {
    const spans = findCandidateSpans("Should I cook or order or skip dinner?");
    assert.equal(spans.length, 3);
  });
  it("handles between/and", () => {
    const spans = findCandidateSpans("Choose between the train and the bus?");
    assert.ok(spans.length >= 2);
  });
  it("returns empty for empty input", () => {
    assert.deepEqual(findCandidateSpans("   "), []);
  });
});

describe("acceptSpans (one Noul per span)", () => {
  it("keeps genuine options, drops context", () => {
    const spans = ["cook tonight", "order something", "tonight"];
    const answers = { opt_0: noul(0.9), opt_1: noul(0.85), opt_2: noul(0.1) };
    assert.deepEqual(
      acceptSpans(spans, answers, (_, i) => `opt_${i}`),
      ["cook tonight", "order something"]
    );
  });
  it("empty when nothing clears the threshold", () => {
    const answers = { opt_0: noul(0.2) };
    assert.deepEqual(acceptSpans(["x"], answers, (_, i) => `opt_${i}`), []);
  });
});

describe("gateChoice", () => {
  it("rejects low confidence (taxi-style ambiguity)", () => {
    assert.equal(gateChoice(0.45), false);
    assert.equal(gateChoice(1.0), true);
    assert.equal(gateChoice(NaN), false);
  });
});

describe("routeSafety", () => {
  const none = { crisis: 0.01, harm: 0.02, health: 0.03, financial: 0.05, legal: 0.02 };
  it("passes ordinary input", () => {
    assert.equal(routeSafety(none, 0.1), "normal");
  });
  it("crisis takes precedence (support path, not block)", () => {
    assert.equal(
      routeSafety({ ...none, crisis: 0.99, harm: 0.9 }, 2.5),
      "crisis"
    );
  });
  it("harm maps to dangerous", () => {
    assert.equal(routeSafety({ ...none, harm: 0.95 }, 2.0), "dangerous");
  });
  it("domain flags route individually", () => {
    assert.equal(routeSafety({ ...none, health: 0.9 }, 0.5), "health-high-stakes");
    assert.equal(routeSafety({ ...none, financial: 0.9 }, 0.5), "financial-high-stakes");
    assert.equal(routeSafety({ ...none, legal: 0.9 }, 0.5), "legal-high-stakes");
  });
  it("sub-threshold hazards pass (false cases ≤0.2)", () => {
    assert.equal(routeSafety({ ...none, financial: 0.2, health: 0.15 }, 0.3), "normal");
  });
});

describe("scoreToValue", () => {
  it("maps Score levels to -10..+10", () => {
    assert.equal(scoreToValue(0), -10);
    assert.equal(scoreToValue(2), 0);
    assert.equal(scoreToValue(4), 10);
  });
  it("handles the 0.51/0.49-style midpoint", () => {
    assert.ok(Math.abs(scoreToValue(2.02)) < 0.2);
  });
  it("clamps out-of-range input", () => {
    assert.equal(scoreToValue(99), 10);
    assert.equal(scoreToValue(NaN), 0);
  });
});

describe("acceptTriage", () => {
  it("asks only high information-gain follow-ups", () => {
    const cands = ["budget?", "color?"];
    const answers = { q_0: noul(0.8), q_1: noul(0.2) };
    assert.deepEqual(
      acceptTriage(cands, answers, (_, i) => `q_${i}`),
      ["budget?"]
    );
  });
});
