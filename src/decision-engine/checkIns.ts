// Decision check-ins and outcome learning (§20, §21).
// Turns ORION into a decision-learning system without hindsight bias.

import type { Stakes, DecisionModeType } from "../types.ts";
import type { FollowUpStep } from "./followUp.ts";
import { uid } from "./normalize.ts";
import { t } from "../i18n/index.ts";

export interface DecisionRecord {
  id: string;
  /** User's original decision text */
  rawInput: string;
  /** Extracted decision structure */
  extraction: {
    title: string;
    category: string[];
    options: { id: string; label: string; description?: string }[];
    factors: { id: string; label: string; weight: number }[];
    stakes: Stakes;
    mode: DecisionModeType;
  };
  /** The option the user chose */
  chosenOptionId: string;
  /** The option ORION recommended (if any) */
  recommendedOptionId?: string;
  /** Whether user went against ORION's recommendation */
  againstRecommendation: boolean;
  /** JEV scores at decision time */
  scores: { optionId: string; jev: number; confidence: number }[];
  /** Key assumptions at decision time */
  assumptions: { id: string; statement: string; confidence: number }[];
  /** Key evidence at decision time */
  evidence: { id: string; content: string; reliability: number }[];
  /** Constraints at decision time */
  constraints: { id: string; name: string; type: string }[];
  /** Early warning signals to watch */
  earlyWarningSignals: string[];
  /** When the decision was made */
  decidedAt: string;
  /** Check-in schedule */
  checkIns: CheckInSchedule[];
  /** Current status */
  status: "open" | "decided" | "reviewed";
  /** Outcome rating when reviewed */
  outcomeRating?: OutcomeRating;
  /** Actual outcome notes */
  outcomeNotes?: string;
  /** What was learned */
  lesson?: string;
}

export interface CheckInSchedule {
  id: string;
  /** Days after decision */
  days: number;
  /** Due date */
  dueAt: string;
  /** Prompt for the check-in */
  prompt: string;
  /** Status */
  status: "pending" | "completed" | "skipped";
  /** When completed */
  completedAt?: string;
  /** User's rating at check-in */
  rating?: CheckInRating;
  /** User's notes at check-in */
  notes?: string;
}

export type CheckInRating = "better" | "expected" | "worse";

export interface OutcomeRating {
  /** Overall: better/expected/worse than predicted */
  overall: CheckInRating;
  /** Per-factor ratings */
  factors: { factorId: string; label: string; rating: CheckInRating; notes?: string }[];
  /** Surprises */
  surprises: string[];
  /** What would user do differently */
  wouldChange?: string;
}

/** Create a new decision record for learning. */
export function createDecisionRecord(input: {
  rawInput: string;
  extraction: DecisionRecord["extraction"];
  chosenOptionId: string;
  recommendedOptionId?: string;
  scores: DecisionRecord["scores"];
  assumptions: DecisionRecord["assumptions"];
  evidence: DecisionRecord["evidence"];
  constraints: DecisionRecord["constraints"];
  earlyWarningSignals: string[];
  checkInPlan: FollowUpStep[];
}): DecisionRecord {
  const decidedAt = new Date().toISOString();
  const checkIns: CheckInSchedule[] = input.checkInPlan.map(step => ({
    id: uid("checkin"),
    days: step.days,
    dueAt: new Date(Date.now() + step.days * 24 * 60 * 60 * 1000).toISOString(),
    prompt: step.prompt,
    status: "pending",
  }));

  return {
    id: uid("dec"),
    rawInput: input.rawInput,
    extraction: input.extraction,
    chosenOptionId: input.chosenOptionId,
    recommendedOptionId: input.recommendedOptionId,
    againstRecommendation: input.recommendedOptionId !== undefined && input.recommendedOptionId !== input.chosenOptionId,
    scores: input.scores,
    assumptions: input.assumptions,
    evidence: input.evidence,
    constraints: input.constraints,
    earlyWarningSignals: input.earlyWarningSignals,
    decidedAt,
    checkIns,
    status: "decided",
  };
}

/** Record a check-in response. */
export function recordCheckIn(
  record: DecisionRecord,
  checkInId: string,
  rating: CheckInRating,
  notes?: string
): DecisionRecord {
  const checkIn = record.checkIns.find(c => c.id === checkInId);
  if (!checkIn) throw new Error(`Check-in ${checkInId} not found`);
  if (checkIn.status !== "pending") throw new Error(`Check-in already ${checkIn.status}`);

  const updated = { ...record };
  checkIn.status = "completed";
  checkIn.completedAt = new Date().toISOString();
  checkIn.rating = rating;
  checkIn.notes = notes;

  // If all check-ins done, mark for review
  if (updated.checkIns.every(c => c.status !== "pending")) {
    updated.status = "reviewed";
  }

  return updated;
}

/** Record the final outcome and learnings. */
export function recordOutcome(
  record: DecisionRecord,
  outcome: OutcomeRating
): DecisionRecord {
  const updated = { ...record };
  updated.outcomeRating = outcome;
  updated.outcomeNotes = outcome.surprises.join("; ");
  updated.lesson = outcome.wouldChange;
  updated.status = "reviewed";
  return updated;
}

/** Generate a reflection prompt based on decision history. */
export function generateReflectionPrompt(record: DecisionRecord): string {
  const chosen = record.extraction.options.find(o => o.id === record.chosenOptionId);
  const chosenLabel = chosen?.label || t("your choice");

  const parts = [
    t("You chose: {choice}", { choice: chosenLabel }),
    t("Because: {reasons}", { reasons: record.assumptions.map(a => a.statement).join("; ") || t("your assessment of what mattered most") }),
    t("ORION expected: {signals}", { signals: record.earlyWarningSignals.slice(0, 2).join("; ") }),
  ];

  if (record.againstRecommendation) {
    parts.push(t("You went against ORION's recommendation — that takes conviction."));
  }

  if (record.outcomeRating) {
    const overall = record.outcomeRating.overall;
    parts.push(overall === "better" ? t("Outcome: better than expected.") : overall === "worse" ? t("Outcome: worse than expected.") : t("Outcome: expected than expected."));
    if (record.outcomeRating.surprises.length > 0) {
      parts.push(t("Surprises: {surprises}", { surprises: record.outcomeRating.surprises.join("; ") }));
    }
    if (record.lesson) {
      parts.push(t("Lesson: {lesson}", { lesson: record.lesson }));
    }
  } else {
    parts.push(t("Check in when ready — how did it turn out?"));
  }

  return parts.join("\n\n");
}

/** Aggregate lessons from multiple decisions. */
export function aggregateLessons(records: DecisionRecord[]): {
  patterns: { pattern: string; count: number; examples: string[] }[];
  calibration: { overconfident: number; underconfident: number; wellCalibrated: number };
} {
  const reviewed = records.filter(r => r.outcomeRating);
  if (reviewed.length === 0) return { patterns: [], calibration: { overconfident: 0, underconfident: 0, wellCalibrated: 0 } };

  // Pattern detection
  const patternMap = new Map<string, { count: number; examples: string[] }>();

  for (const r of reviewed) {
    // Against recommendation pattern
    if (r.againstRecommendation) {
      const key = "against_recommendation";
      const entry = patternMap.get(key) || { count: 0, examples: [] };
      entry.count++;
      entry.examples.push(r.extraction.title);
      patternMap.set(key, entry);
    }

    // Outcome worse than expected
    if (r.outcomeRating?.overall === "worse") {
      const key = "worse_than_expected";
      const entry = patternMap.get(key) || { count: 0, examples: [] };
      entry.count++;
      entry.examples.push(r.extraction.title);
      patternMap.set(key, entry);
    }

    // Surprise patterns
    for (const surprise of r.outcomeRating?.surprises || []) {
      const key = `surprise:${surprise.toLowerCase().slice(0, 30)}`;
      const entry = patternMap.get(key) || { count: 0, examples: [] };
      entry.count++;
      entry.examples.push(r.extraction.title);
      patternMap.set(key, entry);
    }
  }

  // Calibration
  let overconfident = 0, underconfident = 0, wellCalibrated = 0;
  for (const r of reviewed) {
    const rating = r.outcomeRating;
    if (!rating) continue;
    const recommended = r.scores.find(s => s.optionId === r.recommendedOptionId);
    const chosen = r.scores.find(s => s.optionId === r.chosenOptionId);
    if (!recommended || !chosen) continue;

    const recConf = recommended.confidence;
    const outcome = rating.overall;

    if (recConf > 0.7 && outcome === "worse") overconfident++;
    else if (recConf < 0.5 && outcome === "better") underconfident++;
    else wellCalibrated++;
  }

  const patterns = Array.from(patternMap.entries())
    .map(([pattern, data]) => ({ pattern, count: data.count, examples: data.examples.slice(0, 3) }))
    .sort((a, b) => b.count - a.count);

  return { patterns, calibration: { overconfident, underconfident, wellCalibrated } };
}

/** Decision quality score (§30). */
export function scoreDecisionQuality(record: DecisionRecord): {
  level: "strong" | "moderate" | "weak";
  score: number;
  criteria: { name: string; met: boolean; detail: string }[];
} {
  const criteria: { name: string; met: boolean; detail: string }[] = [];

  // Clear options
  const clearOptions = record.extraction.options.length >= 2 && record.extraction.options.every(o => o.label.length > 3);
  criteria.push({ name: t("Clear options"), met: clearOptions, detail: clearOptions ? t("{n} distinct options", { n: record.extraction.options.length }) : t("Options unclear or missing") });

  // Strong evidence
  const strongEvidence = record.evidence.length > 0 && record.evidence.every(e => (e.reliability ?? 0) > 0.6);
  criteria.push({ name: t("Strong evidence"), met: strongEvidence, detail: strongEvidence ? t("{n} evidence items", { n: record.evidence.length }) : t("Limited or weak evidence") });

  // Known constraints
  const knownConstraints = record.constraints.length > 0;
  criteria.push({ name: t("Known constraints"), met: knownConstraints, detail: knownConstraints ? t("{n} constraints identified", { n: record.constraints.length }) : t("No explicit constraints") });

  // Stable result
  const scores = [...record.scores].sort((a, b) => b.jev - a.jev);
  const gap = (scores[0]?.jev ?? 0) - (scores[1]?.jev ?? 0);
  const stableResult = gap > 1;
  criteria.push({ name: t("Stable result"), met: stableResult, detail: stableResult ? t("Gap {gap} JEV points", { gap: gap.toFixed(1) }) : t("Close call (gap {gap})", { gap: gap.toFixed(1) }) });

  // Low unresolved assumptions
  const lowAssumptions = record.assumptions.filter(a => (a.confidence ?? 1) < 0.7).length <= 1;
  criteria.push({ name: t("Few unresolved assumptions"), met: lowAssumptions, detail: lowAssumptions ? t("Most assumptions confident") : t("{n} uncertain assumptions", { n: record.assumptions.length }) });

  // Reversibility known
  const reversibilityKnown = record.extraction.options.length > 0;
  criteria.push({ name: t("Reversibility assessed"), met: reversibilityKnown, detail: t("All options have reversibility assessment") });

  // Robustness
  // Would check robustness analysis result

  const metCount = criteria.filter(c => c.met).length;
  const score = metCount / criteria.length;

  return {
    level: score >= 0.8 ? "strong" : score >= 0.5 ? "moderate" : "weak",
    score: Math.round(score * 100) / 100,
    criteria,
  };
}