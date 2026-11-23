import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DUEL_WIN, duelScores, nextDuel, optionsFromDuels } from "../src/decision-engine/duel.ts";
import { scoreAll } from "../src/decision-engine/uncertainty.ts";
import { buildOptionsFromScores } from "../src/ai/model.ts";

const factors = [
  { id: "cost", label: "Cost", weight: 0.4 },
  { id: "time", label: "Time", weight: 0.3 },
  { id: "energy", label: "Energy", weight: 0.2 },
  { id: "growth", label: "Growth", weight: 0.1 },
];
const options = buildOptionsFromScores([{ id: "a", label: "Bus" }, { id: "b", label: "Taxi" }], factors, null);

describe("duels", () => {
  it("score only the answered factors, winner above the rest", () => {
    const scores = duelScores(options, { cost: "a", time: null });
    assert.equal(scores.length, 4);
    assert.equal(scores.find((s) => s.optionId === "a" && s.factorId === "cost").value, DUEL_WIN);
    assert.equal(scores.find((s) => s.optionId === "b" && s.factorId === "cost").value, 0);
    assert.ok(scores.filter((s) => s.factorId === "time").every((s) => s.value === 0));
  });
  it("lead to a JEV ranking that follows the taps", () => {
    const scored = scoreAll(optionsFromDuels(options, factors, { cost: "a", time: "b" }), factors).sort((x, y) => y.jev - x.jev);
    assert.equal(scored[0].optionId, "a"); // cost outweighs time
  });
  it("start with the most important factor", () => {
    assert.equal(nextDuel(options, factors, {}, "normal").factor.id, "cost");
  });
  it("ask for the next most important factor while the call is close", () => {
    const next = nextDuel(options, factors, { cost: "a" }, "normal");
    assert.equal(next.factor.id, "time");
    assert.equal(next.settled, false);
  });
  it("stop once the factors left cannot overturn the lead", () => {
    // 0.4 + 0.3 of weight won by Bus = gap 3.5; the rest can swing at most 1.5.
    const next = nextDuel(options, factors, { cost: "a", time: "a" }, "significant");
    assert.equal(next.factor, null);
    assert.equal(next.settled, true);
  });
  it("stop when every factor has been answered", () => {
    const all = { cost: "a", time: "b", energy: "b", growth: "a" };
    assert.equal(nextDuel(options, factors, all, "major").factor, null);
  });
});
