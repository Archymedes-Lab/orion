// Choosing against the comparison ("irrational" choices), made measurable.
//
// A choice is only "against the comparison" when the option picked is not the leader AND the gap is larger than
// the estimates' own uncertainty. For such a choice three numbers say what is going on:
//   gap        what the choice costs, in JEV points (leader minus chosen);
//   certainty  the gap divided by the two options' combined uncertainty: how sure the comparison is;
//   implied    the smallest change to one factor's weight that would put the chosen option first, i.e. what
//              the person must care about, and how much, for the choice to be the rational one.
// When no weighting of the listed factors can do that, the explanation lies outside the model: something
// unlisted is worth at least `gap` points to the person, or they do not believe the scores.
//
// Nothing here judges the person. People choose against the numbers for good reasons the numbers missed; the
// point is to show the price and find out what was missing.
import type { DecisionFactor, DecisionOption } from "../types.ts";
import { normalizeProbabilities, normalizeWeights } from "./expectedValue.ts";

export type DivergenceLevel =
  /** No choice yet, a single option, or no scores to compare with. */
  | "none"
  /** The chosen option is the leader (or tied for it). */
  | "aligned"
  /** Not the leader, but too close for the estimates to tell apart. */
  | "tossup"
  /** Clearly not the leader. */
  | "against"
  /** Not the leader by a wide, confident margin. */
  | "strongly_against";

export interface ImpliedPriority {
  factorId: string;
  label: string;
  /** The factor's current share of the decision, 0–1. */
  from: number;
  /** The share at which the chosen option becomes the leader, 0–1. */
  to: number;
}

export interface Divergence {
  level: DivergenceLevel;
  chosenId: string | null;
  leaderId: string | null;
  /** The chosen option shares first place with another: there was no leader to follow or go against. */
  tied: boolean;
  /** JEV points given up by not choosing the leader. 0 when aligned. */
  gap: number;
  /** gap ÷ combined uncertainty of the two options. Around 1 the likely ranges stop overlapping. */
  certainty: number;
  /** The leader is at least as good on every factor: no weighting of the listed factors favours the choice. */
  dominated: boolean;
  /** The cheapest single-factor reweighting that makes the choice the leader; null when there is none. */
  implied: ImpliedPriority | null;
}

/** Below this the two options are within the noise of the estimates. */
export const TOSSUP_CERTAINTY = 0.5;
/** A gap this small is a toss-up however confident the estimates claim to be. */
export const TOSSUP_GAP = 0.75;
export const STRONG_CERTAINTY = 1.25;
export const STRONG_GAP = 2;
/** Extra weight beyond the exact tie point, so the reweighted choice leads rather than ties. */
const MARGIN = 0.02;

const NONE: Divergence = { level: "none", chosenId: null, leaderId: null, tied: false, gap: 0, certainty: 0, dominated: false, implied: null };

/** Expected value of each option on each factor: values[optionIndex][factorIndex]. */
function valueMatrix(options: DecisionOption[], factors: DecisionFactor[]): number[][] {
  return options.map((option) => {
    const outcomes = normalizeProbabilities(option.outcomes);
    return factors.map((factor) => outcomes.reduce((sum, outcome) => sum + outcome.probability * (outcome.factors.find((v) => v.factorId === factor.id)?.value ?? 0), 0));
  });
}

/**
 * How a choice sits against the comparison.
 * `chosenId` null, fewer than two options, or `hasSignal` false (nothing was scored) all give level "none".
 */
export function divergence(options: DecisionOption[], factorsIn: DecisionFactor[], chosenId: string | null, hasSignal = true): Divergence {
  const chosen = options.findIndex((o) => o.id === chosenId);
  if (chosen < 0 || options.length < 2 || factorsIn.length === 0 || !hasSignal) return NONE;
  const factors = normalizeWeights(factorsIn);
  const weights = factors.map((f) => f.weight);
  const values = valueMatrix(options, factors);
  const utility = values.map((row) => row.reduce((sum, v, f) => sum + v * weights[f], 0));
  const leader = utility.reduce((best, u, i) => (u > utility[best] + 1e-9 ? i : best), 0);
  const gap = utility[leader] - utility[chosen];
  const base = { chosenId: options[chosen].id, leaderId: options[leader].id };
  if (gap <= 1e-9) {
    const tied = utility.some((u, i) => i !== chosen && Math.abs(u - utility[chosen]) <= 1e-9);
    return { ...NONE, ...base, leaderId: options[chosen].id, level: "aligned", tied };
  }

  // Same noise model as uncertaintyBand: low confidence widens the band, and
  // more outcome branches add spread. Half the full band width, per option.
  const half = (index: number) => {
    const outs = normalizeProbabilities(options[index].outcomes);
    const avgConf = outs.reduce((a, o) => a + o.probability * o.probabilityConfidence, 0);
    return (1 - avgConf) * (4 + Math.min(2, outs.length * 0.4));
  };
  const noise = Math.hypot(half(leader), half(chosen));
  const certainty = noise > 0 ? gap / noise : Number.POSITIVE_INFINITY;
  const dominated = values[leader].every((v, f) => v >= values[chosen][f] - 1e-9);
  const level: DivergenceLevel = certainty < TOSSUP_CERTAINTY || gap < TOSSUP_GAP ? "tossup"
    : certainty >= STRONG_CERTAINTY && gap >= STRONG_GAP ? "strongly_against" : "against";

  return {
    ...base, tied: false, level, gap: round(gap), certainty: round(Math.min(certainty, 99)), dominated,
    implied: impliedPriority(factors, values, utility, chosen),
  };
}

/**
 * For each factor: move its weight to t and scale the others to fill the rest, keeping their proportions.
 * The chosen option's lead over each rival is then linear in t, so the range of t where it leads everyone is an
 * interval. The answer is the factor whose interval lies closest to its current weight.
 */
function impliedPriority(factors: DecisionFactor[], values: number[][], utility: number[], chosen: number): ImpliedPriority | null {
  let best: ImpliedPriority | null = null;
  factors.forEach((factor, f) => {
    const w = factor.weight;
    if (w >= 1 - 1e-9) return; // the only factor that counts: there is nothing to trade it against
    // rest[o]: the option's utility from all other factors, as if they made up the whole decision.
    const rest = utility.map((u, o) => (u - w * values[o][f]) / (1 - w));
    let low = 0, high = 1;
    const leads: ((t: number) => number)[] = [];
    for (let o = 0; o < values.length && low <= high; o++) {
      if (o === chosen) continue;
      const onFactor = values[chosen][f] - values[o][f];
      const onRest = rest[chosen] - rest[o];
      leads.push((t) => onRest + t * (onFactor - onRest));
      // lead(t) = onRest + t × (onFactor − onRest) must be ≥ 0
      const slope = onFactor - onRest;
      // This factor does not separate the two: the chosen option must already be strictly ahead of this rival.
      if (Math.abs(slope) < 1e-9) { if (onRest <= 1e-9) low = 2; continue; }
      const tie = -onRest / slope;
      if (slope > 0) low = Math.max(low, tie); else high = Math.min(high, tie);
    }
    if (low > high) return;
    // The nearest point of [low, high] to the current weight, nudged inside so the choice leads rather than ties.
    const to = w < low ? Math.min(1, low + MARGIN) : Math.max(0, high - MARGIN);
    if (to < low - 1e-9 || to > high + 1e-9) return;
    // At that weight the choice must be strictly ahead of everyone. A factor on which the options are equal can
    // only ever bring them level, and "it would tie" is not a reason to prefer it.
    if (leads.some((lead) => lead(to) <= 1e-9)) return;
    if (!best || Math.abs(to - w) < Math.abs(best.to - best.from)) best = { factorId: factor.id, label: factor.label, from: w, to };
  });
  return best;
}

/** The factor weights after taking the implied priority at its word. Weights still sum to 1. */
export function applyImpliedPriority(factorsIn: DecisionFactor[], implied: ImpliedPriority): DecisionFactor[] {
  const factors = normalizeWeights(factorsIn);
  const current = factors.find((f) => f.id === implied.factorId)?.weight;
  if (current === undefined || current >= 1) return factors;
  const scale = (1 - implied.to) / (1 - current);
  return factors.map((f) => ({ ...f, weight: f.id === implied.factorId ? implied.to : f.weight * scale }));
}

const round = (n: number) => Math.round(n * 100) / 100;
