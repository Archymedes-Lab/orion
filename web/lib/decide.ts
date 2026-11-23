// The decision pipeline for the web app, on the same engine as the Expo app (../src):
// read the question (/decision/parse), score every option × factor in one request (/decision/score-factors, Jev first),
// then let the deterministic engine rank them and word the call. Nothing here asks the person to rate anything; when
// the server can't score, the head-to-head duel (one tap per factor) fills in.
import { DecisionExtractionSchema } from "@orion/ai/schemas.ts";
import { parseLocally } from "@orion/ai/extractDecision.ts";
import { buildOptionsFromScores, weightsFromImportance } from "@orion/ai/model.ts";
import { scoreAll } from "@orion/decision-engine/uncertainty.ts";
import { makeTheCall, type TheCall } from "@orion/decision-engine/call.ts";
import { decisionMode, type DecisionMode } from "@orion/decision-engine/mode.ts";
import { classifySafety, isSupportPath, safetyNotice } from "@orion/decision-engine/safety.ts";
import { flipThresholds, impactOf } from "@orion/decision-engine/sensitivity.ts";
import { nudgedWeights } from "@orion/decision-engine/expectedValue.ts";
import { nextDuel, optionsFromDuels, type Duels } from "@orion/decision-engine/duel.ts";
import type { BusinessProfile } from "@orion/business/schema.ts";
import type { DecisionFactor, DecisionOption, SafetyClass, ScenarioScore, Stakes } from "@orion/types.ts";
import { t } from "@orion/i18n/index.ts";
import { api, ApiError } from "./api";
import type { CreativeData } from "./creative";
import type { PriorityData } from "./priorities";

export interface FactorScore { optionId: string; factorId: string; value: number; probabilityConfidence: number }

/** Everything needed to redraw a decision later; the ranking itself is always recomputed, never stored. */
export interface DecisionRun {
  id: string;
  createdAt: number;
  question: string;
  lens: "personal" | "business";
  title: string;
  category: string[];
  stakes: Stakes;
  safety: SafetyClass;
  mode: DecisionMode;
  /** How the scores were made: the model, the person's taps, or not yet. */
  source: "ai" | "duel" | "none";
  /** Why the server couldn't score, in words, when it couldn't. */
  notice: string | null;
  offline: boolean;
  /** `path`: a new path the person added from "New paths" (lib/creative.ts). */
  options: { id: string; label: string; generated?: boolean; path?: boolean }[];
  factors: (DecisionFactor & { reason?: string })[];
  scores: FactorScore[] | null;
  scenarios: ScenarioScore[] | null;
  duels: Duels;
  chosen: string | null;
  /** Beliefs behind "New paths", fetched when the person asks for them. */
  creative?: CreativeData | null;
  /** Ratings behind the business priority matrices, fetched when asked for. Dropped when the options change. */
  priorities?: PriorityData | null;
  /** Kept at the top of the rail and history. */
  pinned?: boolean;
  /** The person's own words about this decision, edited from history. */
  note?: string;
  /** Last time the person edited the title, note or choice by hand. */
  editedAt?: number;
  /** Things the person told ORION it didn't know ("See it differently?"); they go into the scoring context. */
  facts?: string[];
  /** When the person made their choice; check-ins are timed from here. */
  chosenAt?: number;
  /** How it turned out, recorded at the check-ins (or whenever the person likes). */
  outcomes?: Outcome[];
  /** Each option's realistic worst case and whether it can be undone, judged when the person asks. */
  downside?: Downside[] | null;
  /** The friends' poll for this decision; the owner key is what lets this browser read the answers. */
  share?: { id: string; ownerKey: string; expiresAt: string } | null;
}

export interface Outcome { at: number; result: "better" | "as_expected" | "worse"; again: "yes" | "unsure" | "no"; note?: string }
/** `worst`: 0 (hardly any downside) .. 4 (severe, hard to recover). `reversible`: probability it can be undone cheaply. */
export interface Downside { optionId: string; worst: number; reversible: number }

export interface Ranked { id: string; label: string; jev: number; low: number; high: number; confidence: number; generated?: boolean }
export interface Driver { id: string; label: string; weight: number; impact: number }
export interface View {
  options: DecisionOption[];
  ranked: Ranked[];
  call: TheCall | null;
  drivers: Driver[];
  /** The head-to-head question still open, when scores came from taps. */
  duel: { factor: DecisionFactor; settled: false } | null;
  support: string | null;
  caution: string | null;
}

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 12);

/** Phase 1: read the question. Falls back to the on-device reader when the server is unreachable. */
export async function read(question: string, lens: "personal" | "business", company: BusinessProfile, signal?: AbortSignal) {
  const business = lens === "business" ? company : undefined;
  try {
    const json = await api<Record<string, unknown>>("decision/parse", { input: question, business }, { signal });
    const { safety, fallback, ...rest } = json;
    return {
      extraction: DecisionExtractionSchema.parse(rest),
      safety: (typeof safety === "string" ? safety : classifySafety(question)) as SafetyClass,
      offline: fallback === true,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if ((error as Error).name === "AbortError") throw error;
    return { extraction: parseLocally(question, lens === "business"), safety: classifySafety(question), offline: true };
  }
}

/** Phase 2: one request scores every option × factor. Null scores mean "ask the person instead". */
/** The question plus what the person added. Only facts go in: never which answer they would prefer. */
export function withFacts(run: Pick<DecisionRun, "question" | "facts">) {
  const facts = (run.facts ?? []).filter(Boolean);
  return facts.length ? `${run.question}\n\n${t("More about the situation:")}\n${facts.map((f) => `- ${f}`).join("\n")}` : run.question;
}

export async function score(run: Pick<DecisionRun, "options" | "factors" | "question" | "stakes" | "lens" | "facts">, company: BusinessProfile, signal?: AbortSignal) {
  try {
    const json = await api<{ scores?: FactorScore[]; scenarios?: ScenarioScore[] | null }>("decision/score-factors", {
      context: withFacts(run).slice(0, 4000),
      stakes: run.stakes,
      options: run.options.map(({ id, label }) => ({ id, label })),
      factors: run.factors.map(({ id, label }) => ({ id, label: label.slice(0, 40) })),
      business: run.lens === "business" ? company : undefined,
    }, { signal });
    const complete = Array.isArray(json.scores) && run.options.every((o) => run.factors.every((f) => json.scores!.some((s) => s.optionId === o.id && s.factorId === f.id)));
    return { scores: complete ? json.scores! : null, scenarios: Array.isArray(json.scenarios) ? json.scenarios : null, notice: complete ? null : t("ORION couldn’t score every pair, so it will ask you a few quick questions.") };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if ((error as Error).name === "AbortError") throw error;
    const notice = error instanceof ApiError && error.status === 402
      ? t("Today’s free scored decisions are used up, so ORION will ask you a few quick questions instead.")
      : t("ORION’s scoring is unavailable right now, so it will ask you a few quick questions instead.");
    return { scores: null, scenarios: null, notice };
  }
}

export async function decide(question: string, lens: "personal" | "business", company: BusinessProfile, onStage: (stage: "reading" | "scoring", preview?: string[]) => void, signal?: AbortSignal): Promise<DecisionRun> {
  onStage("reading");
  const { extraction, safety, offline } = await read(question, lens, company, signal);
  const factors = weightsFromImportance(extraction.factors).map((f) => ({ ...f, reason: extraction.factors.find((x) => x.id === f.id)?.reason }));
  const base: DecisionRun = {
    id: uid(), createdAt: Date.now(), question, lens,
    title: extraction.title, category: extraction.category, stakes: extraction.stakes, safety,
    mode: decisionMode({ text: question, stakes: extraction.stakes, safety }),
    source: "none", notice: null, offline,
    options: extraction.options.map(({ id, label, generated }) => ({ id, label, generated })),
    factors, scores: null, scenarios: null, duels: {}, chosen: null,
  };
  if (isSupportPath(safety)) return base;
  onStage("scoring", base.options.map((o) => o.label));
  const scored = await score(base, company, signal);
  return { ...base, scores: scored.scores, scenarios: scored.scenarios, source: scored.scores ? "ai" : "duel", notice: scored.notice };
}

/** Recompute everything shown from a stored run: ranking, the call, and what drives it. */
export function view(run: DecisionRun, flips = 0): View {
  const support = isSupportPath(run.safety) ? safetyNotice(run.safety) : null;
  const caution = support ? null : safetyNotice(run.safety);
  const shells: DecisionOption[] = run.options.map((o) => ({ id: o.id, label: o.label, reversibility: 0.6, outcomes: [] }));
  let options: DecisionOption[];
  let duel: View["duel"] = null;
  if (run.source === "ai" && run.scores) {
    options = buildOptionsFromScores(run.options, run.factors, run.scores, { scenarios: run.scenarios });
  } else {
    options = optionsFromDuels(shells, run.factors, run.duels);
    const next = nextDuel(options, run.factors, run.duels, run.stakes);
    if (next.factor && !next.settled) duel = { factor: next.factor, settled: false };
  }
  const signal = run.source === "ai" ? true : Object.keys(run.duels).length > 0;
  const scored = signal ? scoreAll(options, run.factors) : [];
  const ranked: Ranked[] = run.options.map((o) => {
    const s = scored.find((x) => x.optionId === o.id);
    return { id: o.id, label: o.label, generated: o.generated, jev: s?.jev ?? 0, low: s?.low ?? 0, high: s?.high ?? 0, confidence: s?.confidence ?? 0 };
  }).sort((a, b) => b.jev - a.jev);

  const [lead, runner] = ranked;
  const leadOpt = options.find((o) => o.id === lead?.id);
  const runOpt = options.find((o) => o.id === runner?.id);
  const drivers: Driver[] = leadOpt && runOpt
    ? run.factors.map((f) => ({ id: f.id, label: f.label, weight: f.weight, impact: f.weight * (impactOf(leadOpt, f.id) - impactOf(runOpt, f.id)) }))
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    : [];
  const call = support || duel ? null : makeTheCall({ options, factors: run.factors, mode: run.mode, signal, seed: `${run.id}:${flips}`, drivers });
  return { options, ranked, call, drivers, duel, support, caution };
}

export const nudge = (run: DecisionRun, factorId: string, direction: "more" | "less"): DecisionRun => ({
  ...run,
  factors: nudgedWeights(run.factors, factorId, direction).map((f) => ({ ...f, reason: run.factors.find((x) => x.id === f.id)?.reason })),
});

export interface Changer {
  runner: string;
  /** A factor that, mattering more to the person, would hand the lead to the runner-up. */
  byWeight: string | null;
  /** The factor where the smallest change in the runner-up's score would flip the call, and how big that change is. */
  byFact: { factor: string; size: "small" | "clear" | "large" } | null;
}

/**
 * What would change the call, in words a person can act on: a factor that would have to matter more to them, or a
 * factor where the runner-up would have to be better than ORION estimates. Null when there is no call to change.
 */
export function changers(run: DecisionRun, v: View): Changer | null {
  const [lead, runner] = v.ranked;
  if (!v.call || !lead || !runner) return null;
  const leadOpt = v.options.find((o) => o.id === lead.id), runOpt = v.options.find((o) => o.id === runner.id);
  if (!leadOpt || !runOpt) return null;
  // Raising one factor's weight up to three steps: the first that hands the lead over.
  let byWeight: string | null = null;
  const helps = run.factors.filter((f) => impactOf(runOpt, f.id) > impactOf(leadOpt, f.id)).sort((a, b) =>
    (impactOf(runOpt, b.id) - impactOf(leadOpt, b.id)) - (impactOf(runOpt, a.id) - impactOf(leadOpt, a.id)));
  for (const f of helps) {
    let next = run;
    for (let i = 0; i < 3 && !byWeight; i++) {
      next = nudge(next, f.id, "more");
      const top = view(next).ranked[0];
      if (top && top.id === runner.id) byWeight = f.label;
    }
    if (byWeight) break;
  }
  const gap = Math.max(0, lead.jev - runner.jev);
  const first = flipThresholds(leadOpt, runOpt, run.factors, gap).find((x) => x.reachable);
  const byFact = first ? { factor: first.label, size: first.deltaNeeded <= 2.5 ? "small" as const : first.deltaNeeded <= 6 ? "clear" as const : "large" as const } : null;
  return { runner: runner.label, byWeight, byFact };
}

/** Score shown to people: -10..+10 model units mapped to 0..100. */
export const toScore = (jev: number) => Math.round(((jev + 10) / 20) * 100);
export const toUnit = (jev: number) => Math.max(0, Math.min(1, (jev + 10) / 20));
