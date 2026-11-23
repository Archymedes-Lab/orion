// Saved decisions as the History screen needs them, plus the controls a person has over their own data:
// delete one decision, export everything, erase everything.
import { db } from "./database.ts";

/** Every table that holds user data. */
export const TABLES = [
  "decisions", "decision_metadata", "options", "factors", "option_factor_values", "outcomes",
  "questions", "decision_results", "decision_outcomes", "decision_choices", "decision_followups", "decision_shares",
  "user_preferences",
  "constraints", "evidence", "assumptions", "unknowns", "criteria", "decision_scenarios",
  "risks", "decision_checkins", "decision_records",
] as const;

export interface SavedDecision {
  id: string;
  title: string;
  stakes: string;
  category: string;
  status: "open" | "decided";
  createdAt: string;
  /** Label of the option the person chose, when they have chosen. */
  chosen: string | null;
  /** The choice went against the comparison by more than its uncertainty. */
  againstComparison: boolean;
}

/** Saved decisions, newest first. */
export async function listDecisions(): Promise<SavedDecision[]> {
  await db.init();
  const [decisions, options, choices] = await Promise.all([db.list("decisions"), db.list("options"), db.list("decision_choices")]);
  const against = new Set(choices.filter((c) => c.initial_level === "against" || c.initial_level === "strongly_against").map((c) => String(c.id)));
  const labels = new Map(options.map((o) => [String(o.id), String(o.label)]));
  return decisions
    .map((d) => {
      let category = "Everyday";
      try { category = String((JSON.parse(String(d.category ?? "[]")) as unknown[])[0] ?? category); } catch { /* keep the default */ }
      return {
        id: String(d.id),
        title: String(d.title),
        stakes: String(d.stakes ?? "normal"),
        category,
        status: d.status === "decided" ? "decided" as const : "open" as const,
        createdAt: String(d.created_at ?? ""),
        chosen: d.selected_option_id ? labels.get(String(d.selected_option_id)) ?? null : null,
        againstComparison: Boolean(d.selected_option_id) && against.has(String(d.id)),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Title, status or chosen option contains every word of the query. */
export function matchesQuery(decision: SavedDecision, query: string): boolean {
  const haystack = `${decision.title} ${decision.category} ${decision.chosen ?? ""}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

/** Removes a decision and everything saved with it. Learned preferences are kept. */
export async function deleteDecision(id: string): Promise<void> {
  await db.init();
  const optionIds = (await db.list("options")).filter((o) => o.decision_id === id).map((o) => String(o.id));
  await db.transaction([...TABLES], async (database) => {
    for (const optionId of optionIds) {
      await database.deleteWhere("option_factor_values", "option_id", optionId);
      await database.deleteWhere("outcomes", "option_id", optionId);
    }
    for (const table of ["options", "factors", "questions", "decision_results", "decision_outcomes", "decision_followups"]) {
      await database.deleteWhere(table, "decision_id", id);
    }
    await database.deleteWhere("decision_metadata", "id", id);
    await database.deleteWhere("decision_choices", "id", id);
    await database.deleteWhere("decision_shares", "id", id);
    await database.deleteWhere("decisions", "id", id);
  });
}

export interface DataExport {
  app: "orion";
  version: 1;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Everything stored on this device, as one portable document. */
export async function exportData(now: Date = new Date()): Promise<DataExport> {
  await db.init();
  const tables: DataExport["tables"] = {};
  for (const table of TABLES) tables[table] = await db.list(table);
  return { app: "orion", version: 1, exportedAt: now.toISOString(), tables };
}

/** Erases every saved decision, outcome, and preference on this device. */
export async function eraseAllData(): Promise<void> {
  await db.init();
  await db.transaction([...TABLES], async (database) => {
    for (const table of TABLES) await database.clearTable(table);
  });
}

/**
 * Adds an export or account backup to what is on this device. Rows with the same id are replaced, nothing is
 * removed, and unknown tables are ignored. Returns how many decisions the data held.
 */
export async function importData(data: unknown): Promise<number> {
  const tables = (data as DataExport | null)?.tables;
  if (!data || (data as DataExport).app !== "orion" || !tables || typeof tables !== "object") return 0;
  await db.init();
  await db.transaction([...TABLES], async (database) => {
    for (const table of TABLES) {
      const rows = tables[table];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) if (row && typeof row === "object") await database.insert(table, row);
    }
  });
  return Array.isArray(tables.decisions) ? tables.decisions.length : 0;
}
