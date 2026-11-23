// History helpers shared by the rail, the history page and the command palette: search, date groups, sorting, and
// moving decisions in and out of the browser as files.
import { msg } from "@orion/i18n/index.ts";
import type { DecisionRun } from "./decide";

export type Sort = "newest" | "oldest" | "title" | "edited";

/** Case-insensitive match on the title, the question and the note. */
export function matches(run: DecisionRun, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [run.title, run.question, run.note ?? "", ...run.options.map((o) => o.label)].some((s) => s.toLowerCase().includes(q));
}

export function sortRuns(runs: DecisionRun[], sort: Sort): DecisionRun[] {
  const list = [...runs];
  if (sort === "oldest") list.sort((a, b) => a.createdAt - b.createdAt);
  else if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "edited") list.sort((a, b) => (b.editedAt ?? b.createdAt) - (a.editedAt ?? a.createdAt));
  else list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

const GROUPS = [msg("Pinned"), msg("Today"), msg("Yesterday"), msg("Previous 7 days"), msg("Previous 30 days"), msg("Older")] as const;
export type Group = (typeof GROUPS)[number];

/** Pinned first, then by how long ago, newest first. Empty groups are left out. */
export function groupRuns(runs: DecisionRun[], now = Date.now()): { label: Group; runs: DecisionRun[] }[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const start = midnight.getTime();
  const bucket = (r: DecisionRun): Group => {
    if (r.pinned) return GROUPS[0];
    if (r.createdAt >= start) return GROUPS[1];
    if (r.createdAt >= start - day) return GROUPS[2];
    if (r.createdAt >= start - 7 * day) return GROUPS[3];
    if (r.createdAt >= start - 30 * day) return GROUPS[4];
    return GROUPS[5];
  };
  const out = new Map<Group, DecisionRun[]>(GROUPS.map((g) => [g, []]));
  for (const r of sortRuns(runs, "newest")) out.get(bucket(r))!.push(r);
  return GROUPS.map((label) => ({ label, runs: out.get(label)! })).filter((g) => g.runs.length > 0);
}

/** Hands the browser a file to save. */
export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportJson(runs: DecisionRun[]) {
  download(`orion-decisions-${stamp()}.json`, JSON.stringify({ app: "orion", version: 1, exportedAt: Date.now(), runs }, null, 2), "application/json");
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A flat table for spreadsheets: one row per decision, what ORION said is left to the app (it is recomputed). */
export function exportCsv(runs: DecisionRun[]) {
  const head = ["date", "title", "question", "lens", "options", "chosen", "pinned", "note"];
  const rows = runs.map((r) => [
    new Date(r.createdAt).toISOString(), r.title, r.question, r.lens, r.options.map((o) => o.label).join(" | "),
    r.options.find((o) => o.id === r.chosen)?.label ?? "", r.pinned ? "yes" : "", r.note ?? "",
  ].map(cell).join(","));
  download(`orion-decisions-${stamp()}.csv`, [head.join(","), ...rows].join("\n"), "text/csv");
}

/** Reads an ORION export (or a bare array of decisions). Throws on anything that isn't one. */
export function parseExport(text: string): DecisionRun[] {
  const json = JSON.parse(text) as unknown;
  const list = Array.isArray(json) ? json : (json as { runs?: unknown })?.runs;
  if (!Array.isArray(list)) throw new Error("not an export");
  const ok = list.filter((r): r is DecisionRun =>
    !!r && typeof r === "object" && typeof r.id === "string" && typeof r.question === "string" && typeof r.title === "string" &&
    typeof r.createdAt === "number" && Array.isArray(r.options) && Array.isArray(r.factors));
  if (ok.length === 0) throw new Error("no decisions");
  return ok;
}
