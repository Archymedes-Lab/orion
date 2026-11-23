import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyImpliedPriority, divergence } from "../src/decision-engine/divergence.ts";
import { expectedUtility } from "../src/decision-engine/expectedValue.ts";

const factors = (weights) => Object.entries(weights).map(([label, weight]) => ({ id: label.toLowerCase(), label, weight }));
const option = (id, values, confidence = 0.7) => ({
  id, label: id, reversibility: 0.5,
  outcomes: [{ id: `${id}-o`, label: id, probability: 1, probabilityConfidence: confidence, factors: Object.entries(values).map(([factorId, value]) => ({ factorId, value })) }],
});
// Berlin wins on money and growth, staying wins on comfort.
const F = factors({ Income: 0.4, Growth: 0.4, Comfort: 0.2 });
const berlin = option("berlin", { income: 6, growth: 7, comfort: -4 });
const stay = option("stay", { income: 1, growth: 0, comfort: 6 });

describe("measuring a choice against the comparison", () => {
  it("has nothing to say without a choice, a rival, or scores", () => {
    assert.equal(divergence([berlin, stay], F, null).level, "none");
    assert.equal(divergence([berlin], F, "berlin").level, "none");
    assert.equal(divergence([berlin, stay], F, "nobody").level, "none");
    assert.equal(divergence([berlin, stay], F, "stay", false).level, "none");
  });
  it("calls the leader, and a tie for the lead, aligned", () => {
    const d = divergence([berlin, stay], F, "berlin");
    assert.deepEqual([d.level, d.gap, d.implied], ["aligned", 0, null]);
    const twin = option("twin", { income: 6, growth: 7, comfort: -4 });
    assert.deepEqual([divergence([berlin, twin], F, "twin").level, divergence([berlin, twin], F, "twin").tied], ["aligned", true]);
    assert.equal(d.tied, false);
  });
  it("gives the cost in points and how sure the comparison is", () => {
    const d = divergence([berlin, stay], F, "stay");
    // berlin 0.4×6 + 0.4×7 − 0.2×4 = 4.4; stay 0.4 + 0 + 1.2 = 1.6
    assert.equal(d.gap, 2.8);
    assert.equal(d.leaderId, "berlin");
    assert.equal(d.level, "strongly_against");
    assert.ok(d.certainty > 1.25);
    assert.equal(d.dominated, false);
  });
  it("does not call a small or uncertain gap irrational", () => {
    const close = option("close", { income: 5, growth: 7, comfort: -4 });
    assert.equal(divergence([berlin, close], F, "close").level, "tossup", "0.4 points apart");
    // The same 2.8-point gap with shakier estimates: still against, but no longer "strongly".
    const shaky = (confidence) => divergence([option("berlin", { income: 6, growth: 7, comfort: -4 }, confidence), option("stay", { income: 1, growth: 0, comfort: 6 }, confidence)], F, "stay");
    assert.deepEqual([shaky(0.3).gap, shaky(0.3).level], [2.8, "against"]);
    assert.ok(shaky(0.3).certainty < 1.25 && shaky(0.3).certainty >= 0.5);
    // And when the estimates are close to guesses, even 2.8 points is within the noise.
    assert.equal(shaky(0.05).level, "tossup");
    const vague = divergence([option("a", { income: 3, growth: 3, comfort: 3 }, 0.05), option("b", { income: 2, growth: 2, comfort: 2 }, 0.05)], F, "b");
    assert.equal(vague.level, "tossup", "one point apart with almost no confidence");
  });
  it("is stricter as confidence rises, for the same gap", () => {
    const at = (confidence) => divergence([option("a", { income: 4, growth: 4, comfort: 4 }, confidence), option("b", { income: 2.5, growth: 2.5, comfort: 2.5 }, confidence)], F, "b");
    assert.ok(at(0.9).certainty > at(0.5).certainty && at(0.5).certainty > at(0.2).certainty);
    assert.equal(at(0.2).level, "tossup");
    assert.equal(at(0.9).level, "against");
  });
});

describe("what would make the choice the rational one", () => {
  it("finds the factor that has to matter more, and by how much", () => {
    const d = divergence([berlin, stay], F, "stay");
    assert.equal(d.implied.label, "Comfort");
    assert.equal(d.implied.from, 0.2);
    // On everything but comfort Berlin leads by 6; on comfort staying leads by 10. They tie when comfort carries
    // t of the decision with −6(1−t) + 10t = 0, so t = 0.375; a little more and staying leads.
    assert.ok(Math.abs(d.implied.to - 0.395) < 1e-9, String(d.implied.to));
    const reweighted = applyImpliedPriority(F, d.implied);
    assert.ok(Math.abs(reweighted.reduce((sum, f) => sum + f.weight, 0) - 1) < 1e-9);
    assert.ok(expectedUtility(stay, reweighted) > expectedUtility(berlin, reweighted), "with that priority the choice leads");
    assert.equal(divergence([berlin, stay], reweighted, "stay").level, "aligned");
    // The other factors keep their proportions.
    const [income, growth] = reweighted;
    assert.ok(Math.abs(income.weight - growth.weight) < 1e-9);
  });
  it("can also be a factor that has to matter less", () => {
    const G = factors({ Cost: 0.7, Joy: 0.3 });
    const cheap = option("cheap", { cost: 8, joy: 1 });
    const fun = option("fun", { cost: 2, joy: 6 });
    const d = divergence([cheap, fun], G, "fun");
    assert.ok(["Cost", "Joy"].includes(d.implied.label));
    const reweighted = applyImpliedPriority(G, d.implied);
    assert.ok(expectedUtility(fun, reweighted) > expectedUtility(cheap, reweighted));
    // Raising Joy and lowering Cost are the same move with two factors, so the shift is the same size.
    assert.ok(Math.abs(Math.abs(d.implied.to - d.implied.from) - (0.545 + 0.02 - 0.3)) < 0.02);
  });
  it("picks the factor needing the smallest shift", () => {
    const G = factors({ A: 0.8, B: 0.1, C: 0.1 });
    const lead = option("lead", { a: 8, b: 0, c: 0 });
    const pick = option("pick", { a: 6, b: 9, c: 0 });
    const d = divergence([lead, pick], G, "pick");
    // B from 10% to about 19% does it; A would have to fall from 80% to 67%; C cannot do it short of 100%.
    assert.equal(d.implied.label, "B");
    assert.ok(d.implied.to - d.implied.from < 0.1);
  });
  it("has to beat every other option, not just the leader", () => {
    const G = factors({ A: 0.6, B: 0.2, C: 0.2 });
    const options = [option("x", { a: 9, b: 0, c: 0 }), option("y", { a: 0, b: 9, c: 0 }), option("z", { a: 0, b: 5, c: 4 })];
    const d = divergence(options, G, "z");
    // Raising B hands the lead to y, and lowering A only ever ties z with y; only C makes z the outright leader.
    assert.equal(d.implied.label, "C");
    const reweighted = applyImpliedPriority(G, d.implied);
    const best = options.map((o) => expectedUtility(o, reweighted));
    assert.equal(best.indexOf(Math.max(...best)), 2);
  });
  it("says so when no weighting of the listed factors can justify the choice", () => {
    const worse = option("worse", { income: 5, growth: 3, comfort: -5 });
    const d = divergence([berlin, worse], F, "worse");
    assert.equal(d.dominated, true);
    assert.equal(d.implied, null);
    assert.ok(d.gap > 0);
    // Not dominated by one rival, but beaten by a different one whichever way the weights go.
    const G = factors({ A: 0.5, B: 0.5 });
    const squeezed = divergence([option("x", { a: 9, b: 0 }), option("y", { a: 0, b: 9 }), option("m", { a: 4, b: 4 })], G, "m");
    assert.equal(squeezed.dominated, false);
    assert.equal(squeezed.implied, null);
  });
  it("does not offer a factor that could only bring the options level", () => {
    // The options are equal on Health, so no weight on it can put the choice ahead; it can only erase the gap.
    const G = factors({ Cost: 0.5, Time: 0.33, Health: 0.17 });
    const d = divergence([option("cook", { cost: 5, time: 5, health: 0 }), option("order", { cost: 0, time: 0, health: 0 })], G, "order");
    assert.equal(d.implied, null);
    assert.equal(d.dominated, true);
  });
  it("handles a decision that rests on a single factor", () => {
    const G = factors({ Only: 1, Unused: 0 });
    const d = divergence([option("a", { only: 5, unused: 0 }), option("b", { only: 1, unused: 9 })], G, "b");
    assert.equal(d.implied.label, "Unused");
    assert.ok(d.implied.to > 0.3 && d.implied.to < 0.4);
  });
});
