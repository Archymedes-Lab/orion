// Business priority matrices (src/decision-engine/prioritize.ts).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prioritize, PRIORITY_DIMENSIONS } from "../src/decision-engine/prioritize.ts";
import { forAll, near } from "./helpers/property.js";
import { Lottery } from "../src/decision-engine/creative.ts";

const sure = (level) => [0, 1, 2, 3, 4].map((i) => (i === level ? 0.92 : 0.02));
const item = (optionId, levels) => ({ optionId, dims: Object.fromEntries(PRIORITY_DIMENSIONS.map((d) => [d, sure(levels[d] ?? 2)])) });

describe("priorities", () => {
  const fix = item("fix", { impact: 4, urgency: 4, reach: 3, confidence: 3, effort: 1, leverage: 4, reversibility: 4 });
  const rewrite = item("rewrite", { impact: 1, urgency: 0, reach: 2, confidence: 0, effort: 4, leverage: 1, reversibility: 0 });
  const brand = item("brand", { impact: 3, urgency: 1, reach: 3, confidence: 2, effort: 3, leverage: 2, reversibility: 3 });
  const p = prioritize([rewrite, brand, fix]);

  it("puts the urgent, cheap, high-leverage item first and the money pit last", () => {
    assert.equal(p.first, "fix");
    assert.equal(p.rows.at(-1).optionId, "rewrite");
    assert.equal(p.highestLeverage, "fix");
  });
  it("places items on the 2×2s", () => {
    const row = (id) => p.rows.find((r) => r.optionId === id);
    assert.equal(row("fix").eisenhower, "do");
    assert.equal(row("fix").effortMatrix, "quick_win");
    assert.equal(row("brand").eisenhower, "schedule");
    assert.equal(row("brand").effortMatrix, "big_bet");
    assert.equal(row("rewrite").eisenhower, "drop");
    assert.equal(row("rewrite").effortMatrix, "money_pit");
    assert.equal(row("rewrite").door, "one_way");
  });
  it("P(first) sums to 1 and the frameworks agree on a clear case", () => {
    assert.ok(Math.abs(p.rows.reduce((a, r) => a + r.pFirst, 0) - 1) < 1e-9);
    assert.ok(p.agreement > 0.8);
  });
  it("is order invariant", () => {
    const q = prioritize([fix, rewrite, brand]);
    assert.deepEqual(q.rows.map((r) => r.optionId), p.rows.map((r) => r.optionId));
  });
  it("WSJF divides cost of delay by job size", () => {
    const small = item("small", { effort: 0 }), big = item("big", { effort: 4 });
    const q = prioritize([small, big]);
    const r = (id) => q.rows.find((x) => x.optionId === id);
    assert.ok(r("small").wsjf > r("big").wsjf * 4);
  });
});

// --- invariants on random ratings --------------------------------------------------------------------------------

const randomItem = (r, optionId) => ({ optionId, dims: Object.fromEntries(PRIORITY_DIMENSIONS.map((d) => [d, r.dist()])) });
/** Move belief mass up one level (a first-order stochastic improvement). */
const lift = (dist, t) => dist.map((p, i) => (i === 0 ? p * (1 - t) : p * (1 - t) + dist[i - 1] * t)).map((p, i, a) => (i === a.length - 1 ? p + dist.at(-1) * t : p));
const rowOf = (p, id) => p.rows.find((r) => r.optionId === id);

describe("priority invariants", () => {
  it("every option gets one row; consensus ranks are 1..n; P(first) sums to 1; W ∈ [0, 1]", () => forAll(150, (r) => {
    const n = r.int(1, 8);
    const p = prioritize(Array.from({ length: n }, (_, i) => randomItem(r, `o${i}`)));
    assert.equal(p.rows.length, n);
    assert.deepEqual(p.rows.map((x) => x.rank), [...Array(n).keys()].map((i) => i + 1));
    near(p.rows.reduce((a, x) => a + x.pFirst, 0), 1, 1e-9);
    assert.ok(p.agreement >= 0 && p.agreement <= 1);
    for (const x of p.rows) {
      for (const k of ["rice", "ice", "wsjf", "leverage"]) assert.ok(Number.isFinite(x[k]) && x[k] > 0, k);
      for (const f of Object.values(x.ranks)) assert.ok(f >= 1 && f <= n);
      // The quadrants follow the levels they are named after.
      assert.equal(x.eisenhower === "do" || x.eisenhower === "delegate", x.level.urgency >= 0.5);
      assert.equal(x.eisenhower === "do" || x.eisenhower === "schedule", x.level.impact >= 0.5);
      assert.equal(x.effortMatrix === "big_bet" || x.effortMatrix === "money_pit", x.level.effort >= 0.5);
      assert.equal(x.door === "one_way", x.level.reversibility < 0.5);
    }
    assert.equal(p.first, p.rows[0]?.optionId ?? null);
    assert.deepEqual(p.urgent, p.rows.filter((x) => x.eisenhower === "do").map((x) => x.optionId));
  }));
  it("is invariant to the order the options arrive in", () => forAll(100, (r) => {
    const items = Array.from({ length: r.int(2, 7) }, (_, i) => randomItem(r, `o${i}`));
    const a = prioritize(items), b = prioritize(r.shuffle(items));
    assert.deepEqual(b.rows.map((x) => x.optionId), a.rows.map((x) => x.optionId));
    a.rows.forEach((x, i) => near(b.rows[i].pFirst, x.pFirst, 1e-9));
  }));
  it("more impact never lowers RICE, ICE, WSJF or leverage; more effort never raises them; more urgency never lowers WSJF", () => forAll(150, (r) => {
    const base = randomItem(r, "x"), t = r.float(0.05, 1);
    const score = (item) => rowOf(prioritize([item]), "x");
    const s0 = score(base);
    const up = score({ ...base, dims: { ...base.dims, impact: lift(base.dims.impact, t) } });
    for (const k of ["rice", "ice", "wsjf", "leverage"]) assert.ok(up[k] >= s0[k] - 1e-9, `impact → ${k}`);
    const heavier = score({ ...base, dims: { ...base.dims, effort: lift(base.dims.effort, t) } });
    for (const k of ["rice", "ice", "wsjf", "leverage"]) assert.ok(heavier[k] <= s0[k] + 1e-9, `effort → ${k}`);
    const sooner = score({ ...base, dims: { ...base.dims, urgency: lift(base.dims.urgency, t) } });
    assert.ok(sooner.wsjf >= s0.wsjf - 1e-9);
    const unlocks = score({ ...base, dims: { ...base.dims, leverage: lift(base.dims.leverage, t) } });
    assert.ok(unlocks.leverage >= s0.leverage - 1e-9 && unlocks.wsjf >= s0.wsjf - 1e-9);
  }));
  it("an option at least as good on every dimension, and strictly better on one, is never ranked below the other", () => forAll(150, (r) => {
    const a = randomItem(r, "a");
    const t = r.float(0.1, 1);
    // b improves on a everywhere it can: higher impact/urgency/reach/confidence/leverage, lower effort.
    const lower = (d) => lift([...d].reverse(), t).reverse();
    const b = { optionId: "b", dims: { ...a.dims, impact: lift(a.dims.impact, t), urgency: lift(a.dims.urgency, t), reach: lift(a.dims.reach, t), confidence: lift(a.dims.confidence, t), leverage: lift(a.dims.leverage, t), effort: lower(a.dims.effort) } };
    const p = prioritize(r.shuffle([a, b, randomItem(r, "c")]));
    assert.ok(rowOf(p, "b").rank < rowOf(p, "a").rank);
    assert.ok(rowOf(p, "b").pFirst >= rowOf(p, "a").pFirst - 1e-12);
  }));
  it("the WSJF shown is the mean of the WSJF lottery behind P(first)", () => forAll(60, (r) => {
    const item = randomItem(r, "x");
    const FIB = [1, 2, 3, 5, 8];
    const cod = Lottery.of(FIB, item.dims.impact).add(Lottery.of(FIB, item.dims.urgency)).add(Lottery.of(FIB, item.dims.leverage));
    near(rowOf(prioritize([item]), "x").wsjf, cod.combine(Lottery.of(FIB, item.dims.effort), (c, s) => c / s).mean(), 1e-12);
  }));
  it("an empty list has no priorities", () => {
    const p = prioritize([]);
    assert.equal(p.first, null); assert.deepEqual(p.rows, []);
  });
});
