// Session state (Zustand). SQLite is source of truth; this is ephemeral UI flow:
// input -> parse -> scores -> 0-3 questions -> scored result -> commit.
import { create } from "zustand";
import type { DecisionExtractionValidated } from "../ai/schemas.ts";
import { generateQuestions } from "../ai/generateQuestions.ts";
import { apiEnabled, fetchFactorScores, parseDecision, triageCandidates } from "../ai/client.ts";
import {
  applyAnswerToWeights,
  applyLearnedPriors,
  buildOptionsFromScores,
  weightsFromImportance,
} from "../ai/model.ts";
import { getAffinities, getFacts, recordAffinity } from "../db/preferences.ts";
import { optionsFromDuels, type Duels } from "../decision-engine/duel.ts";
import { uid } from "../decision-engine/normalize.ts";
import { expectedUtility, nudgedWeights } from "../decision-engine/expectedValue.ts";
import { db } from "../db/database.ts";
import { deleteDecision } from "../db/decisions.ts";
import { useAccount } from "../account/store.ts";
import type { DecisionFactor, DecisionOption, SafetyClass, ScenarioScore } from "../types.ts";
import { modelFromRows } from "../db/model.ts";
import type { FactorScore } from "../ai/client.ts";
import { classifySafety } from "../decision-engine/safety.ts";
import { applyImpliedPriority, divergence } from "../decision-engine/divergence.ts";
import { decisionMode, isMode, questionBudgetForMode, readIntent, type DecisionMode, type IntentReading } from "../decision-engine/mode.ts";
import { followUpPlan } from "../decision-engine/followUp.ts";
import { aftermath, withSigns } from "../decision-engine/aftermath.ts";
import { scoreAll } from "../decision-engine/uncertainty.ts";
import { detectDecisionMode } from "../decision-engine/decisionModes.ts";
import { createDecisionRecord } from "../decision-engine/checkIns.ts";
import { saveDecisionRecord } from "../db/decisionRecords.ts";
import { templateById, templateOptions } from "../decision-engine/templates.ts";
import { writeFollowUps } from "../db/followups.ts";
import { LOCALES, t, tIn } from "../i18n/index.ts";

/** What the person says is behind a choice that goes against the comparison. */
export type ChoiceReason = "priority" | "missing" | "scores" | "deliberate";

export type SessionStatus = "idle" | "clarify" | "loading" | "ready" | "error";

export interface SessionState {
  status: SessionStatus;
  /** What `submit` is doing while status is "loading". */
  stage: "reading" | "scoring" | "questions";
  /** The options ORION found, shown while it scores them, and whether it had to suggest them itself. */
  preview: { options: string[]; suggested: boolean } | null;
  /** Text put back in the input when the person chooses to reword their question. */
  draft: string;
  decisionId: string | null;
  rawInput: string;
  extraction: DecisionExtractionValidated | null;
  safety: SafetyClass;
  /** How much ceremony this decision gets: a quick call, a question or two, or the full comparison. */
  mode: DecisionMode;
  /** Set while status is "clarify": the input did not read as a decision. */
  clarify: IntentReading | null;
  /** Coin flips asked for on this decision; changes the coin's seed. */
  flips: number;
  offline: boolean;
  scoringSource: "none" | "manual" | "api";
  scenarioNotice: string | null;
  factors: DecisionFactor[];
  options: DecisionOption[];
  answers: Record<string, string | null>;
  /** factorId → option that does best on it (null = about equal); JEV scores these. */
  duels: Duels;
  questions: { question: string; expectedInformationGain: number }[];
  committedOptionId: string | null;
  /** Why the person chose against the comparison, once they have said. */
  choiceReason: ChoiceReason | null;
  error: string | null;
  privateMode: boolean;
  saving: boolean;
  saved: boolean;
  setManualScores: (scores: FactorScore[], scenarios?: ScenarioScore[]) => boolean;
  /** `force` skips the "is this a decision?" check, after the person says it is one. */
  submit: (input: string, force?: boolean) => Promise<void>;
  /** Starts from a template: the person names the options, the template brings the factors. */
  startTemplate: (templateId: string, optionNames: string[], details?: string) => Promise<boolean>;
  /** Flips the coin again for a toss-up. */
  flip: () => void;
  answer: (question: string, factorId: string | null) => void;
  /**
   * "This matters more / less to me" from the result screen. Changes one factor's weight and renormalises, so the
   * comparison re-ranks live. Nothing is remembered as a preference: it is a what-if until the person decides.
   */
  nudgeWeight: (factorId: string, direction: "more" | "less") => void;
  duel: (factorId: string, optionId: string | null) => void;
  undoDuel: () => void;
  commit: (optionId: string | null) => Promise<void>;
  loadDecision: (id: string) => Promise<boolean>;
  /**
   * Records what is behind a choice that goes against the comparison. "priority" takes the person at their word:
   * the factor the choice implies they care about gets that weight, and ORION remembers it.
   */
  explainChoice: (reason: ChoiceReason) => Promise<void>;
  /**
   * Re-runs the comparison with the options and factors the person corrected. ORION's reading of a question
   * is a guess, most of all when the question is vague; this is how the person puts it right.
   */
  refine: (options: string[], factors: string[]) => Promise<boolean>;
  /** Back to the input with the current question in it, ready to reword. */
  editQuestion: () => void;
  togglePrivate: () => void;
  reset: () => void;
}

const empty = {
  status: "idle" as SessionStatus,
  stage: "reading" as SessionState["stage"],
  preview: null as SessionState["preview"],
  draft: "",
  decisionId: null as string | null,
  rawInput: "",
  extraction: null as DecisionExtractionValidated | null,
  safety: "normal" as SafetyClass,
  mode: "everyday" as DecisionMode,
  clarify: null as IntentReading | null,
  flips: 0,
  offline: false,
  scoringSource: "none" as SessionState["scoringSource"],
  scenarioNotice: null as string | null,
  factors: [] as DecisionFactor[],
  options: [] as DecisionOption[],
  answers: {} as Record<string, string | null>,
  duels: {} as Duels,
  questions: [] as { question: string; expectedInformationGain: number }[],
  committedOptionId: null as string | null,
  choiceReason: null as ChoiceReason | null,
  error: null as string | null,
  saving: false,
  saved: false,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The question followed by what the person told ORION about themselves, within the server's 4000-character limit. */
export function withPersonalContext(question: string, facts: string[]): string {
  const lines = facts.map((f) => f.trim()).filter(Boolean);
  if (lines.length === 0) return question;
  return `${question}\n\nAbout the person deciding: ${lines.join("; ")}`.slice(0, 4000);
}

let requestVersion = 0;


function validateScenarios(
  scenarios: ScenarioScore[],
  options: DecisionOption[],
  factors: DecisionFactor[]
): boolean {
  if (scenarios.length === 0) return false;
  const optionIds = new Set(options.map((o) => o.id));
  const factorIds = new Set(factors.map((f) => f.id));
  const inUnit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  const inRange = (n: number) => Number.isFinite(n) && n >= -10 && n <= 10;
  for (const s of scenarios) {
    if (!optionIds.has(s.optionId)) return false;
    if (typeof s.label !== "string" || s.label.trim() === "") return false;
    if (!inUnit(s.probability) || !inUnit(s.probabilityConfidence)) return false;
    const keys = Object.keys(s.values ?? {});
    if (keys.length === 0) return false;
    for (const k of keys) {
      if (!factorIds.has(k) || !inRange(s.values[k])) return false;
    }
  }
  return options.every((o) => scenarios.some((s) => s.optionId === o.id));
}

type Setter = (partial: Partial<SessionState>) => void;
let setState: Setter = () => {};

/** The local parser's fallback when a question names no options. Ask for them instead of comparing "do it / don't". */
// The parser writes the pair in the question's language, so the pair is recognised in every language ORION speaks.
export function isGenericFallback(options: { label: string }[]): boolean {
  return options.length === 2 && LOCALES.some(({ id }) => options[0].label === tIn(id, "Do it") && options[1].label === tIn(id, "Don't do it"));
}

/**
 * Scoring and triage both need only the parsed decision, so they run side by side and the result waits for the slower
 * one. `onScored` fires when the scores are in, so the screen can say what it is still waiting for. Triage falling
 * over must not lose the scores: it falls back to `fallback`, the same order the candidates came in.
 */
export async function scoreAndTriage<B, K>(
  run: { score: () => Promise<B>; triage: () => Promise<K>; fallback: K }, onScored?: () => void
): Promise<{ batch: B; kept: K }> {
  let triage: Promise<K>;
  try { triage = run.triage().catch(() => run.fallback); } catch { triage = Promise.resolve(run.fallback); }
  const batch = await run.score();
  onScored?.();
  return { batch, kept: await triage };
}

/** Parse → scores and questions side by side, shared by a typed question and a template. Crisis input stops at the support path. */
async function analyse(
  version: number, text: string, extraction: DecisionExtractionValidated, safety: SafetyClass, offline: boolean, mode: DecisionMode
): Promise<void> {
  const set = setState;
  if (safety === "crisis" || safety === "dangerous") {
    set({ status: "ready", decisionId: uid("dec"), extraction, safety, offline, mode: "serious" });
    return;
  }
  // What ORION understood goes on screen now, while it compares; the rest arrives as each call returns.
  // The generic fallback is not something ORION "found": keep the skeletons until the person names the options.
  set({
    stage: "scoring", extraction, safety, mode, offline,
    preview: isGenericFallback(extraction.options) ? null : { options: extraction.options.map((o) => o.label), suggested: extraction.options.some((o) => o.generated) },
  });
  const [priors, facts] = await Promise.all([getAffinities().catch(() => ({})), getFacts().catch(() => [])]);
  const factors = applyLearnedPriors(weightsFromImportance(extraction.factors), priors);
  const bank = generateQuestions(extraction, 0);
  // A fun decision gets no interview at all; a serious one gets the full three.
  const budget = questionBudgetForMode(mode, extraction.stakes);
  const candidates = bank.map((q) => q.question);
  // Scoring is the slow call. Triage needs only the question and the candidates, so it does not wait for it.
  const { batch, kept } = await scoreAndTriage({
    // Personal context from Profile goes with the question, so the scores fit this person's situation.
    score: () => fetchFactorScores(extraction.options, factors, {
      context: withPersonalContext(text, facts.map((f) => f.text)),
      stakes: extraction.stakes,
    }, extraction.category),
    triage: () => budget === 0 ? Promise.resolve<string[]>([]) : triageCandidates(text, candidates, budget, extraction.category),
    fallback: candidates.slice(0, budget),
  }, () => { if (version === requestVersion) set({ stage: "questions" }); });
  if (version !== requestVersion) return;
  const options = buildOptionsFromScores(extraction.options, factors, batch.scores, { scenarios: batch.scenarios });
  const questions = kept.map(
    (question) =>
      bank.find((q) => q.question === question) ?? {
        question,
        expectedInformationGain: 0.7,
      }
  );
  set({
    status: "ready",
    decisionId: uid("dec"),
    extraction,
    safety,
    mode,
    offline: offline || batch.scores === null,
    scoringSource: batch.scores === null ? "none" : "api",
    scenarioNotice: batch.scenarioNotice,
    factors,
    options,
    questions,
  });
}

export const useSession = create<SessionState>((set, get) => (setState = set, {
  ...empty,
  privateMode: false,

  submit: async (input: string, force = false) => {
    const text = input.trim();
    if (!text || get().saving) return;
    const version = ++requestVersion;
    // Safety first: a crisis never waits behind "that doesn't look like a decision".
    const intent = readIntent(text);
    if (!force && intent.kind !== "decision" && classifySafety(text) === "normal") {
      set({ ...empty, privateMode: get().privateMode, status: "clarify", rawInput: text, draft: text, clarify: intent });
      return;
    }
    set({ ...empty, privateMode: get().privateMode, status: "loading", rawInput: text });
    try {
      const { extraction, safety, offline } = await parseDecision(text);
      if (version !== requestVersion) return;
      await analyse(version, text, extraction, safety, offline, decisionMode({ text, stakes: extraction.stakes, safety }));
    } catch (e) {
      if (version !== requestVersion) return;
      set({ status: "error", error: e instanceof Error ? e.message : t("parse failed") });
    }
  },

  startTemplate: async (templateId, optionNames, details = "") => {
    const template = templateById(templateId);
    const names = templateOptions(optionNames);
    if (!template || !names || get().saving) return false;
    const extra = details.trim().slice(0, 1000);
    const text = template.question(names) + (extra ? `

${extra}` : "");
    const version = ++requestVersion;
    set({ ...empty, privateMode: get().privateMode, status: "loading", stage: "scoring", rawInput: text });
    const safety = classifySafety(text);
    const extraction: DecisionExtractionValidated = {
      title: template.question(names).replace(/\?$/, "").slice(0, 110),
      category: template.category,
      options: names.map((label) => ({ id: uid("opt"), label })),
      factors: template.factors.map((f) => ({ ...f, id: uid("fac") })),
      missingInformation: [],
      stakes: template.stakes,
    };
    try {
      // What the person adds can make a light template serious ("…but I have a deadline tomorrow and no money").
      await analyse(version, text, extraction, safety, !apiEnabled(), safety === "normal" ? template.mode : "serious");
      return true;
    } catch (e) {
      if (version === requestVersion) set({ status: "error", error: e instanceof Error ? e.message : t("could not start") });
      return false;
    }
  },

  flip: () => {
    const s = get();
    if (s.status === "ready" && !s.saving && s.mode !== "serious") set({ flips: s.flips + 1 });
  },

  answer: (question: string, factorId: string | null) => {
    const s = get();
    if (s.status !== "ready" || s.saving || !s.questions.some((q) => q.question === question)) return;
    if (factorId !== null && !s.factors.some((f) => f.id === factorId)) return;
    if (s.answers[question] !== undefined) return;
    const chosen = s.factors.find((f) => f.id === factorId);
    if (chosen && !s.privateMode) void recordAffinity(chosen.label).catch(() => {});
    set({
      answers: { ...s.answers, [question]: factorId },
      factors: applyAnswerToWeights(s.factors, factorId),
      saved: false,
    });
  },

  nudgeWeight: (factorId, direction) => {
    const s = get();
    if (s.status !== "ready" || s.saving || s.factors.length < 2) return;
    if (!s.factors.some((f) => f.id === factorId)) return;
    set({ factors: nudgedWeights(s.factors, factorId, direction), saved: false });
  },

  duel: (factorId, optionId) => {
    const s = get();
    if (s.status !== "ready" || s.saving || s.options.length === 0 || factorId in s.duels) return;
    // Duels start a comparison; they never overwrite AI scores or a table the user filled in.
    if (s.scoringSource === "api" || (s.scoringSource === "manual" && Object.keys(s.duels).length === 0)) return;
    if (!s.factors.some((f) => f.id === factorId) || (optionId !== null && !s.options.some((o) => o.id === optionId))) return;
    const duels = { ...s.duels, [factorId]: optionId };
    set({ duels, options: optionsFromDuels(s.options, s.factors, duels), scoringSource: "manual", saved: false });
  },

  // Takes back the latest tap. Answers are rebuilt from the remaining ones, so the order is the insertion order.
  undoDuel: () => {
    const s = get();
    const keys = Object.keys(s.duels);
    if (s.status !== "ready" || s.saving || keys.length === 0) return;
    const duels = Object.fromEntries(keys.slice(0, -1).map((k) => [k, s.duels[k]]));
    set({
      duels,
      options: optionsFromDuels(s.options, s.factors, duels),
      scoringSource: keys.length === 1 ? "none" : "manual",
      saved: false,
    });
  },

  setManualScores: (scores: FactorScore[], scenarios?: ScenarioScore[]) => {
    const s = get();
    if (s.status !== "ready" || s.saving || s.options.length === 0) return false;
    if (scenarios && scenarios.length === 0) return false;
    const pairs = new Set(scores.map((v) => JSON.stringify([v.optionId, v.factorId])));
    if (scores.length !== s.options.length * s.factors.length || pairs.size !== scores.length ||
      !s.options.every((o) => s.factors.every((f) => pairs.has(JSON.stringify([o.id, f.id])))) ||
      scores.some((v) => !Number.isFinite(v.value) || v.value < -10 || v.value > 10 ||
        !Number.isFinite(v.probabilityConfidence) || v.probabilityConfidence < 0 || v.probabilityConfidence > 1)) return false;
    // A partial or out-of-range outcome set is refused outright, never quietly dropped.
    if (scenarios && !validateScenarios(scenarios, s.options, s.factors)) return false;
    const usable = scenarios ?? null;
    const reversibility = Object.fromEntries(s.options.map((o) => [o.id, o.reversibility]));
    const built = buildOptionsFromScores(s.options, s.factors, scores, {
      scenarios: usable,
      reversibility,
    });
    set({
      options: usable ? built : built.map((o) => ({ ...o, reversibility: reversibility[o.id] ?? o.reversibility })),
      duels: {},
      scoringSource: "manual",
      scenarioNotice: usable ? null : s.scenarioNotice,
      saved: false,
    });
    return true;
  },

  commit: async (optionId: string | null) => {
    const s = get();
    if (!s.extraction || !s.decisionId || s.saving || s.options.length === 0) return;
    if (optionId !== null && !s.options.some((o) => o.id === optionId)) return;
    // A reason belongs to one choice; picking a different option starts again.
    const choiceReason = optionId === s.committedOptionId ? s.choiceReason : null;
    if (s.privateMode) {
      set({ committedOptionId: optionId, choiceReason, saved: true });
      return;
    }
    const extraction = s.extraction;
    set({ saving: true, error: null });
    try {
      const id = s.decisionId;
      const moment = new Date();
      const now = moment.toISOString();
      await db.init();
      await db.transaction(["decisions", "decision_metadata", "options", "factors", "option_factor_values", "questions", "decision_outcomes", "decision_choices", "decision_followups", "decision_records"], async (database) => {
        const previous = await database.get("decisions", id);
        await database.insert("decisions", {
          id,
          title: extraction.title,
          raw_input: s.rawInput,
          category: JSON.stringify(extraction.category),
          stakes: extraction.stakes,
          status: optionId ? "decided" : "open",
          selected_option_id: optionId,
          private_mode: 0,
          created_at: previous?.created_at ?? now,
          // Re-saving the same choice (a reason, new weights) keeps when it was made.
          decided_at: optionId ? (previous?.selected_option_id === optionId && previous?.decided_at ? previous.decided_at : now) : null,
        });
        for (const o of s.options) {
          await database.insert("options", {
            id: o.id,
            decision_id: id,
            label: o.label,
            reversibility: o.reversibility,
          });
          for (const oc of o.outcomes) {
            for (const fv of oc.factors) {
              await database.insert("option_factor_values", {
                option_id: o.id,
                factor_id: fv.factorId,
                value: fv.value,
                confidence: oc.probabilityConfidence,
              });
            }
          }
        }
        for (const f of s.factors) {
          await database.insert("factors", { id: f.id, decision_id: id, label: f.label, weight: f.weight, pace: f.pace ?? null });
        }
        for (const [question, answer] of Object.entries(s.answers)) {
          await database.insert("questions", {
            id: JSON.stringify([id, question]),
            decision_id: id,
            question,
            answer,
            answered_at: now,
          });
        }
        await database.insert("decision_metadata", { id, safety: s.safety, scoring_source: s.scoringSource, mode: s.mode });
        // Check-ins: counted from the first save of an open decision, and from the moment of choosing for a decided one.
        const chosenOption = s.options.find((o) => o.id === optionId);
        const from = optionId && previous?.decided_at && previous.selected_option_id === optionId ? new Date(String(previous.decided_at))
          : !optionId && previous?.created_at ? new Date(String(previous.created_at)) : moment;
        // Each outcome check-in asks about the early sign the aftermath picture named for that moment.
        const picture = optionId ? aftermath({
          options: s.options, factors: s.factors, optionId, mode: s.mode, stakes: extraction.stakes, safety: s.safety, signal: s.scoringSource !== "none",
        }) : null;
        const plan = withSigns(followUpPlan({
          mode: s.mode, stakes: extraction.stakes, decided: Boolean(optionId), reversibility: chosenOption?.reversibility,
        }), picture);
        await writeFollowUps(database, id, plan, from);

        if (optionId) {
          const existing = await database.get("decision_outcomes", `out_${id}`);
          if (!existing) {
            const chosen = s.options.find((o) => o.id === optionId)!;
            await database.insert("decision_outcomes", {
              id: `out_${id}`,
              decision_id: id,
              rating: null,
              expected_outcome: String(round2(expectedUtility(chosen, s.factors))),
              actual_outcome: null,
              status: "pending",
              created_at: now,
            });
          }
        }

        // How the choice sits against the comparison, so Insights can later say how such choices turned out.
        const assessed = divergence(s.options, s.factors, optionId, s.scoringSource !== "none");
        if (assessed.level === "none") await database.deleteWhere("decision_choices", "id", id);
        else {
          const before = await database.get("decision_choices", id);
          await database.insert("decision_choices", {
            id, chosen_option_id: optionId, leader_option_id: assessed.leaderId, level: assessed.level,
            // After "it matters more than I said" the choice is aligned; what it was first is what Insights needs.
            initial_level: before && before.chosen_option_id === optionId ? before.initial_level : assessed.tied ? "tied" : assessed.level,
            gap: assessed.gap, certainty: assessed.certainty,
            implied_factor: assessed.implied?.label ?? null, implied_from: assessed.implied?.from ?? null, implied_to: assessed.implied?.to ?? null,
            reason: choiceReason, created_at: now,
          });
        }

        // A decision was made: keep a durable memory of its structure, scores and plan.
        if (optionId) {
          const record = createDecisionRecord({
            rawInput: s.rawInput,
            extraction: {
              title: extraction.title,
              category: extraction.category,
              options: s.options.map((o) => ({ id: o.id, label: o.label })),
              factors: s.factors.map((f) => ({ id: f.id, label: f.label, weight: f.weight })),
              stakes: extraction.stakes,
              mode: detectDecisionMode({
                text: s.rawInput,
                obligations: extraction.obligations ?? [],
                options: s.options,
                factors: s.factors,
                stakes: extraction.stakes,
              }),
            },
            chosenOptionId: optionId,
            recommendedOptionId: assessed.leaderId ?? undefined,
            scores: scoreAll(s.options, s.factors).map((sc) => ({ optionId: sc.optionId, jev: sc.jev, confidence: sc.confidence })),
            assumptions: [],
            evidence: [],
            constraints: [],
            earlyWarningSignals: picture?.earlyWarningSignals ?? [],
            checkInPlan: plan,
          });
          record.id = id;
          await saveDecisionRecord(database, record);
        }
      });
      if (get().decisionId === id) set({ committedOptionId: optionId, choiceReason, saving: false, saved: true });
      useAccount.getState().backupSoon();
    } catch (e) {
      if (get().decisionId === s.decisionId) set({ saving: false, error: e instanceof Error ? e.message : t("Could not save decision.") });
    }
  },

  loadDecision: async (id: string) => {
    if (get().saving) return false;
    const version = ++requestVersion;
    await db.init();
    const dec = await db.get("decisions", id);
    if (!dec) return false;
    const metadata = await db.get("decision_metadata", id);
    const [optRows, facRows, valRows] = await Promise.all([db.list("options"), db.list("factors"), db.list("option_factor_values")]);
    const { options, factors } = modelFromRows(id, optRows, facRows, valRows);
    const qRows = (await db.list("questions")).filter((r) => r.decision_id === id);
    const choice = await db.get("decision_choices", id);
    if (version !== requestVersion) return false;
    set({
      ...empty,
      privateMode: get().privateMode,
      status: "ready",
      decisionId: id,
      rawInput: String(dec.raw_input),
      extraction: {
        title: String(dec.title),
        category: JSON.parse(String(dec.category ?? ["Everyday"])),
        options: options.map((o) => ({ id: o.id, label: o.label })),
        factors: factors.map((f) => ({
          id: f.id,
          label: f.label,
          importance: f.weight,
          reason: "",
        })),
        missingInformation: [],
        stakes: dec.stakes,
      } as DecisionExtractionValidated,
      safety: (metadata?.safety as SafetyClass) ?? classifySafety(String(dec.raw_input)),
      mode: isMode(metadata?.mode) ? metadata.mode : decisionMode({
        text: String(dec.raw_input), stakes: dec.stakes as DecisionExtractionValidated["stakes"],
        safety: (metadata?.safety as SafetyClass) ?? classifySafety(String(dec.raw_input)),
      }),
      offline: true,
      scoringSource: (metadata?.scoring_source as SessionState["scoringSource"]) ??
        (options.some((o) => o.outcomes.some((oc) => oc.factors.some((f) => f.value !== 0))) ? "api" : "none"),
      factors,
      options,
      answers: Object.fromEntries(qRows.map((r) => [String(r.question), r.answer as string | null])),
      committedOptionId: (dec.selected_option_id as string | null) ?? null,
      choiceReason: (choice?.reason as ChoiceReason | null) ?? null,
      saved: true,
    });
    return true;
  },

  explainChoice: async (reason) => {
    const s = get();
    if (s.status !== "ready" || s.saving || !s.committedOptionId) return;
    const assessed = divergence(s.options, s.factors, s.committedOptionId, s.scoringSource !== "none");
    if (reason === "priority") {
      if (!assessed.implied) return;
      if (!s.privateMode) void recordAffinity(assessed.implied.label).catch(() => {});
      set({ factors: applyImpliedPriority(s.factors, assessed.implied), choiceReason: reason, saved: false });
    } else set({ choiceReason: reason, saved: false });
    // Save again so the stored decision carries the reason (and the new weights).
    await get().commit(s.committedOptionId);
  },

  refine: async (optionLabels, factorLabels) => {
    const s = get();
    const clean = (labels: string[], max: number, length: number) => {
      const seen = new Set<string>();
      return labels.map((l) => l.trim().replace(/\s+/g, " ").slice(0, length)).filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase())).slice(0, max);
    };
    const optionNames = clean(optionLabels, 4, 80);
    const factorNames = clean(factorLabels, 8, 40);
    if (s.status !== "ready" || !s.extraction || s.saving || optionNames.length < 2 || factorNames.length < 1) return false;
    const version = ++requestVersion;
    const previous = s.extraction;
    const wasSaved = s.saved && !s.privateMode ? s.decisionId : null;
    const extraction: DecisionExtractionValidated = {
      ...previous,
      options: optionNames.map((label) => ({ id: uid("opt"), label })),
      // A factor the person kept holds its importance; one they added starts in the middle.
      factors: factorNames.map((label) => ({
        id: uid("fac"), label, reason: "",
        importance: previous.factors.find((f) => f.label.toLowerCase() === label.toLowerCase())?.importance ?? 0.5,
      })),
      missingInformation: [],
    };
    // The corrected reading goes on screen at once, while the scores are re-done.
    set({ ...empty, privateMode: s.privateMode, status: "loading", stage: "scoring", preview: { options: optionNames, suggested: false }, rawInput: s.rawInput, mode: s.mode, extraction, safety: s.safety });
    try {
      const priors = await getAffinities().catch(() => ({}));
      const factors = applyLearnedPriors(weightsFromImportance(extraction.factors), priors);
      const facts = await getFacts().catch(() => []);
      // The corrected options go with the question, so the scores are about them and not the first reading.
      const context = withPersonalContext(`${s.rawInput}\n\nThe options being compared: ${optionNames.join("; ")}`, facts.map((f) => f.text));
      const batch = await fetchFactorScores(extraction.options, factors, { context, stakes: extraction.stakes }, extraction.category);
      if (version !== requestVersion) return false;
      // The earlier reading is replaced, not kept beside the corrected one.
      if (wasSaved) await deleteDecision(wasSaved).catch(() => {});
      set({
        status: "ready", decisionId: uid("dec"), extraction, safety: s.safety, mode: s.mode, offline: batch.scores === null,
        scoringSource: batch.scores === null ? "none" : "api", factors, scenarioNotice: batch.scenarioNotice,
        options: buildOptionsFromScores(extraction.options, factors, batch.scores, { scenarios: batch.scenarios }),
      });
      return true;
    } catch (e) {
      if (version === requestVersion) set({ status: "error", error: e instanceof Error ? e.message : t("could not re-run") });
      return false;
    }
  },

  editQuestion: () => {
    const s = get();
    if (s.saving) return;
    requestVersion++;
    set({ ...empty, privateMode: s.privateMode, draft: s.rawInput });
  },

  togglePrivate: () => { if (!get().saving) set((s) => ({ privateMode: !s.privateMode, saved: false })); },
  reset: () => { if (!get().saving) { requestVersion++; set({ ...empty, privateMode: get().privateMode }); } },
}));
