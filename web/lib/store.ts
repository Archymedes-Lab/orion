"use client";
// Device storage for the web app: past decisions, the "for me / for a business" lens, the company profile and how the
// rail is laid out. Small, synchronous and subscribable, so any component can read it with useSyncExternalStore.
import { useSyncExternalStore } from "react";
import type { BusinessProfile } from "@orion/business/schema.ts";
import type { DecisionRun } from "./decide";

type Lens = "personal" | "business";
interface Rail { collapsed: boolean; width: number }
/** `deleted`: when each decision was deleted, so syncing with the account never brings one back. */
interface Data { runs: DecisionRun[]; lens: Lens; company: BusinessProfile; rail: Rail; deleted: Record<string, number> }

const KEY = "orion.web.v1";
const MAX_RUNS = 200;
export const RAIL = { min: 208, max: 420, base: 248, collapsed: 68 } as const;
const EMPTY: Data = { runs: [], lens: "personal", company: {}, rail: { collapsed: false, width: RAIL.base }, deleted: {} };
const MAX_TOMBSTONES = 500;
let cache: Data | null = null;
const listeners = new Set<() => void>();
// The last batch deleted, held in memory only so one Undo toast (in the workspace shell) can bring it back.
let trash: DecisionRun[] | null = null;

function read(): Data {
  if (cache) return cache;
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    cache = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Data>) } : EMPTY;
  } catch { cache = EMPTY; }
  return cache;
}

function notify() { listeners.forEach((l) => l()); }

function write(next: Data) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode or full: keep it in memory */ }
  notify();
}

export const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; l(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
};

export function useStore<T>(select: (d: Data) => T): T {
  return useSyncExternalStore(subscribe, () => select(read()), () => select(EMPTY));
}

/** What the last delete removed, until it is undone or replaced. */
export function useTrash(): DecisionRun[] | null {
  return useSyncExternalStore(subscribe, () => trash, () => null);
}

const sorted = (runs: DecisionRun[]) => [...runs].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RUNS);
const touched = (r: DecisionRun) => r.editedAt ?? r.createdAt;
/** Keeps the newest tombstones only; an older one can't matter once its decision is long gone everywhere. */
const trimmed = (deleted: Record<string, number>) =>
  Object.fromEntries(Object.entries(deleted).sort((a, b) => b[1] - a[1]).slice(0, MAX_TOMBSTONES));

export const store = {
  get: read,
  saveRun(run: DecisionRun) {
    const d = read();
    // A change to a saved decision (a choice, new scores) is an edit, so it wins when another device syncs.
    const next = d.runs.some((r) => r.id === run.id) ? { ...run, editedAt: Date.now() } : run;
    write({ ...d, runs: sorted([next, ...d.runs.filter((r) => r.id !== run.id)]) });
  },
  /** A hand edit (title, note, pin, choice): stamps editedAt unless only the pin changed. */
  updateRun(id: string, patch: Partial<Pick<DecisionRun, "title" | "note" | "pinned" | "chosen" | "lens">>) {
    const d = read();
    const stamp = Object.keys(patch).some((k) => k !== "pinned") ? { editedAt: Date.now() } : {};
    write({ ...d, runs: d.runs.map((r) => (r.id === id ? { ...r, ...patch, ...stamp } : r)) });
  },
  removeRun(id: string) { store.removeRuns([id]); },
  removeRuns(ids: string[]) {
    const d = read();
    const gone = new Set(ids);
    trash = d.runs.filter((r) => gone.has(r.id));
    const at = Date.now();
    write({ ...d, runs: d.runs.filter((r) => !gone.has(r.id)), deleted: trimmed({ ...d.deleted, ...Object.fromEntries(ids.map((id) => [id, at])) }) });
  },
  undoRemove() {
    if (!trash) return;
    const back = trash;
    trash = null;
    const d = read();
    const have = new Set(d.runs.map((r) => r.id));
    const deleted = { ...d.deleted };
    for (const r of back) delete deleted[r.id];
    write({ ...d, runs: sorted([...d.runs, ...back.filter((r) => !have.has(r.id))]), deleted });
  },
  dismissTrash() { if (trash) { trash = null; notify(); } },
  /** Adds decisions from an export; one already here with the same id keeps the newer edit. Returns how many changed. */
  importRuns(incoming: DecisionRun[]) {
    const d = read();
    const byId = new Map(d.runs.map((r) => [r.id, r]));
    let changed = 0;
    for (const r of incoming) {
      const mine = byId.get(r.id);
      if (mine && touched(mine) >= touched(r)) continue;
      byId.set(r.id, r);
      changed++;
    }
    write({ ...d, runs: sorted([...byId.values()]) });
    return changed;
  },
  /**
   * Folds in what the account holds from other devices. Per decision the later edit wins; a deletion wins over any
   * copy last touched before it. The company profile from the account fills in only when this device has none.
   */
  mergeRemote(remote: { runs: DecisionRun[]; deleted: Record<string, number>; company: BusinessProfile | null }) {
    const d = read();
    const deleted = { ...d.deleted };
    for (const [id, at] of Object.entries(remote.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, at);
    const byId = new Map(d.runs.map((r) => [r.id, r]));
    for (const r of remote.runs) { const mine = byId.get(r.id); if (!mine || touched(r) > touched(mine)) byId.set(r.id, r); }
    const runs = sorted([...byId.values()].filter((r) => !(deleted[r.id] && deleted[r.id] >= touched(r))));
    const company = Object.keys(d.company).length === 0 && remote.company ? remote.company : d.company;
    write({ ...d, runs, company, deleted: trimmed(deleted) });
  },
  /** After signing out on a shared browser: the decisions and company profile leave this device (the account keeps them). */
  forgetPersonal() { trash = null; write({ ...read(), runs: [], company: {}, deleted: {} }); },
  setLens(lens: Lens) { write({ ...read(), lens }); },
  setCompany(company: BusinessProfile) { write({ ...read(), company }); },
  setRail(patch: Partial<Rail>) { const d = read(); write({ ...d, rail: { ...d.rail, ...patch } }); },
  clear() { write(EMPTY); },
};
export type { Lens };
