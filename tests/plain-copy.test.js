// The plain-English layer. It is the one place technical readings become ordinary words, so the thing
// worth testing is that it never says more than the engine gave it: a missing reading stays missing, a
// shaky one stays shaky, and nothing turns a score into a claim about what will happen in the world.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  confidencePlain, plainFlip, provenancePlain, reversibilityPlain, robustnessPlain,
  ESTIMATE_CAVEAT, SCORE_MEANING, TERMS,
} from "../src/copy/plain.ts";
import { sensitivity } from "../src/decision-engine/sensitivity.ts";

const READOUTS = [confidencePlain, reversibilityPlain];

describe("plain English for what ORION worked out", () => {
  it("says so when there is no reading, rather than guessing one", () => {
    for (const readout of READOUTS) {
      for (const missing of [null, undefined, NaN, Infinity]) {
        const out = readout(missing);
        assert.equal(out.tone, "neutral", `${readout.name}(${String(missing)}) should stay neutral`);
        assert.match(out.answer, /not (worked out yet|known)/i);
      }
    }
    assert.equal(robustnessPlain(undefined).tone, "neutral");
    assert.equal(robustnessPlain("unrecognised").tone, "neutral");
  });

  it("keeps a weak reading weak", () => {
    assert.equal(confidencePlain(0.1).answer, "Shaky");
    assert.equal(confidencePlain(0.1).tone, "warning");
    assert.equal(robustnessPlain("low").tone, "danger");
    assert.equal(reversibilityPlain(0).answer, "Hard to undo");
  });

  it("only calls a reading strong at the top of the range", () => {
    assert.equal(confidencePlain(0.7).answer, "Strong");
    assert.equal(confidencePlain(0.69).answer, "Reasonable");
    assert.equal(confidencePlain(0.4).answer, "Reasonable");
    assert.equal(confidencePlain(0.39).answer, "Shaky");
    assert.equal(robustnessPlain("high").answer, "Probably not");
  });

  it("gives every readout a question, an answer and what it means", () => {
    const all = [confidencePlain(0.5), reversibilityPlain(0.5), robustnessPlain("medium")];
    for (const out of all) {
      assert.ok(out.question.endsWith("?"), `"${out.question}" should be a question`);
      assert.ok(out.answer.length > 0 && out.detail.length > 0);
      assert.ok(out.technical.length > 0, "the engine's own name stays available");
      assert.ok(!/^\d/.test(out.answer), "an answer is words, not a bare number");
    }
  });

  it("never promises an outcome, only a comparison", () => {
    const everything = [
      SCORE_MEANING, ESTIMATE_CAVEAT,
      ...[0, 0.5, 1].flatMap((v) => [confidencePlain(v), reversibilityPlain(v)]).map((r) => r.detail),
      ...["high", "medium", "low"].map((s) => robustnessPlain(s).detail),
    ].join(" ");
    // A promise is "this option will work", not the denial "not a prediction about how things will
    // turn out" — so the check is for a subject ORION cannot speak for, followed by a claim.
    assert.doesNotMatch(everything, /\b(this|that|the) (option|choice|decision) will\b/i);
    assert.doesNotMatch(everything, /\byou will (be|get|have|succeed|end up)\b/i);
    assert.doesNotMatch(everything, /\b(guarantee|certainly|definitely|is proven)\b/i);
    assert.doesNotMatch(everything, /\b\d+% (likely|chance|probability)\b/i);
    assert.match(SCORE_MEANING, /not a prediction/i);
  });

  it("keeps the difference between what you said and what ORION assumed", () => {
    assert.match(provenancePlain("USER_STATED"), /you told/i);
    assert.match(provenancePlain("MODEL_ASSUMED"), /assumed/i);
    assert.match(provenancePlain("MODEL_ASSUMED"), /correct it/i);
    assert.notEqual(provenancePlain("MODEL_INFERRED"), provenancePlain("MODEL_ASSUMED"));
    assert.equal(provenancePlain("something else"), "");
    assert.equal(provenancePlain(undefined), "");
  });

  it("pairs every plain name with the technical one it replaces", () => {
    for (const [key, term] of Object.entries(TERMS)) {
      assert.ok(term.plain.length > 0 && term.technical.length > 0, key);
      assert.notEqual(term.plain, term.technical, `${key} should actually be rephrased`);
    }
    assert.equal(TERMS.robustness.plain, "Would the answer change?");
    assert.equal(TERMS.information.plain, "What should you find out first?");
  });
});

// "What would change the answer" on the result. The engine's sentence carries its working ("(gap 3.2)") and
// quotation marks; the result keeps the meaning and drops the rest. The shapes below are the three the engine
// writes (src/decision-engine/sensitivity.ts); the last test runs the engine itself so a new shape is noticed.
describe("the flip sentence in plain words", () => {
  it("drops the gap from a tie and keeps both option names, even names containing 'and'", () => {
    const out = plainFlip("Stay and finish and Switch to computer science are effectively tied (gap 0.12).");
    assert.match(out, /^Stay and finish and Switch to computer science are effectively tied\./);
    assert.match(out, /separate them/);
    assert.doesNotMatch(out, /\d|\(|gap/);
  });

  it("names the leader of a wide margin without the number", () => {
    for (const text of [
      '"Stay and finish" leads by a wide margin (gap 6.3).',
      '"Stay and finish" leads by a wide margin (gap 6.3). No single factor would close it; several estimates would have to change together.',
    ]) {
      const out = plainFlip(text);
      assert.match(out, /^Stay and finish leads by a wide margin\./);
      assert.match(out, /several estimates/);
      assert.doesNotMatch(out, /\d|"|\(/);
    }
  });

  it("says what could put the runner-up ahead, without 'competitive' or quotation marks", () => {
    const out = plainFlip('If cost favours "Switch to computer science" more strongly, "Switch to computer science" becomes competitive.');
    assert.equal(out, "If cost favours Switch to computer science more than ORION estimated, it could come out ahead.");
  });

  it("passes an unknown sentence through with only the working removed", () => {
    assert.equal(plainFlip('"Cook" is ahead (gap 1.2) on what you weighed (score 4 vs 2).'), "Cook is ahead on what you weighed.");
    assert.equal(plainFlip("   "), "");
    assert.equal(plainFlip("Nothing to report."), "Nothing to report.");
  });

  it("never shows a number for anything the engine writes", () => {
    const factor = { id: "f", label: "Cost", weight: 1 };
    const option = (id, value) => ({
      id, label: id, reversibility: 0.5,
      outcomes: [{ id: `${id}-o`, label: id, probability: 1, probabilityConfidence: 0.6, factors: [{ factorId: "f", value }] }],
    });
    for (const [a, b] of [[4, 4], [4, 3.9], [8, 1], [6, 4]]) {
      const sens = sensitivity([option("A and B", a), option("C", b)], [factor]);
      for (const flip of sens.flips) {
        const out = plainFlip(flip.description);
        assert.ok(out.length > 0);
        assert.doesNotMatch(out, /\d/, `${flip.description} -> ${out}`);
        assert.doesNotMatch(out, /"|\(/, out);
      }
    }
  });
});
