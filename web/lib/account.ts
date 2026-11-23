"use client";
// Who is signed in, how many tries a guest has, and keeping the web app's decisions with the account so they follow
// the person to other browsers. One shared copy for the whole page, read with useAccount().
import { useSyncExternalStore } from "react";
import type { BusinessProfile } from "@orion/business/schema.ts";
import { api, ApiError } from "./api";
import type { DecisionRun } from "./decide";
import { store, subscribe as onStoreChange } from "./store";

export type Account =
  | { state: "loading" }
  /** This server has no accounts: everything stays on this device. */
  | { state: "local" }
  | { state: "out"; guestDecisions: number }
  | { state: "in"; email: string; sync: "idle" | "saving" | "saved" | "failed" | "too_large" };

let current: Account = { state: "loading" };
const listeners = new Set<() => void>();
const set = (next: Account) => { current = next; listeners.forEach((l) => l()); };

const LOADING: Account = { state: "loading" };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useAccount(): Account {
  return useSyncExternalStore(subscribe, () => current, () => LOADING);
}

let started = false;
/** Looks up the session once per page load (and again after signing in or out). */
export async function refreshAccount() {
  started = true;
  try {
    const me = await api<{ user?: { email?: string } }>("auth/me");
    if (me.user?.email) {
      set({ state: "in", email: me.user.email, sync: "idle" });
      await pull();
      return;
    }
    const health = await api<{ guestDecisions?: number }>("health").catch(() => ({ guestDecisions: 0 }));
    set({ state: "out", guestDecisions: health.guestDecisions ?? 0 });
  } catch (e) {
    set(e instanceof ApiError && e.status === 404 ? { state: "local" } : { state: "out", guestDecisions: 0 });
  }
}
export function startAccount() { if (!started) void refreshAccount(); }

// ── Sync ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface WebBackup { app: "orion"; version: 1; exportedAt: string; tables: { runs: DecisionRun[]; company: BusinessProfile[]; deleted: { id: string; at: number }[] } }
const LIMIT = 290_000; // the server takes 300 KB per backup

/** Newest decisions first, as many as fit the account's backup. */
function payload(): { data: WebBackup; complete: boolean } {
  const d = store.get();
  const deleted = Object.entries(d.deleted).map(([id, at]) => ({ id, at }));
  let runs = d.runs;
  const build = (): WebBackup => ({ app: "orion", version: 1, exportedAt: new Date().toISOString(), tables: { runs, company: [d.company], deleted } });
  let data = build();
  while (runs.length && new Blob([JSON.stringify({ data })]).size > LIMIT) {
    runs = runs.slice(0, Math.floor(runs.length * 0.8));
    data = build();
  }
  return { data, complete: runs.length === d.runs.length };
}

let applying = false;
async function pull() {
  try {
    const got = await api<{ data: WebBackup | null }>("account/web-backup");
    const t = got.data?.tables;
    if (t) {
      applying = true;
      try {
        store.mergeRemote({
          runs: Array.isArray(t.runs) ? t.runs : [],
          company: Array.isArray(t.company) && t.company[0] && typeof t.company[0] === "object" ? t.company[0] : null,
          deleted: Object.fromEntries((Array.isArray(t.deleted) ? t.deleted : []).map((x) => [x.id, x.at])),
        });
      } finally { applying = false; }
    }
    await push();
  } catch { if (current.state === "in") set({ ...current, sync: "failed" }); }
}

async function push() {
  if (current.state !== "in") return;
  set({ ...current, sync: "saving" });
  const { data, complete } = payload();
  try {
    await api("account/web-backup", { data });
    if (current.state === "in") set({ ...current, sync: complete ? "saved" : "too_large" });
    return true;
  } catch (e) {
    if (current.state === "in") set({ ...current, sync: e instanceof ApiError && e.status === 413 ? "too_large" : "failed" });
    return false;
  }
}

// Saves a couple of seconds after the last change while signed in. The rail layout is this browser's own business.
let timer: ReturnType<typeof setTimeout> | null = null;
let last: unknown[] = [];
if (typeof window !== "undefined") {
  onStoreChange(() => {
    if (applying || current.state !== "in") return;
    // The store replaces only what changed, so comparing these three by reference is enough.
    const d = store.get();
    const now = [d.runs, d.company, d.deleted];
    if (now.every((v, i) => v === last[i])) return;
    last = now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void push(); }, 2000);
  });
}

/** Saves to the account, ends the session, and clears decisions from this browser (it may be shared). */
export async function signOut(): Promise<boolean> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (current.state === "in" && !(await push())) return false;
  await api("auth/logout", {}).catch(() => null);
  store.forgetPersonal();
  await refreshAccount();
  return true;
}
