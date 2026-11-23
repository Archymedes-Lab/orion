// Calibration: checking the aftermath's odds against how decisions really turned out, and correcting the spread.
//
// Each rated decision is one observation: the odds the aftermath gives for the chosen option at the moment nearest
// to when it was rated, and which of the three zones the rating fell in. One number is fitted, `spread`, which
// widens (above 1) or narrows every range and so moves odds between "mixed" and the two clear outcomes.
//
// This is the one place outcomes feed back, and only into the width of the aftermath's ranges, never the verdict or
// any score. Unlike calibration.ts, which only reports bias, it is applied, so the UI must say when it is in use
// and how many outcomes it rests on (see `n`).
//
// With only a few outcomes the data cannot say much, so the fit is a maximum a-posteriori estimate under a
// log-normal prior centred on 1 (log spread ~ N(0, 0.3²)): a handful of ratings nudges it, dozens move it. It is
// bounded to [0.5, 2], and is reported with the Brier score before and after, so the gain can be seen, not assumed.

/** Ratings as recorded in History and check-ins. */
export const RATING_ZONE: Record<string, Zone> = { Great: "well", Good: "well", Neutral: "mixed", Bad: "hard", "Very bad": "hard" };
export type Zone = "well" | "mixed" | "hard";
export type Odds = { well: number; mixed: number; hard: number };

export interface Observation {
  /** The aftermath's odds at this spread, for the moment nearest the rating; null when there is no picture. */
  predict: (spread: number) => Odds | null;
  zone: Zone;
}

export interface Calibration {
  spread: number;
  /** Observations that had a picture to check against. */
  n: number;
  /** Mean Brier score at spread 1 and at the fitted spread (0 is perfect, 2 is always wrong). */
  brierBefore: number | null;
  brierAfter: number | null;
}

const PRIOR_SD = 0.3;
const FLOOR = 0.02;
const GRID = Array.from({ length: 49 }, (_, i) => Math.exp(Math.log(0.5) + (i / 48) * (Math.log(2) - Math.log(0.5))));

const brier = (odds: Odds, zone: Zone) =>
  (["well", "mixed", "hard"] as const).reduce((sum, z) => sum + (odds[z] - (z === zone ? 1 : 0)) ** 2, 0);

export function calibrate(observations: Observation[]): Calibration {
  const usable = observations.filter((o) => o.predict(1) !== null);
  if (usable.length === 0) return { spread: 1, n: 0, brierBefore: null, brierAfter: null };
  let best = 1;
  let bestScore = -Infinity;
  for (const k of GRID) {
    const prior = -((Math.log(k) / PRIOR_SD) ** 2) / 2;
    const fit = usable.reduce((sum, o) => sum + Math.log(Math.max(FLOOR, o.predict(k)![o.zone])), 0);
    if (prior + fit > bestScore) { bestScore = prior + fit; best = k; }
  }
  const mean = (k: number) => usable.reduce((sum, o) => sum + brier(o.predict(k)!, o.zone), 0) / usable.length;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { spread: round(best), n: usable.length, brierBefore: round(mean(1)), brierAfter: round(mean(best)) };
}
