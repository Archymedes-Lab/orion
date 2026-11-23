// Futures: the engine's Aftermath (../src/decision-engine/aftermath.ts) turned into what the 3D view and its readouts
// show. Every number comes from `aftermath()`; this file lays the options side by side in time, names the path that
// comes out ahead, finds where the lead changes hands, and samples the pictured option's spread as filaments.
import { aftermath, CLEAR, type Aftermath, type AftermathStep } from "@orion/decision-engine/aftermath.ts";
import type { DecisionRun } from "./decide";
import { view } from "./decide";

export interface Odds { well: number; mixed: number; hard: number }
export interface FuturePoint { days: number; when: string; value: number; low: number; high: number; checkIn: boolean; far: boolean; odds: Odds }
export interface FuturePath { id: string; label: string; pictured: boolean; points: FuturePoint[] }
export interface Strand { values: number[]; tone: "well" | "mixed" | "hard" }
/** One option's state at one moment. `score` is the net effect so far on the result screen's 0–100 scale (50 = no change). */
export interface Reading { id: string; label: string; value: number; score: number; low: number; high: number; odds: Odds }
export interface Moment { days: number; when: string; checkIn: boolean; far: boolean; readings: Reading[]; leaderId: string; close: boolean }
export interface Futures {
  picture: Aftermath;
  paths: FuturePath[];
  strands: Strand[];
  maxDays: number;
  moments: Moment[];
  /** The path that ends highest at the horizon; `close` when its lead there is inside the estimates' noise. */
  winner: { id: string; label: string; margin: number; close: boolean };
  /** The last moment at which the leader changes, if it does. */
  leadChange: { index: number; fromId: string; toId: string } | null;
}

/** Net effect (−10..10) on the 0–100 score scale the result screen uses. */
export const toScore = (value: number) => Math.round(Math.max(0, Math.min(100, ((value + 10) / 20) * 100)));
/** Inside this gap (in −10..10 units) two paths are level: about one point of the effect the engine calls clear. */
const LEVEL = CLEAR * 0.5;

const point = (s: AftermathStep): FuturePoint => ({
  days: s.days, when: s.when, value: s.value, low: s.range[0], high: s.range[1], checkIn: s.checkIn, far: s.horizon === "far", odds: s.odds,
});

/** A path's state at `days`: exact when it has that moment, otherwise interpolated between its neighbours. */
function at(path: FuturePath, days: number): Omit<Reading, "id" | "label" | "score"> {
  const pts = path.points;
  const j = pts.findIndex((p) => p.days >= days);
  if (j === 0 || (j > 0 && pts[j].days === days)) return pick(pts[j]);
  if (j === -1) return pick(pts[pts.length - 1]);
  const a = pts[j - 1], b = pts[j], t = (days - a.days) / Math.max(1, b.days - a.days);
  const mix = (x: number, y: number) => x + (y - x) * t;
  const near = t < 0.5 ? a : b;
  return { value: mix(a.value, b.value), low: mix(a.low, b.low), high: mix(a.high, b.high), odds: near.odds };
}
const pick = (p: FuturePoint) => ({ value: p.value, low: p.low, high: p.high, odds: p.odds });

/** Inverse standard normal CDF (Acklam), for evenly spread quantiles. */
function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = p < 0.5 ? Math.sqrt(-2 * Math.log(p)) : Math.sqrt(-2 * Math.log(1 - p));
  if (p < 0.02425 || p > 0.97575) {
    const x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    return p < 0.5 ? x : -x;
  }
  const r = (p - 0.5) * (p - 0.5);
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * (p - 0.5)) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** A small deterministic generator, so the same decision always draws the same filaments. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10_000) / 10_000; };
}

/**
 * Possible futures for the pictured option: `n` filaments at evenly spread quantiles of the engine's own spread
 * (its range is the middle half, so σ = half-width / 0.674), each wandering a little from step to step.
 */
function strands(steps: FuturePoint[], seed: string, n = 40): Strand[] {
  const rand = rng(seed);
  return Array.from({ length: n }, (_, k) => {
    const z = probit((k + 0.5) / n);
    let drift = 0;
    const values = steps.map((s) => {
      const sigma = (s.high - s.low) / 2 / 0.674;
      drift = drift * 0.6 + (rand() - 0.5) * 0.5;
      return s.value + (z + drift) * sigma;
    });
    const end = values[values.length - 1];
    return { values, tone: end >= CLEAR ? "well" : end <= -CLEAR ? "hard" : "mixed" };
  });
}

export function futuresFor(run: DecisionRun, optionId: string): Futures | null {
  const v = view(run);
  const signal = run.source === "ai" || Object.keys(run.duels).length > 0;
  const base = { options: v.options, factors: run.factors, mode: run.mode, stakes: run.stakes, safety: run.safety, signal };
  const picture = aftermath({ ...base, optionId });
  if (!picture || picture.steps.length === 0) return null;
  const paths: FuturePath[] = run.options.map((o) => {
    const a = o.id === optionId ? picture : aftermath({ ...base, optionId: o.id });
    return a ? { id: o.id, label: o.label, pictured: o.id === optionId, points: a.steps.map(point) } : null;
  }).filter((p): p is FuturePath => p !== null);
  const pictured = paths.find((p) => p.pictured)!;

  // Every moment any option pictures, so each path is read at the same times.
  const days = [...new Set(paths.flatMap((p) => p.points.map((x) => x.days)))].sort((a, b) => a - b);
  const moments: Moment[] = days.map((d) => {
    const own = pictured.points.find((p) => p.days === d) ?? paths.flatMap((p) => p.points).find((p) => p.days === d)!;
    const readings = paths.map((p) => { const r = at(p, d); return { id: p.id, label: p.label, ...r, score: toScore(r.value) }; })
      .sort((a, b) => b.value - a.value);
    return { days: d, when: own.when, checkIn: own.checkIn, far: own.far, readings, leaderId: readings[0].id, close: readings.length > 1 && readings[0].value - readings[1].value < LEVEL };
  });

  const last = moments[moments.length - 1];
  const [top, second] = last.readings;
  const winner = { id: top.id, label: top.label, margin: second ? top.value - second.value : Infinity, close: second ? top.value - second.value < LEVEL : false };

  // Where the lead last changes hands, ignoring moments where the options are level.
  let leadChange: Futures["leadChange"] = null;
  let prev: string | null = null;
  moments.forEach((m, i) => {
    if (m.close) return;
    if (prev && prev !== m.leaderId) leadChange = { index: i, fromId: prev, toId: m.leaderId };
    prev = m.leaderId;
  });

  return {
    picture, paths, moments, winner, leadChange,
    strands: strands(pictured.points, `${run.id}:${optionId}`),
    maxDays: Math.max(...days, 1),
  };
}
