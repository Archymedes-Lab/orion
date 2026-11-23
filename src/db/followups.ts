// Check-ins ORION has promised to make. Written with the decision (same transaction), shown on Home once due,
// and closed when the person answers, snoozes, or rates the decision in History.
import { db, type Database } from "./database.ts";
import { uid } from "../decision-engine/normalize.ts";
import { dueDate, type FollowUpKind, type FollowUpStep } from "../decision-engine/followUp.ts";

export interface DueFollowUp {
  id: string;
  decisionId: string;
  title: string;
  kind: FollowUpKind;
  prompt: string;
  dueAt: string;
  /** Label of the chosen option, for outcome check-ins. */
  chosen: string | null;
}

const idFor = (decisionId: string, step: FollowUpStep) => `fu:${decisionId}:${step.kind}:${step.days}`;

/**
 * Makes the stored plan for one decision match `plan`. Check-ins already answered stay answered; pending ones the
 * new plan no longer contains (an open decision that has now been decided) are dropped.
 */
export async function writeFollowUps(database: Database, decisionId: string, plan: FollowUpStep[], from: Date): Promise<void> {
  const wanted = new Map(plan.map((step) => [idFor(decisionId, step), step]));
  const existing = (await database.list("decision_followups")).filter((r) => r.decision_id === decisionId);
  for (const row of existing) {
    if (!wanted.has(String(row.id)) && row.status === "pending") await database.deleteWhere("decision_followups", "id", String(row.id));
  }
  const have = new Set(existing.map((r) => String(r.id)));
  for (const [id, step] of wanted) {
    if (have.has(id)) continue;
    await database.insert("decision_followups", {
      id, decision_id: decisionId, kind: step.kind, prompt: step.prompt,
      due_at: dueDate(from, step.days), status: "pending", created_at: from.toISOString(), done_at: null,
    });
  }
}

/** Check-ins that are due, one per decision (the earliest), newest decision first. */
export async function dueFollowUps(now: Date = new Date()): Promise<DueFollowUp[]> {
  await db.init();
  const [rows, decisions, options] = await Promise.all([db.list("decision_followups"), db.list("decisions"), db.list("options")]);
  const byId = new Map(decisions.map((d) => [String(d.id), d]));
  const labels = new Map(options.map((o) => [String(o.id), String(o.label)]));
  const picked = new Map<string, DueFollowUp>();
  for (const row of rows) {
    if (row.status !== "pending" || String(row.due_at) > now.toISOString()) continue;
    const decision = byId.get(String(row.decision_id));
    if (!decision) continue;
    const kind = row.kind === "open" ? "open" : "outcome";
    // A plan can go stale between saves; never ask "still deciding?" about a decided one, or the reverse.
    if ((kind === "open") !== (decision.status !== "decided")) continue;
    const item: DueFollowUp = {
      id: String(row.id), decisionId: String(row.decision_id), title: String(decision.title), kind,
      prompt: String(row.prompt ?? "How did it turn out?"), dueAt: String(row.due_at),
      chosen: decision.selected_option_id ? labels.get(String(decision.selected_option_id)) ?? null : null,
    };
    const current = picked.get(item.decisionId);
    if (!current || item.dueAt < current.dueAt) picked.set(item.decisionId, item);
  }
  return [...picked.values()].sort((a, b) => String(byId.get(b.decisionId)?.created_at).localeCompare(String(byId.get(a.decisionId)?.created_at)));
}

/** The next check-in still to come for a decision, or null. */
export async function nextFollowUp(decisionId: string): Promise<{ dueAt: string; prompt: string } | null> {
  await db.init();
  const pending = (await db.list("decision_followups"))
    .filter((r) => r.decision_id === decisionId && r.status === "pending")
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  return pending[0] ? { dueAt: String(pending[0].due_at), prompt: String(pending[0].prompt ?? "") } : null;
}

export async function resolveFollowUp(id: string, now: Date = new Date()): Promise<void> {
  await db.init();
  const row = await db.get("decision_followups", id);
  if (row) await db.upsert("decision_followups", { ...row, status: "done", done_at: now.toISOString() });
}

/** Every check-in for this decision that is already due counts as answered: the person just told ORION. */
export async function resolveDueFollowUps(decisionId: string, now: Date = new Date()): Promise<void> {
  await db.init();
  for (const row of await db.list("decision_followups")) {
    if (row.decision_id === decisionId && row.status === "pending" && String(row.due_at) <= now.toISOString()) {
      await db.upsert("decision_followups", { ...row, status: "done", done_at: now.toISOString() });
    }
  }
}

export async function snoozeFollowUp(id: string, days: number, now: Date = new Date()): Promise<void> {
  await db.init();
  const row = await db.get("decision_followups", id);
  if (row) await db.upsert("decision_followups", { ...row, due_at: dueDate(now, days) });
}

/** The five ratings History and the check-ins offer, best first. */
export const RATINGS = ["Great", "Good", "Neutral", "Bad", "Very bad"] as const;

/** Records how a decision turned out (History keeps the latest) and closes the check-ins that asked. */
export async function recordRating(decisionId: string, rating: string, now: Date = new Date()): Promise<void> {
  await db.init();
  await db.insert("decision_outcomes", { id: uid("out"), decision_id: decisionId, rating, created_at: now.toISOString() });
  await resolveDueFollowUps(decisionId, now);
}
