// Creative decision making: pick a sound option AND keep a bounded bet on a new one.
// A TypeScript port of cdm v0.2.0 (../creative-decision, paper "Unknown Is Not Risky"). Pure math, no network.
//
//   beliefs   per option: a distribution over each factor's levels, P(violation) per hard/soft limit,
//             a distribution over novelty levels and over approach types ("niches")
//   value     V_i = m + (Σ_d w_d·X_{i,d} − m)·Π_soft M_{i,c}       exact finite lotteries, no sampling
//   gate      f_i = 1 − Π_hard(1 − q_ic);  clear q ≤ δ · verify δ < q < ρ · reject q ≥ ρ
//   fallback  U_i = V_i w.p. 1 − f_i, else the status quo B       (check first; if the check fails, keep B)
//   select    commit = argmax_reliable E[U];  innovation = argmax_{reliable, novel, ≠ commit} EI
//             portfolio = P(best) over B and one elite per niche;  escalate ⇔ EVPI > κ
//
// The central idea: a judge's P(violation) ≈ 0.5 on an unfamiliar option means *unknown*, not *risky*, so it
// becomes "verify" — a check with a fallback — instead of a veto. The downside is bounded by construction.
// Imperfect checks (sensitivity s, harm H) and robust dependence between checks are deliberately left out of
// this port: ORION shows the check, the person runs it.

/** Relative gap below which two values are equal (atoms merge, ties split). */
export const TIE_TOL = 1e-9;
/** Compaction threshold. 2048 keeps a decision with 8 factors well under a few ms in JS. */
export const MAX_ATOMS = 2048;

// ---------------------------------------------------------------------------------------------------------------
// Belief layer: Aitchison geometry on the open simplex. Calibration and pooling are linear in clr coordinates.
// ---------------------------------------------------------------------------------------------------------------

export type Kind = "score" | "choice" | "noul";
/** Priors from the jev-1.13 audit: Choice/Score overconfident (T > 1), Noul underconfident (T < 1). Kept for jev-1.14 until refit on outcomes. */
export const TEMPERATURE: Record<Kind, number> = { score: 1.3, choice: 1.3, noul: 0.9 };
export const SMOOTHING: Record<Kind, number> = { score: 0.03, choice: 0.03, noul: 0.02 };

const closure = (p: number[]) => { const s = p.reduce((a, b) => a + b, 0); return s > 0 ? p.map((x) => x / s) : p.map(() => 1 / p.length); };
/** (1−η)p + ηu: moves raw output with exact 0/1 values into the open simplex. */
export const interior = (p: number[], eta: number) => closure(p).map((x) => (1 - eta) * x + eta / p.length);
const clr = (p: number[]) => { const l = p.map(Math.log); const m = l.reduce((a, b) => a + b, 0) / l.length; return l.map((x) => x - m); };
const clrInv = (x: number[]) => { const top = Math.max(...x); return closure(x.map((v) => Math.exp(v - top))); };
/** ⊕_j w_j ⊙ p_j — the log opinion pool, also the orbit barycenter when every w is 1/n. */
export function combine(ps: number[][], weights: number[]) {
  const logs = ps.map(clr);
  return clrInv(ps[0].map((_, k) => logs.reduce((sum, l, j) => sum + weights[j] * l[k], 0)));
}
/** (1/T) ⊙ p. T > 1 softens an overconfident judge; ranking is preserved. */
export const temper = (p: number[], temperature: number) => clrInv(clr(p).map((x) => x / temperature));

/** decode → interior → orbit barycenter → temper. `decoded` holds one distribution per orbit member, in label order. */
export function belief(kind: Kind, decoded: number[][]): number[] {
  const qs = decoded.map((d) => interior(d, SMOOTHING[kind]));
  return temper(combine(qs, qs.map(() => 1 / qs.length)), TEMPERATURE[kind]);
}
export const noulBelief = (pYes: number) => belief("noul", [[1 - pYes, pYes]])[1];

/** Score answers come keyed by presented position; undo a presentation order (`order[k]` = label shown at k). */
export function relabel(byPosition: number[], order: number[]): number[] {
  const out = new Array<number>(order.length).fill(0);
  order.forEach((label, position) => { out[label] = byPosition[position]; });
  return out;
}
/** Score is ordinal, so reversal is the only re-ordering allowed: it cancels direction bias (cdm B4). */
export const reversalOrbit = (n: number) => [[...Array(n).keys()], [...Array(n).keys()].reverse()];
/** Choice is unordered: the cyclic orbit removes any multiplicative position bias exactly. */
export const cyclicOrbit = (n: number) => [...Array(n).keys()].map((s) => [...Array(n).keys()].map((k) => (k + s) % n));

// ---------------------------------------------------------------------------------------------------------------
// Value layer: exact finite lotteries Σ p_k δ_{x_k}. Binary operations combine *independent* random variables.
// ---------------------------------------------------------------------------------------------------------------

export class Lottery {
  private constructor(readonly x: number[], readonly p: number[]) {}

  static of(x: number[], p: number[], maxAtoms = MAX_ATOMS): Lottery {
    if (x.length !== p.length || x.length === 0) throw new Error("support and masses must be equal-length and non-empty");
    if (p.some((m) => m < 0) || !x.every(Number.isFinite) || p.reduce((a, b) => a + b, 0) <= 0) throw new Error("masses ≥ 0 with positive total; atoms finite");
    // Fast path: with more distinct atoms than the cap, the result is the compacted grid, and compaction needs only
    // the range, not a sorted, merged list. Counting distinct atoms on a native numeric sort is far cheaper than
    // sorting (x, p) pairs. Merging first would move no atom by more than the tie tolerance, so this is the same
    // lottery to within it.
    if (x.length > maxAtoms && distinct(x) > maxAtoms) return compact(x, p, maxAtoms);
    const idx = x.map((_, i) => i).filter((i) => p[i] > 0).sort((a, b) => x[a] - x[b] || a - b);
    const ux: number[] = [], up: number[] = [];
    for (const i of idx) {
      const last = ux.length - 1;
      // A merged group keeps its smallest value, so exact duplicates stay exact.
      if (last >= 0 && x[i] - ux[last] <= TIE_TOL * Math.max(1, Math.abs(x[i]))) up[last] += p[i];
      else { ux.push(x[i]); up.push(p[i]); }
    }
    const total = up.reduce((a, b) => a + b, 0);
    const m = up.map((v) => v / total);
    return ux.length > maxAtoms ? compact(ux, m, maxAtoms) : new Lottery(ux, m);
  }
  static point(v: number) { return new Lottery([v], [1]); }
  /** Trusted constructor for atoms already sorted, distinct and normalised (compaction output). */
  static sorted(x: number[], p: number[]) { return new Lottery(x, p); }
  /** `ok` with probability 1−q, `fail` with probability q. */
  static bernoulli(ok: number, fail: number, q: number) { return Lottery.of([ok, fail], [1 - q, q]); }

  combine(other: Lottery, op: (a: number, b: number) => number): Lottery {
    const xs: number[] = [], ps: number[] = [];
    for (let i = 0; i < this.x.length; i++) for (let j = 0; j < other.x.length; j++) { xs.push(op(this.x[i], other.x[j])); ps.push(this.p[i] * other.p[j]); }
    return Lottery.of(xs, ps);
  }
  add(other: Lottery) { return this.combine(other, (a, b) => a + b); }
  mul(other: Lottery) { return this.combine(other, (a, b) => a * b); }
  scale(c: number) { return Lottery.of(this.x.map((v) => v * c), this.p); }
  shift(c: number) { return Lottery.of(this.x.map((v) => v + c), this.p); }
  /** this with probability 1−q, other with probability q. */
  mix(other: Lottery, q: number) { return Lottery.of([...this.x, ...other.x], [...this.p.map((m) => (1 - q) * m), ...other.p.map((m) => q * m)]); }

  mean() { return this.x.reduce((a, v, i) => a + v * this.p[i], 0); }
  std() { const m = this.mean(); return Math.sqrt(Math.max(0, this.x.reduce((a, v, i) => a + (v - m) ** 2 * this.p[i], 0))); }
  /** Mean of the worst α of the probability mass (lower tail). */
  cvar(alpha: number) {
    if (!(alpha > 0 && alpha <= 1)) throw new Error("alpha must be in (0, 1]");
    let cum = 0, take = 0;
    for (let i = 0; i < this.x.length && cum < alpha; i++) { const m = Math.min(this.p[i], alpha - cum); take += m * this.x[i]; cum += this.p[i]; }
    return take / alpha;
  }
  /** P(X ≤ t). */
  cdf(t: number) {
    // At or past the last atom it is exactly 1: summing masses can land an ulp either side of it.
    if (t >= this.x[this.x.length - 1]) return 1;
    let c = 0;
    for (let i = 0; i < this.x.length && this.x[i] <= t; i++) c += this.p[i];
    return Math.min(1, c);
  }
}

/** Number of atoms after merging values within the tie tolerance. */
function distinct(x: number[]): number {
  const sorted = Float64Array.from(x).sort();
  let count = 1;
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > TIE_TOL * Math.max(1, Math.abs(sorted[i]))) count++;
  return count;
}

/**
 * Split each atom's mass between its two neighbouring grid points: keeps mass and mean exactly (cdm L3).
 * Input need not be sorted or merged; zero masses are skipped and the total is renormalised.
 */
function compact(x: number[], p: number[], g: number): Lottery {
  let lo = Infinity, hi = -Infinity, total = 0;
  for (let k = 0; k < x.length; k++) if (p[k] > 0) { if (x[k] < lo) lo = x[k]; if (x[k] > hi) hi = x[k]; total += p[k]; }
  const m = new Float64Array(g);
  for (let k = 0; k < x.length; k++) {
    if (!(p[k] > 0)) continue;
    const pos = ((x[k] - lo) / (hi - lo)) * (g - 1);
    const i = Math.min(g - 2, Math.max(0, Math.floor(pos)));
    const frac = pos - i;
    m[i] += (p[k] / total) * (1 - frac); m[i + 1] += (p[k] / total) * frac;
  }
  const gx: number[] = [], gp: number[] = [];
  m.forEach((mass, i) => { if (mass > 0) { gx.push(lo + ((hi - lo) * i) / (g - 1)); gp.push(mass); } });
  // Grid points are sorted and evenly spaced, so they are already distinct atoms: no re-sort.
  return Lottery.sorted(gx, gp);
}

/** An action in a race: value V if it goes ahead, removed (−∞) with probability `fail`. */
export interface Competitor { value: Lottery; fail: number }

/** Common grid; per competitor P(strictly below each grid point) and P(at it). Near-equal atoms share a point. */
function tables(cs: Competitor[]) {
  const all = cs.flatMap((c, k) => c.value.x.map((x, i) => ({ x, k, p: (1 - c.fail) * c.value.p[i] }))).sort((a, b) => a.x - b.x);
  const grid: number[] = [];
  const at = all.map((a) => {
    const last = grid.length - 1;
    if (last < 0 || a.x - grid[last] > TIE_TOL * Math.max(1, Math.abs(a.x))) grid.push(a.x);
    return grid.length - 1;
  });
  const mass = cs.map(() => new Array<number>(grid.length).fill(0));
  all.forEach((a, i) => { mass[a.k][at[i]] += a.p; });
  const left = cs.map((c, k) => { let run = c.fail; return mass[k].map((m) => { const below = run; run += m; return below; }); });
  return { grid, left, mass };
}

/**
 * Exact P(competitor i is the best), ties split fairly (cdm L4):
 * Σ_x p_i(x) ∫₀¹ Π_{j≠i} (F_j(x⁻) + p_j(x) t) dt, because ∫₀¹ t^k dt = 1/(k+1) averages 1/(1+#ties).
 */
export function pBest(cs: Competitor[]): number[] {
  if (!cs.some((c) => c.fail === 0)) throw new Error("at least one competitor must never fail");
  const { left, mass } = tables(cs);
  const n = cs.length;
  const poly = new Float64Array(n + 1);
  return cs.map((_, i) => {
    let out = 0;
    const own = mass[i];
    for (let k = 0; k < own.length; k++) {
      if (own[k] <= 0) continue;
      // Π_{j≠i} (a_j + b_j t), coefficients low → high, multiplied in place.
      poly.fill(0); poly[0] = 1;
      let deg = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const a = left[j][k], b = mass[j][k];
        if (b === 0) { for (let d = 0; d <= deg; d++) poly[d] *= a; continue; }
        for (let d = deg + 1; d >= 1; d--) poly[d] = poly[d] * a + poly[d - 1] * b;
        poly[0] *= a; deg++;
      }
      let integral = 0;
      for (let d = 0; d <= deg; d++) integral += poly[d] / (d + 1);
      out += own[k] * integral;
    }
    return out;
  });
}

/** E[max_j U_j] = Σ_x x·ΔΠ_j F_j(x) (cdm L5). */
export function expectedMax(cs: Competitor[]): number {
  if (!cs.some((c) => c.fail === 0)) throw new Error("at least one competitor must never fail");
  const { grid, left, mass } = tables(cs);
  return grid.reduce((sum, x, k) => {
    const atOrBelow = cs.reduce((p, _, j) => p * (left[j][k] + mass[j][k]), 1);
    const below = cs.reduce((p, _, j) => p * left[j][k], 1);
    return sum + x * (atOrBelow - below);
  }, 0);
}

/**
 * E[max(V − B, 0)]: what the option could add over the status quo; monotone in the spread (cdm L6).
 * Exact in O(n + m): for each atom b of B, Σ_{v > b} p_v (v − b) = (Σ_{v>b} p_v v) − b·(Σ_{v>b} p_v), read off
 * suffix sums of V with one pointer, because both supports are sorted. The product lottery it replaces had
 * n·m atoms (4M for two compacted lotteries) and took seconds.
 */
export function expectedImprovement(v: Lottery, base: Lottery): number {
  const n = v.x.length;
  const mass = new Float64Array(n + 1), first = new Float64Array(n + 1);
  for (let i = n - 1; i >= 0; i--) { mass[i] = mass[i + 1] + v.p[i]; first[i] = first[i + 1] + v.p[i] * v.x[i]; }
  let total = 0, i = 0;
  for (let k = 0; k < base.x.length; k++) {
    const b = base.x[k];
    while (i < n && v.x[i] <= b) i++;
    total += base.p[k] * (first[i] - b * mass[i]);
  }
  return Math.max(0, total);
}

// ---------------------------------------------------------------------------------------------------------------
// Policy layer
// ---------------------------------------------------------------------------------------------------------------

export interface CreativeDimension { id: string; weight: number; /** utility per level, worst → best; default 0..1 evenly spaced */ values?: number[]; levels: number }
export interface CreativeLimit {
  id: string;
  /** hard: irreversible or unacceptable — it gates; soft: it costs */
  hard: boolean;
  /**
   * A hard limit that can ask for a check but never rule an option out on its own: one a model read into the
   * person's words. Its risk still counts toward falling back to the status quo.
   */
  checkOnly?: boolean;
}
export interface CreativeProblem { dimensions: CreativeDimension[]; limits: CreativeLimit[] }
export interface CreativeJudgment {
  optionId: string;
  /** The status quo everything is compared against. At most one. */
  baseline?: boolean;
  /** dimension id → distribution over its levels, worst → best */
  dims: Record<string, number[]>;
  /** limit id → P(violation) */
  violations: Record<string, number>;
  /** distribution over novelty levels, least → most novel */
  novelty: number[];
  /** niche id → probability */
  niche?: Record<string, number>;
}

export interface CreativePolicy {
  alpha: number; clearBelow: number; rejectAbove: number; softPenalty: number;
  downsideTolerance: number; minNovelty: number; voiCost: number; nullValue: number;
}
export const DEFAULT_POLICY: CreativePolicy = {
  alpha: 0.2, clearBelow: 0.15, rejectAbove: 0.7, softPenalty: 0.3,
  downsideTolerance: 0.05, minNovelty: 0.5, voiCost: 0.02, nullValue: 0,
};

export type GateStatus = "clear" | "verify" | "reject";
export interface CreativeStats {
  id: string;
  baseline: boolean;
  status: GateStatus;
  /** Hard limits to check before acting (verify only). */
  checks: string[];
  /** P(fails a hard check) */
  fail: number;
  mean: number; std: number; cvar: number;
  /** 0..1, least → most novel */
  novelty: number;
  niche: string;
  pBest: number;
  /** Expected improvement over the status quo. */
  ei: number;
  reliable: boolean;
  /** U as atoms for drawing; compacted. */
  utility: Lottery;
}
export interface CreativeDecision {
  stats: CreativeStats[];
  commit: string;
  innovation: string | null;
  portfolio: Record<string, number>;
  evpi: number;
  escalate: string[];
}

export const NULL_BASELINE = "∅";

function levelValues(d: CreativeDimension) {
  if (d.values) { if (d.values.length !== d.levels) throw new Error(`${d.id}: one value per level`); return d.values; }
  return [...Array(d.levels).keys()].map((i) => i / Math.max(1, d.levels - 1));
}

export function valueLottery(problem: CreativeProblem, j: CreativeJudgment, policy: CreativePolicy): Lottery {
  const wsum = problem.dimensions.reduce((a, d) => a + d.weight, 0);
  if (wsum <= 0) throw new Error("dimension weights must have a positive sum");
  let v = Lottery.point(0);
  for (const d of problem.dimensions) {
    const dist = j.dims[d.id];
    if (!dist || dist.length !== d.levels) throw new Error(`${j.optionId}: no belief for ${d.id}`);
    v = v.add(Lottery.of(levelValues(d), dist).scale(d.weight / wsum));
  }
  // Soft penalties shrink toward the utility floor, not toward 0, so nothing depends on where zero sits (cdm P8).
  const floor = problem.dimensions.reduce((a, d) => a + (d.weight / wsum) * Math.min(...levelValues(d)), 0);
  const hard = new Set(problem.limits.filter((c) => c.hard).map((c) => c.id));
  const soft = Object.entries(j.violations).filter(([id, q]) => !hard.has(id) && q > 0).sort(([a], [b]) => a.localeCompare(b)).map(([, q]) => q);
  if (!soft.length) return v;
  v = v.shift(-floor);
  for (const q of soft) v = v.mul(Lottery.bernoulli(1, 1 - policy.softPenalty, q));
  return v.shift(floor);
}

export function gate(problem: CreativeProblem, j: CreativeJudgment, policy: CreativePolicy): { status: GateStatus; checks: string[]; fail: number } {
  const hard = problem.limits.filter((c) => c.hard);
  const qs = hard.map((c) => [c.id, j.violations[c.id] ?? 0] as const);
  const fail = 1 - qs.reduce((a, [, q]) => a * (1 - q), 1);
  if (hard.some((c) => !c.checkOnly && (j.violations[c.id] ?? 0) >= policy.rejectAbove)) return { status: "reject", checks: [], fail };
  const checks = qs.filter(([, q]) => q > policy.clearBelow).map(([id]) => id).sort();
  return { status: checks.length ? "verify" : "clear", checks, fail };
}

const noveltyOf = (dist: number[]) => dist.reduce((a, p, i) => a + i * p, 0) / Math.max(1, dist.length - 1);
const nicheOf = (n?: Record<string, number>) => {
  const entries = Object.entries(n ?? {});
  return entries.length ? entries.sort(([a, p], [b, q]) => q - p || a.localeCompare(b))[0][0] : "-";
};

/** Values within float noise of the best tie; ties go to the status quo (switching needs a strict gain), then the smaller id. */
function argmax(idx: number[], key: (i: number) => number, ids: string[], base: number): number | null {
  if (!idx.length) return null;
  const top = Math.max(...idx.map(key));
  const near = idx.filter((i) => key(i) >= top - TIE_TOL * Math.max(1, Math.abs(top)));
  return near.sort((a, b) => Number(a !== base) - Number(b !== base) || (ids[a] < ids[b] ? -1 : ids[a] > ids[b] ? 1 : 0))[0];
}

export function creativeDecide(problem: CreativeProblem, judgments: CreativeJudgment[], policyIn: Partial<CreativePolicy> = {}): CreativeDecision {
  const pol = { ...DEFAULT_POLICY, ...policyIn };
  if (new Set(judgments.map((j) => j.optionId)).size !== judgments.length) throw new Error("option ids must be unique");
  if (judgments.filter((j) => j.baseline).length > 1) throw new Error("at most one baseline");

  const stats: CreativeStats[] = [];
  /** How each option enters the P(best) race, by index into stats. */
  const races: Competitor[] = [];
  const baseJ = judgments.find((j) => j.baseline);
  const b = baseJ ? valueLottery(problem, baseJ, pol) : Lottery.point(pol.nullValue);
  if (!baseJ) {
    stats.push({ id: NULL_BASELINE, baseline: true, status: "clear", checks: [], fail: 0, mean: b.mean(), std: 0, cvar: b.cvar(pol.alpha),
      novelty: 0, niche: "-", pBest: 0, ei: 0, reliable: true, utility: b });
    races.push({ value: b, fail: 0 });
  }
  for (const j of judgments) {
    const baseline = !!j.baseline;
    const v = baseline ? b : valueLottery(problem, j, pol);
    const g = baseline ? { status: "clear" as const, checks: [], fail: 0 } : gate(problem, j, pol);
    // Verify, else fall back: a failed check *is* the status-quo action, so it leaves the race instead of tying B,
    // and adds nothing to EI.
    const u = g.fail >= 1 ? b : g.fail <= 0 ? v : v.mix(b, g.fail);
    stats.push({
      id: j.optionId, baseline, status: g.status, checks: g.checks, fail: g.fail,
      mean: u.mean(), std: u.std(), cvar: u.cvar(pol.alpha), novelty: noveltyOf(j.novelty), niche: nicheOf(j.niche),
      pBest: 0, ei: baseline ? 0 : (1 - g.fail) * expectedImprovement(v, b), reliable: false, utility: u,
    });
    races.push({ value: v, fail: baseline ? 0 : g.fail });
  }

  const baseI = stats.findIndex((s) => s.baseline);
  const floor = stats[baseI].cvar - pol.downsideTolerance;
  for (const s of stats) s.reliable = s.status !== "reject" && s.cvar >= floor - 1e-12;

  const race = (idx: number[]) => idx.map((i) => races[i]);
  const live = stats.map((_, i) => i).filter((i) => stats[i].status !== "reject");
  pBest(race(live)).forEach((p, k) => { stats[live[k]].pBest = p; });

  const ids = stats.map((s) => s.id);
  const rel = stats.map((_, i) => i).filter((i) => stats[i].reliable);
  const commit = argmax(rel, (i) => stats[i].mean, ids, baseI);
  if (commit === null) throw new Error("no reliable option; the baseline invariant is broken");
  const novel = rel.filter((i) => stats[i].novelty >= pol.minNovelty && i !== commit);
  const innovation = argmax(novel, (i) => stats[i].ei, ids, baseI);

  const elites = new Map<string, number>();
  for (const i of rel) {
    if (stats[i].baseline) continue;
    const cur = elites.get(stats[i].niche);
    if (cur === undefined || argmax([cur, i], (k) => stats[k].mean, ids, baseI) === i) elites.set(stats[i].niche, i);
  }
  const pidx = [...new Set([baseI, ...elites.values()])].sort((a, b2) => a - b2);
  const shares = pBest(race(pidx));
  const portfolio = Object.fromEntries(pidx.map((i, k) => [stats[i].id, shares[k]]));

  const evpi = Math.max(0, expectedMax(race(rel)) - Math.max(...rel.map((i) => stats[i].mean)));
  const escalate = evpi > pol.voiCost
    ? [...rel].sort((a, c) => stats[c].pBest - stats[a].pBest || ids[a].localeCompare(ids[c])).slice(0, 2).map((i) => ids[i])
    : [];

  return {
    stats,
    commit: ids[commit],
    innovation: innovation === null ? null : ids[innovation],
    portfolio, evpi, escalate,
  };
}

/** A belief over 5 levels → ORION's −10..+10 factor value and a 0..1 confidence (1 − normalised std). */
export function toFactorScore(dist: number[]): { value: number; probabilityConfidence: number } {
  const k = dist.length - 1;
  const mean = dist.reduce((a, p, i) => a + i * p, 0);
  const sd = Math.sqrt(dist.reduce((a, p, i) => a + (i - mean) ** 2 * p, 0));
  return { value: Math.round(((mean / k) * 20 - 10) * 100) / 100, probabilityConfidence: Math.round(Math.max(0, Math.min(1, 1 - sd / (k / 2))) * 100) / 100 };
}

/**
 * The inverse, for scores that arrive as a point and a confidence (a general LLM, not a decision model): mass
 * `confidence` on the nearest level, the rest spread by closeness. Lets the creative engine run on any judge.
 */
export function fromPoint(level: number, confidence: number, levels = 5): number[] {
  const c = Math.max(0.05, Math.min(0.95, confidence));
  const at = Math.max(0, Math.min(levels - 1, Math.round(level)));
  const rest = [...Array(levels).keys()].map((i) => (i === at ? 0 : 1 / (1 + Math.abs(i - at))));
  const sum = rest.reduce((a, b) => a + b, 0);
  return rest.map((r, i) => (i === at ? c : ((1 - c) * r) / sum));
}
