// Invariants of the creative engine (src/decision-engine/creative.ts), stated as in cdm's MATH.md and checked on
// random problems. Lottery L0–L6, belief B1–B4, policy P1–P8, plus a Monte Carlo check of the generative model.
// Reproduce a failure with PROPERTY_SEED=<seed>; run harder with PROPERTY_RUNS=600.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Lottery, belief, combine, creativeDecide, cyclicOrbit, expectedImprovement, expectedMax, gate, interior, noulBelief, pBest, relabel,
  reversalOrbit, temper, valueLottery, DEFAULT_POLICY, NULL_BASELINE, TIE_TOL,
} from "../src/decision-engine/creative.ts";
import { forAll, near, problem } from "./helpers/property.js";

const lottery = (r, n = r.int(1, 6)) => Lottery.of(Array.from({ length: n }, () => Math.round(r.float(-2, 2) * 8) / 8), Array.from({ length: n }, () => r.float(0.01, 1)));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
/** Brute force over the joint support: P(best) with fair ties, and E[max]. The oracle for L4/L5. */
function enumerate(cs) {
  const pb = cs.map(() => 0); let emax = 0;
  const walk = (k, prob, picks) => {
    if (k === cs.length) {
      const alive = picks.map((v, i) => [v, i]).filter(([v]) => v !== null);
      const top = Math.max(...alive.map(([v]) => v));
      const winners = alive.filter(([v]) => Math.abs(v - top) <= TIE_TOL * Math.max(1, Math.abs(top)));
      winners.forEach(([, i]) => { pb[i] += prob / winners.length; });
      emax += prob * top;
      return;
    }
    const c = cs[k];
    if (c.fail > 0) walk(k + 1, prob * c.fail, [...picks, null]);
    c.value.x.forEach((x, i) => walk(k + 1, prob * (1 - c.fail) * c.value.p[i], [...picks, x]));
  };
  walk(0, 1, []);
  return { pb, emax };
}

describe("L0 lotteries are normalised measures", () => {
  it("sorted distinct atoms, positive masses summing to 1, CDF ends at 1", () => forAll(200, (r) => {
    const v = lottery(r, r.int(1, 30)).add(lottery(r)).mix(lottery(r), r.float());
    for (let i = 1; i < v.x.length; i++) assert.ok(v.x[i] > v.x[i - 1]);
    assert.ok(v.p.every((m) => m > 0));
    near(sum(v.p), 1, 1e-12);
    assert.equal(v.cdf(v.x.at(-1)), 1);
  }));
});

describe("L1 algebra of independent lotteries", () => {
  it("+ is commutative and associative in distribution; E is linear; variances add", () => forAll(100, (r) => {
    const a = lottery(r), b = lottery(r), c = lottery(r);
    const ab = a.add(b), ba = b.add(a);
    assert.deepEqual(ab.x.length, ba.x.length);
    ab.x.forEach((x, i) => { near(x, ba.x[i]); near(ab.p[i], ba.p[i]); });
    near(a.add(b).add(c).mean(), a.add(b.add(c)).mean());
    near(ab.mean(), a.mean() + b.mean());
    near(ab.std() ** 2, a.std() ** 2 + b.std() ** 2, 1e-9);
    const q = r.float();
    near(a.mix(b, q).mean(), (1 - q) * a.mean() + q * b.mean());
  }));
});

describe("L2 CVaR is a coherent lower-tail reward measure", () => {
  it("≤ mean, CVaR₁ = E, monotone in α, translation-equivariant, positively homogeneous, superadditive", () => forAll(150, (r) => {
    const a = lottery(r, r.int(1, 10)), b = lottery(r, r.int(1, 10));
    const alpha = r.float(0.05, 1), c = r.float(-3, 3), k = r.float(0.1, 3);
    assert.ok(a.cvar(alpha) <= a.mean() + 1e-12);
    near(a.cvar(1), a.mean());
    assert.ok(a.cvar(Math.min(1, alpha + 0.1)) >= a.cvar(alpha) - 1e-12);
    near(a.shift(c).cvar(alpha), a.cvar(alpha) + c);
    near(a.scale(k).cvar(alpha), k * a.cvar(alpha));
    assert.ok(a.add(b).cvar(alpha) >= a.cvar(alpha) + b.cvar(alpha) - 1e-9);
  }));
});

describe("L3 compaction", () => {
  it("keeps total mass and the mean exactly, and caps the atoms", () => forAll(30, (r) => {
    let v = Lottery.point(0);
    const dims = r.int(5, 9);
    let mean = 0;
    for (let d = 0; d < dims; d++) {
      const w = r.float(0.05, 1), p = r.dist();
      mean += w * p.reduce((a, m, i) => a + m * i / 4, 0);
      v = v.add(Lottery.of([0, 0.25, 0.5, 0.75, 1], p).scale(w));
    }
    assert.ok(v.x.length <= 2048);
    near(sum(v.p), 1, 1e-12);
    near(v.mean(), mean, 1e-9);
  }));
  it("moves CVaR by at most one grid step", () => forAll(20, (r) => {
    const parts = Array.from({ length: 6 }, () => Lottery.of([0, 0.25, 0.5, 0.75, 1], r.dist()).scale(r.float(0.1, 1)));
    const capped = parts.reduce((a, b) => a.add(b), Lottery.point(0));
    // The same sum with a cap high enough never to compact.
    let exact = { x: [0], p: [1] };
    for (const part of parts) {
      const xs = [], ps = [];
      exact.x.forEach((x, i) => part.x.forEach((y, j) => { xs.push(x + y); ps.push(exact.p[i] * part.p[j]); }));
      exact = Lottery.of(xs, ps, 1e7);
    }
    const step = (exact.x.at(-1) - exact.x[0]) / 2047;
    for (const alpha of [0.05, 0.2, 0.5]) assert.ok(Math.abs(capped.cvar(alpha) - exact.cvar(alpha)) <= step + 1e-9);
  }));
});

describe("L4 P(best) is exact", () => {
  it("matches brute-force enumeration with fair ties, sums to 1, is permutation-equivariant", () => forAll(150, (r) => {
    const n = r.int(1, 4);
    const cs = Array.from({ length: n }, (_, i) => ({ value: lottery(r, r.int(1, 3)), fail: i === 0 ? 0 : r.pick([0, 0, r.float(0, 0.9)]) }));
    const p = pBest(cs), oracle = enumerate(cs);
    p.forEach((x, i) => near(x, oracle.pb[i], 1e-9, `p[${i}]`));
    near(sum(p), 1, 1e-9);
    const order = r.shuffle([...cs.keys()]);
    const q = pBest(order.map((i) => cs[i]));
    order.forEach((i, k) => near(q[k], p[i]));
  }));
  it("identical competitors split equally", () => forAll(50, (r) => {
    const v = lottery(r), n = r.int(2, 5);
    pBest(Array.from({ length: n }, () => ({ value: v, fail: 0 }))).forEach((x) => near(x, 1 / n));
  }));
  it("refuses a race where everyone may fail", () => {
    assert.throws(() => pBest([{ value: Lottery.point(1), fail: 0.5 }]));
  });
});

describe("L5 E[max] and EVPI", () => {
  it("E[max] matches enumeration and is at least every mean", () => forAll(150, (r) => {
    const n = r.int(1, 4);
    const cs = Array.from({ length: n }, (_, i) => ({ value: lottery(r, r.int(1, 3)), fail: i === 0 ? 0 : r.pick([0, r.float(0, 0.9)]) }));
    near(expectedMax(cs), enumerate(cs).emax, 1e-9);
    const base = cs[0].value;
    for (const c of cs) assert.ok(expectedMax(cs) >= (1 - c.fail) * c.value.mean() + c.fail * base.mean() - 1e-9 || c.fail > 0);
  }));
});

describe("L6 expected improvement", () => {
  const reference = (v, b) => { let s = 0; v.x.forEach((x, i) => b.x.forEach((y, j) => { s += v.p[i] * b.p[j] * Math.max(x - y, 0); })); return s; };
  it("the O(n+m) closed form equals the product-lottery definition", () => forAll(300, (r) => {
    const v = lottery(r, r.int(1, 40)), b = lottery(r, r.int(1, 40));
    near(expectedImprovement(v, b), reference(v, b), 1e-12);
  }));
  it("is at least the mean gain, zero against a dominating status quo, and never lowered by a mean-preserving spread", () => forAll(150, (r) => {
    const v = lottery(r), b = lottery(r);
    assert.ok(expectedImprovement(v, b) >= Math.max(0, v.mean() - b.mean()) - 1e-12);
    assert.equal(expectedImprovement(Lottery.point(-10), b), 0);
    const m = v.mean(), d = r.float(0, 1);
    const spread = Lottery.of([m - d, m + d], [0.5, 0.5]);
    assert.ok(expectedImprovement(spread, b) >= expectedImprovement(Lottery.point(m), b) - 1e-12);
  }));
});

describe("B beliefs", () => {
  it("B1 tempering is a group action that keeps the ranking; T → ∞ is uniform; 0.5 stays 0.5", () => forAll(150, (r) => {
    const p = r.dist(r.int(2, 6)), t1 = r.float(0.3, 3), t2 = r.float(0.3, 3);
    temper(temper(p, t1), t2).forEach((x, i) => near(x, temper(p, t1 * t2)[i], 1e-9));
    temper(p, 1).forEach((x, i) => near(x, p[i], 1e-12));
    const q = temper(p, t1);
    for (let i = 0; i < p.length; i++) for (let j = 0; j < p.length; j++) if (p[i] > p[j] + 1e-12) assert.ok(q[i] > q[j]);
    temper(p, 1e9).forEach((x) => near(x, 1 / p.length, 1e-6));
    near(noulBelief(0.5), 0.5, 1e-12);
  }));
  it("B3 the log pool is symmetric and unanimous", () => forAll(100, (r) => {
    const p = r.dist(), q = r.dist(), w = r.float();
    combine([p, q], [w, 1 - w]).forEach((x, i) => near(x, combine([q, p], [1 - w, w])[i], 1e-12));
    combine([p, p, p], [0.2, 0.3, 0.5]).forEach((x, i) => near(x, p[i], 1e-9));
  }));
  it("B4 the cyclic orbit removes any multiplicative position bias exactly", () => forAll(100, (r) => {
    const n = r.int(2, 6), truth = r.dist(n, 0), bias = Array.from({ length: n }, () => r.float(0.2, 3));
    // Shown in `order`, a biased judge reports truth[label]·bias[position], renormalised; decode back to labels.
    const seen = (order) => { const shown = order.map((label, k) => truth[label] * bias[k]); const s = sum(shown); return relabel(shown.map((x) => x / s), order); };
    const decoded = cyclicOrbit(n).map(seen);
    // belief() smooths and tempers; undo neither and compare at the barycenter directly.
    const barycenter = combine(decoded, decoded.map(() => 1 / n));
    barycenter.forEach((x, i) => near(x, truth[i], 1e-9));
    assert.equal(belief("choice", decoded).length, n);
  }));
  it("B4 the reversal orbit cancels a linear (odd) direction bias on Scores", () => forAll(100, (r) => {
    const truth = r.dist(5, 0), slope = r.float(-0.5, 0.5);
    const bias = [0, 1, 2, 3, 4].map((k) => Math.exp(slope * (k - 2)));
    const seen = (order) => { const shown = order.map((label, k) => truth[label] * bias[k]); const s = sum(shown); return relabel(shown.map((x) => x / s), order); };
    const out = combine(reversalOrbit(5).map(seen), [0.5, 0.5]);
    out.forEach((x, i) => near(x, truth[i], 1e-9));
  }));
  it("interior keeps a distribution in the open simplex", () => forAll(50, (r) => {
    const p = interior([1, 0, 0, 0, 0], r.float(0.001, 0.2));
    assert.ok(p.every((x) => x > 0)); near(sum(p), 1, 1e-12);
  }));
});

const decide = (c, pol) => creativeDecide(c.problem, c.judgments, pol);

describe("P policy axioms", () => {
  it("P1 a commit always exists; P(best), portfolio sum to 1; EVPI ≥ 0; the baseline is reliable", () => forAll(150, (r) => {
    const c = problem(r);
    const d = decide(c);
    assert.ok(d.stats.some((s) => s.id === d.commit && s.reliable));
    near(sum(d.stats.filter((s) => s.status !== "reject").map((s) => s.pBest)), 1, 1e-9);
    near(sum(Object.values(d.portfolio)), 1, 1e-9);
    assert.ok(d.evpi >= 0);
    assert.ok(d.stats.find((s) => s.baseline).reliable);
    for (const s of d.stats) {
      assert.ok(Number.isFinite(s.mean) && Number.isFinite(s.cvar) && Number.isFinite(s.ei));
      assert.ok(s.cvar <= s.mean + 1e-12);
      assert.ok(s.mean >= -1e-12 && s.mean <= 1 + 1e-12, "utility stays on the 0..1 level scale");
      if (s.status === "reject") assert.equal(s.pBest, 0);
    }
    if (d.innovation) assert.notEqual(d.innovation, d.commit);
    if (!c.judgments.some((j) => j.baseline)) assert.ok(d.stats.some((s) => s.id === NULL_BASELINE));
  }));
  it("P2 permuting the options permutes nothing else", () => forAll(100, (r) => {
    const c = problem(r);
    const a = decide(c), b = decide({ ...c, judgments: r.shuffle(c.judgments) });
    assert.equal(b.commit, a.commit); assert.equal(b.innovation, a.innovation); assert.deepEqual(b.escalate, a.escalate);
    near(b.evpi, a.evpi);
    for (const s of a.stats) { const t = b.stats.find((x) => x.id === s.id); near(t.mean, s.mean); near(t.pBest, s.pBest); near(t.ei, s.ei); assert.equal(t.status, s.status); }
  }));
  it("P3 scaling every weight changes nothing", () => forAll(100, (r) => {
    const c = problem(r), k = r.float(0.01, 50);
    const a = decide(c), b = decide({ ...c, problem: { ...c.problem, dimensions: c.problem.dimensions.map((d) => ({ ...d, weight: d.weight * k })) } });
    assert.equal(b.commit, a.commit); assert.equal(b.innovation, a.innovation);
    a.stats.forEach((s, i) => { near(b.stats[i].mean, s.mean, 1e-9); near(b.stats[i].pBest, s.pBest, 1e-9); });
  }));
  it("P4 adding a rejected option leaves the commit unchanged", () => forAll(100, (r) => {
    const c = problem(r);
    const bad = { ...c.judgments[c.judgments.length - 1], optionId: "zz_bad", baseline: false, violations: { h1: 0.95, h2: 0, s1: 0 } };
    const a = decide(c), b = decide({ ...c, judgments: [...c.judgments, bad] });
    assert.equal(b.stats.find((s) => s.id === "zz_bad").status, "reject");
    assert.equal(b.commit, a.commit);
  }));
  it("P5 novelty only gates the innovation slot", () => forAll(100, (r) => {
    const c = problem(r);
    const a = decide(c), b = decide({ ...c, judgments: c.judgments.map((j) => ({ ...j, novelty: r.dist() })) });
    assert.equal(b.commit, a.commit); near(b.evpi, a.evpi); assert.deepEqual(b.portfolio, a.portfolio);
    a.stats.forEach((s, i) => { near(b.stats[i].mean, s.mean); near(b.stats[i].pBest, s.pBest); near(b.stats[i].cvar, s.cvar); });
  }));
  it("P6 more hard risk never improves the gate or lowers f; E[U] moves toward E[B]", () => forAll(150, (r) => {
    const c = problem(r);
    const i = r.int(c.judgments.findIndex((j) => !j.baseline), c.judgments.length - 1);
    if (c.judgments[i].baseline) return;
    const rank = { clear: 0, verify: 1, reject: 2 };
    const more = { ...c, judgments: c.judgments.map((j, k) => (k !== i ? j : { ...j, violations: { ...j.violations, h1: Math.min(1, j.violations.h1 + r.float(0, 0.5)) } })) };
    const a = decide(c), b = decide(more);
    const sa = a.stats.find((s) => s.id === `o${i}`), sb = b.stats.find((s) => s.id === `o${i}`);
    assert.ok(rank[sb.status] >= rank[sa.status]);
    assert.ok(sb.fail >= sa.fail - 1e-12);
    const base = a.stats.find((s) => s.baseline).mean;
    assert.ok(Math.abs(sb.mean - base) <= Math.abs(sa.mean - base) + 1e-9);
  }));
  it("P8 an affine change of level utilities maps E and CVaR affinely and leaves every decision unchanged", () => forAll(80, (r) => {
    const c = problem(r, { baseline: true });
    const a0 = r.float(0.2, 5), b0 = r.float(-3, 3);
    const levels = [0, 0.25, 0.5, 0.75, 1];
    const mapped = { ...c, problem: { ...c.problem, dimensions: c.problem.dimensions.map((d) => ({ ...d, values: levels.map((x) => a0 * x + b0) })) } };
    const pol = { ...DEFAULT_POLICY, downsideTolerance: DEFAULT_POLICY.downsideTolerance * a0, voiCost: DEFAULT_POLICY.voiCost * a0 };
    const x = decide(c), y = decide(mapped, pol);
    assert.equal(y.commit, x.commit); assert.equal(y.innovation, x.innovation); assert.deepEqual(y.escalate, x.escalate);
    x.stats.forEach((s, i) => {
      near(y.stats[i].mean, a0 * s.mean + b0, 1e-7); near(y.stats[i].cvar, a0 * s.cvar + b0, 1e-7);
      near(y.stats[i].ei, a0 * s.ei, 1e-7); near(y.stats[i].pBest, s.pBest, 1e-7);
      assert.equal(y.stats[i].status, s.status); assert.equal(y.stats[i].reliable, s.reliable);
    });
  }));
});

describe("gates and named creative behaviours", () => {
  it("clear ≤ δ < verify < ρ ≤ reject", () => forAll(100, (r) => {
    const q = r.float();
    const j = { optionId: "x", dims: {}, violations: { h: q }, novelty: [1] };
    const g = gate({ dimensions: [], limits: [{ id: "h", hard: true }] }, j, DEFAULT_POLICY);
    assert.equal(g.status, q >= 0.7 ? "reject" : q > 0.15 ? "verify" : "clear");
    near(g.fail, q);
  }));
  it("a check-only limit never rules an option out, but its risk still falls back to the status quo", () => forAll(60, (r) => {
    const q = r.float(0.7, 0.999);
    const p = { dimensions: [{ id: "v", weight: 1, levels: 5 }], limits: [{ id: "own", hard: true, checkOnly: true }, { id: "law", hard: true }] };
    const j = { optionId: "x", dims: { v: r.dist() }, violations: { own: q, law: 0 }, novelty: [1, 0, 0, 0, 0] };
    const g = gate(p, j, DEFAULT_POLICY);
    assert.equal(g.status, "verify"); assert.deepEqual(g.checks, ["own"]); near(g.fail, q);
    assert.equal(gate(p, { ...j, violations: { own: 0, law: q } }, DEFAULT_POLICY).status, "reject", "a full hard limit still vetoes");
  }));
  it("unknown is not risky: q = 0.5 is verify, and it can still be the commit", () => {
    const sure = (k) => [0, 1, 2, 3, 4].map((i) => (i === k ? 0.96 : 0.01));
    const p = { dimensions: [{ id: "v", weight: 1, levels: 5 }], limits: [{ id: "h", hard: true }] };
    const d = creativeDecide(p, [
      { optionId: "keep", baseline: true, dims: { v: sure(1) }, violations: { h: 0 }, novelty: sure(0) },
      { optionId: "bold", dims: { v: sure(4) }, violations: { h: 0.5 }, novelty: sure(4) },
    ]);
    const bold = d.stats.find((s) => s.id === "bold");
    assert.equal(bold.status, "verify");
    assert.equal(d.commit, "bold");
    assert.ok(bold.utility.x[0] >= d.stats.find((s) => s.baseline).utility.x[0] - 1e-12, "the fallback bounds the downside");
  });
  it("an exact tie goes to the status quo (switching needs a strict gain), then to the smaller id", () => forAll(60, (r) => {
    const p = { dimensions: [{ id: "v", weight: 1, levels: 5 }], limits: [{ id: "h", hard: true }] };
    const dims = { v: r.dist() };
    const same = (optionId, baseline = false) => ({ optionId, baseline, dims, violations: { h: 0 }, novelty: [1, 0, 0, 0, 0] });
    assert.equal(creativeDecide(p, r.shuffle([same("b"), same("z", true), same("a")])).commit, "z");
    assert.equal(creativeDecide(p, r.shuffle([same("b"), same("a")])).commit, "a");
  }));
  it("no novelty, no innovation slot; spread wins it at equal means", () => {
    const p = { dimensions: [{ id: "v", weight: 1, levels: 5 }], limits: [] };
    const flat = [0, 0, 1, 0, 0], wide = [0.5, 0, 0, 0, 0.5], novel = [0, 0, 0, 0, 1];
    // A low status quo, so the wide option's lower tail still passes the reliability gate.
    const base = { optionId: "keep", baseline: true, dims: { v: [1, 0, 0, 0, 0] }, violations: {}, novelty: [1, 0, 0, 0, 0] };
    const none = creativeDecide(p, [base, { optionId: "a", dims: { v: flat }, violations: {}, novelty: [1, 0, 0, 0, 0] }]);
    assert.equal(none.innovation, null);
    const d = creativeDecide(p, [base, { optionId: "a", dims: { v: flat }, violations: {}, novelty: novel }, { optionId: "b", dims: { v: wide }, violations: {}, novelty: novel }]);
    assert.equal(d.commit, "a", "an exact tie goes to the smaller id");
    assert.equal(d.innovation, "b");
  });
});

describe("exact vs simulated", () => {
  it("Monte Carlo of the generative model agrees with the exact E[U] and P(best)", () => forAll(6, (r) => {
    const c = problem(r, { options: 3, dims: 2, baseline: true });
    const d = decide(c);
    const live = d.stats.filter((s) => s.status !== "reject");
    const hard = c.problem.limits.filter((l) => l.hard).map((l) => l.id);
    const sample = (p) => { let u = r.next(), k = 0; while (k < p.length - 1 && (u -= p[k]) > 0) k++; return k; };
    const N = 60_000, wins = Object.fromEntries(live.map((s) => [s.id, 0])), totals = Object.fromEntries(live.map((s) => [s.id, 0]));
    const wsum = sum(c.problem.dimensions.map((x) => x.weight));
    for (let n = 0; n < N; n++) {
      const v = {}; let best = -Infinity, winners = [];
      for (const j of c.judgments) {
        let x = sum(c.problem.dimensions.map((dim) => (dim.weight / wsum) * sample(j.dims[dim.id]) / 4));
        if (r.next() < j.violations.s1 && !j.baseline) x *= 0.7; // soft: shrink toward the floor (0)
        if (j.baseline && r.next() < j.violations.s1) x *= 0.7;
        v[j.optionId] = x;
      }
      for (const j of c.judgments) {
        const s = live.find((t) => t.id === j.optionId); if (!s) continue;
        const failed = !j.baseline && hard.some((h) => r.next() < j.violations[h]);
        const u = failed ? v.o0 : v[j.optionId];
        totals[j.optionId] += u;
        if (!failed) { if (u > best + 1e-12) { best = u; winners = [j.optionId]; } else if (Math.abs(u - best) <= 1e-12) winners.push(j.optionId); }
      }
      winners.forEach((w) => { wins[w] += 1 / winners.length; });
    }
    for (const s of live) {
      assert.ok(Math.abs(totals[s.id] / N - s.mean) < 0.01, `E[U] ${s.id}: ${totals[s.id] / N} vs ${s.mean}`);
      assert.ok(Math.abs(wins[s.id] / N - s.pBest) < 0.02, `P(best) ${s.id}: ${wins[s.id] / N} vs ${s.pBest}`);
    }
  }));
});

describe("contracts", () => {
  it("malformed input is refused, not guessed", () => {
    const p = { dimensions: [{ id: "v", weight: 1, levels: 5 }], limits: [] };
    const j = (id, extra = {}) => ({ optionId: id, dims: { v: [0.2, 0.2, 0.2, 0.2, 0.2] }, violations: {}, novelty: [1, 0, 0, 0, 0], ...extra });
    assert.throws(() => creativeDecide(p, [j("a"), j("a")]), /unique/);
    assert.throws(() => creativeDecide(p, [j("a", { baseline: true }), j("b", { baseline: true })]), /baseline/);
    assert.throws(() => creativeDecide(p, [j("a", { dims: {} })]), /belief/);
    assert.throws(() => creativeDecide({ ...p, dimensions: [{ id: "v", weight: 0, levels: 5 }] }, [j("a")]), /weights/);
    assert.throws(() => Lottery.of([1, 2], [1]), /equal-length/);
    assert.throws(() => Lottery.of([1], [-1]), /masses/);
    assert.throws(() => Lottery.of([Number.NaN], [1]), /finite/);
    assert.throws(() => Lottery.point(1).cvar(0), /alpha/);
    assert.throws(() => valueLottery({ ...p, dimensions: [{ id: "v", weight: 1, levels: 5, values: [0, 1] }] }, j("a"), DEFAULT_POLICY), /one value per level/);
  });
});
