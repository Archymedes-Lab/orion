// A tiny property-testing helper: seeded generators and a runner that reports the failing seed, so any failure is
// reproducible with PROPERTY_SEED=<seed>. No dependency; enough for the engine's invariants.
import assert from "node:assert/strict";

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = {
    next,
    float: (lo = 0, hi = 1) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    bool: (p = 0.5) => next() < p,
    /** A random point of the open simplex; `spike` sometimes makes it nearly one-hot, like a confident judge. */
    dist: (k = 5, spike = 0.2) => {
      const raw = Array.from({ length: k }, () => -Math.log(1 - next() * 0.999999));
      if (next() < spike) raw[Math.floor(next() * k)] += 20;
      const s = raw.reduce((x, y) => x + y, 0);
      return raw.map((x) => x / s);
    },
    shuffle: (list) => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; },
  };
  return r;
}

const RUNS = Number(process.env.PROPERTY_RUNS ?? 60);

/** Run `check(r, i)` on `runs` seeded generators; the failing seed is in the message. */
export function forAll(runs, check) {
  const fixed = process.env.PROPERTY_SEED;
  const seeds = fixed ? [Number(fixed)] : Array.from({ length: Math.max(1, Math.round(runs * (RUNS / 60))) }, (_, i) => 1000 + i * 7919);
  for (const seed of seeds) {
    try { check(rng(seed), seed); }
    catch (error) { error.message = `[seed ${seed}] ${error.message}`; throw error; }
  }
}

export const near = (a, b, tol = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)), `${msg} ${a} vs ${b}`);

/** A random creative problem: dims, limits (hard and soft), judgments, optional baseline. */
export function problem(r, { options = r.int(2, 6), dims = r.int(1, 5), baseline = r.bool(0.6), niches = ["a", "b", "c"] } = {}) {
  const dimensions = Array.from({ length: dims }, (_, k) => ({ id: `d${k}`, weight: r.float(0.05, 1), levels: 5 }));
  const limits = [{ id: "h1", hard: true }, { id: "h2", hard: true }, { id: "s1", hard: false }];
  const q = () => r.pick([0, 0.02, 0.1, 0.14, 0.3, 0.5, 0.69, 0.71, 0.9, r.float()]);
  const judgments = Array.from({ length: options }, (_, i) => ({
    optionId: `o${i}`,
    baseline: baseline && i === 0,
    dims: Object.fromEntries(dimensions.map((d) => [d.id, r.dist()])),
    violations: { h1: q(), h2: q(), s1: q() },
    novelty: r.dist(),
    niche: Object.fromEntries(niches.map((n) => [n, r.float()])),
  }));
  return { problem: { dimensions, limits }, judgments };
}
