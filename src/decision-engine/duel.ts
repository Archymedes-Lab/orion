// Head-to-head answers: for one factor the user names the option that does best (or "about equal").
// JEV turns those taps into scores and decides when asking more could no longer change the leader.
import type { DecisionFactor, DecisionOption, Stakes } from "../types.ts";
import type { FactorScore } from "../ai/client.ts";
import { buildOptionsFromScores } from "../ai/model.ts";
import { scoreAll } from "./uncertainty.ts";
import { shouldStop } from "./stoppingRule.ts";

/** factorId → option that does best on it; null = about equal. */
export type Duels = Record<string, string | null>;

/** Impact given to the option that wins a factor; the others stay at 0 ("no better"). */
export const DUEL_WIN = 5;
const DUEL_CONFIDENCE = 0.7;
const MAX_DUELS = 4;

/** Scores for the factors answered so far; unanswered pairs are left out so they stay neutral. */
export function duelScores(options: { id: string }[], duels: Duels): FactorScore[] {
  return Object.entries(duels).flatMap(([factorId, winner]) =>
    options.map((o) => ({ optionId: o.id, factorId, value: winner === o.id ? DUEL_WIN : 0, probabilityConfidence: DUEL_CONFIDENCE }))
  );
}

export function optionsFromDuels(options: DecisionOption[], factors: DecisionFactor[], duels: Duels): DecisionOption[] {
  return buildOptionsFromScores(options, factors, duelScores(options, duels)).map((o) => ({
    ...o,
    reversibility: options.find((old) => old.id === o.id)?.reversibility ?? o.reversibility,
  }));
}

/**
 * The next factor worth a tap, most important first, or null when JEV says to stop:
 * every factor answered, the usual stopping rule fires, or what is left to ask is
 * worth too little to overturn the lead.
 */
export function nextDuel(
  options: DecisionOption[],
  factors: DecisionFactor[],
  duels: Duels,
  stakes: Stakes
): { factor: DecisionFactor | null; gap: number; settled: boolean } {
  const remaining = factors.filter((f) => !(f.id in duels)).sort((a, b) => b.weight - a.weight);
  const answered = Object.keys(duels).length;
  if (remaining.length === 0) return { factor: null, gap: gapOf(options, factors, duels), settled: true };
  if (answered === 0) return { factor: remaining[0], gap: 0, settled: false };

  const gap = gapOf(options, factors, duels);
  // The most the unanswered factors could move one option relative to another.
  const swing = remaining.reduce((sum, f) => sum + f.weight * DUEL_WIN, 0);
  const stop = shouldStop({
    gap,
    stakes,
    reversibility: 0.6,
    questionsAsked: answered,
    maxQuestions: Math.min(factors.length, MAX_DUELS),
  }).stop;
  if (stop || gap > swing) return { factor: null, gap, settled: true };
  return { factor: remaining[0], gap, settled: false };
}

function gapOf(options: DecisionOption[], factors: DecisionFactor[], duels: Duels): number {
  if (options.length < 2) return 0;
  const [top, runner] = scoreAll(optionsFromDuels(options, factors, duels), factors).sort((a, b) => b.jev - a.jev);
  return top.jev - runner.jev;
}
