// ORION's call: one plain sentence that says what to do, sized to the decision.
//
// The engine still decides who leads; this only words it decisively. Three cases:
//   clear  the leader is ahead by more than the estimates' own uncertainty: "Go with X."
//   lean   it leads, but within the noise: still a pick, honestly labelled as close.
//   coin   no signal or a dead tie. For a fun or everyday choice ORION flips a coin and says that it did; the old
//          trick applies (if the result disappoints you, you wanted the other one). A serious decision is never
//          settled by a coin: the call is null and the full comparison carries on.
import { listPhrase, t } from "../i18n/index.ts";
import type { DecisionFactor, DecisionOption } from "../types.ts";
import type { DecisionMode } from "./mode.ts";
import { scoreAll } from "./uncertainty.ts";

export type CallKind = "clear" | "lean" | "coin";

export interface TheCall {
  kind: CallKind;
  optionId: string;
  label: string;
  /** "Go with X." */
  headline: string;
  /** Why, in one or two short sentences. */
  line: string;
}

/** Small deterministic hash, so the same decision and flip number always land the same way. */
export function seededIndex(seed: string, size: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return size > 0 ? (h >>> 0) % size : 0;
}

const pickOne = <T,>(items: T[], seed: string): T => items[seededIndex(seed, items.length)];

const CLEAR_PLAYFUL = [
  (x: string, why: string) => t("{why}. {x} it is — enjoy.", { why, x }),
  (_x: string, why: string) => t("{why}, and you can always have the other one next time.", { why }),
  (_x: string, why: string) => t("{why}. Done deciding — go have fun.", { why }),
];
const LEAN_PLAYFUL = [
  (x: string) => t("Honestly close, but {x} edges it. Don't overthink a fun one.", { x }),
  (x: string) => t("{x} by a nose. Either would be fine — this one's slightly better.", { x }),
];
const COIN = [
  (x: string) => t("No real difference between them, so ORION flipped a coin: {x}. If that made your heart sink a little, you wanted the other one — go with that.", { x }),
  (x: string) => t("It's a genuine toss-up, so here's a coin flip: {x}. Notice how that lands — your gut reaction is the real answer.", { x }),
];

export function makeTheCall(input: {
  options: DecisionOption[];
  factors: DecisionFactor[];
  mode: DecisionMode;
  /** False when nothing has been scored yet. */
  signal: boolean;
  /** Decision id plus flip count: re-flipping changes the coin, rerendering does not. */
  seed: string;
  /** Factors behind the lead, strongest first (from `sensitivity`). */
  drivers?: { label: string; impact: number }[];
}): TheCall | null {
  const { options, factors, mode, signal, seed } = input;
  if (options.length < 2) return null;
  const scored = signal ? scoreAll(options, factors).sort((a, b) => b.jev - a.jev) : [];
  const tied = scored.length > 1 && scored[0].jev === scored[1].jev;
  const labelOf = (id: string) => options.find((o) => o.id === id)?.label ?? "";

  if (!signal || tied) {
    if (mode === "serious") return null;
    // Flip only among the options that share the top score, or all of them when nothing is scored.
    const pool = tied ? scored.filter((s) => s.jev === scored[0].jev).map((s) => s.optionId) : options.map((o) => o.id);
    const optionId = pickOne(pool, seed);
    const label = labelOf(optionId);
    return { kind: "coin", optionId, label, headline: t("Go with {label}.", { label }), line: pickOne(COIN, seed)(label) };
  }

  const [top, runner] = scored;
  const label = labelOf(top.optionId);
  const gap = top.jev - runner.jev;
  // Same noise model as the divergence check: half-ranges combined in quadrature.
  const noise = Math.sqrt(((top.high - top.low) / 2) ** 2 + ((runner.high - runner.low) / 2) ** 2);
  const close = gap < 0.75 || (noise > 0 && gap / noise < 0.5);
  const drivers = (input.drivers ?? []).filter((d) => d.impact > 0).slice(0, 2).map((d) => d.label.toLowerCase());
  const why = drivers.length ? t("It wins on {factors}", { factors: listPhrase(drivers) }) : t("It comes out ahead on what you weighed");

  if (close) {
    const line = mode === "playful"
      ? pickOne(LEAN_PLAYFUL, seed)(label)
      : mode === "everyday"
        ? t("Too close to matter much. Lean {label} and don't lose sleep over it.", { label })
        : t("Too close to call from these estimates. {label} leads slightly — check the best thing to learn below before you commit.", { label });
    return { kind: "lean", optionId: top.optionId, label, headline: mode === "serious" ? t("Leaning {label}.", { label }) : t("Go with {label}.", { label }), line };
  }
  const line = mode === "playful"
    ? pickOne(CLEAR_PLAYFUL, seed)(label, why)
    : mode === "everyday"
      ? t("{why}. It's a small, easy-to-undo choice — go.", { why })
      : t("{why}, by more than the estimates' own uncertainty. Sleep on it if you can; ORION will check in after you decide.", { why });
  return { kind: "clear", optionId: top.optionId, label, headline: t("Go with {label}.", { label }), line };
}
