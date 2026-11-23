// Decision memory ledger (§20–§21): a durable snapshot of a decision that was
// made — the extracted structure, the scores at decision time, and the
// check-in plan — plus the outcome updates a person adds later when they rate
// how it turned out. Written beside the decision on commit, read back to reopen
// the deep-dive surface after a relaunch.
import { db, type Database } from "./database.ts";
import type { DecisionRecord } from "../decision-engine/checkIns.ts";

type Row = Record<string, unknown>;

const str = (v: unknown, fallback = ""): string => (v === null || v === undefined ? fallback : String(v));

const json = (v: unknown): string | null =>
  v === undefined || v === null ? null : JSON.stringify(v);

const parse = <T>(v: unknown): T | undefined => {
  if (v === null || v === undefined) return undefined;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return undefined;
  }
};

const RECORD_STATUS: DecisionRecord["status"][] = ["open", "decided", "reviewed"];

function recordRow(record: DecisionRecord, now: Date, createdAt: string): Row {
  return {
    id: record.id,
    raw_input: record.rawInput,
    extraction_json: JSON.stringify(record.extraction),
    chosen_option_id: record.chosenOptionId || null,
    recommended_option_id: record.recommendedOptionId ?? null,
    against_recommendation: record.againstRecommendation ? 1 : 0,
    scores_json: json(record.scores),
    assumptions_json: json(record.assumptions),
    evidence_json: json(record.evidence),
    constraints_json: json(record.constraints),
    early_warning_signals_json: json(record.earlyWarningSignals),
    decided_at: record.decidedAt,
    checkins_json: json(record.checkIns),
    outcome_rating_json: record.outcomeRating ? JSON.stringify(record.outcomeRating) : null,
    lesson: record.lesson ?? null,
    status: record.status ?? "decided",
    created_at: createdAt,
    updated_at: now.toISOString(),
  };
}

/**
 * Write (or rewrite, same id) the memory of a made decision. Part of the commit
 * transaction so a failed save rolls the whole decision back.
 */
export async function saveDecisionRecord(database: Database, record: DecisionRecord, now: Date = new Date()): Promise<void> {
  const existing = await database.get("decision_records", record.id);
  const createdAt = existing ? str(existing.created_at) : now.toISOString();
  await database.insert("decision_records", recordRow(record, now, createdAt));
}

/** Read a decision's memory back, or null when it was never committed. */
export async function loadDecisionRecord(id: string): Promise<DecisionRecord | null> {
  await db.init();
  const row = await db.get("decision_records", id);
  if (!row) return null;
  const extraction = parse<DecisionRecord["extraction"]>(row.extraction_json);
  if (!extraction) return null;
  const status = str(row.status, "decided");
  return {
    id: str(row.id),
    rawInput: str(row.raw_input),
    extraction,
    chosenOptionId: str(row.chosen_option_id, ""),
    recommendedOptionId: row.recommended_option_id ? str(row.recommended_option_id) : undefined,
    againstRecommendation: Number(row.against_recommendation ?? 0) === 1,
    scores: parse(row.scores_json) ?? [],
    assumptions: parse(row.assumptions_json) ?? [],
    evidence: parse(row.evidence_json) ?? [],
    constraints: parse(row.constraints_json) ?? [],
    earlyWarningSignals: parse(row.early_warning_signals_json) ?? [],
    decidedAt: str(row.decided_at),
    checkIns: parse(row.checkins_json) ?? [],
    status: (RECORD_STATUS as string[]).includes(status) ? (status as DecisionRecord["status"]) : "decided",
    outcomeRating: parse(row.outcome_rating_json),
    lesson: row.lesson ? str(row.lesson) : undefined,
  };
}

/** Apply whatever a check-in or outcome rating changed, and mark it updated. */
export async function updateDecisionRecord(record: DecisionRecord, now: Date = new Date()): Promise<void> {
  await db.init();
  const existing = await db.get("decision_records", record.id);
  if (!existing) {
    await saveDecisionRecord(db, record, now);
    return;
  }
  await db.upsert("decision_records", recordRow(record, now, str(existing.created_at)));
}