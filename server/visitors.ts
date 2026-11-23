// Who is asking, and what a launch needs to know about them.
//
// - Signed client address: the web app reaches this API through its own server (a proxy), so every visitor would
//   otherwise share the proxy's address and its per-client limits (signups, failed logins, requests a minute).
//   The proxy signs the visitor's address with a secret both sides hold; anything unsigned or stale is ignored.
// - Guest tries: with accounts on, a visitor may make a few decisions before creating one.
// - Launch counters and an error log, kept in the account store so they survive between function instances.
import { createHmac, timingSafeEqual } from "node:crypto";
import { msg } from "../src/i18n/index.ts";
import type { Store } from "./store.ts";

export const CLIENT_HEADER = "x-orion-client";
const MAX_SKEW_MS = 5 * 60_000;

const mac = (secret: string, text: string) => createHmac("sha256", secret).update(text).digest("base64url");

/** "address|timestamp|signature". The web proxy's copy of this lives in web/app/api/orion/[...path]/route.ts. */
export function signClient(address: string, secret: string, now = Date.now()): string {
  return `${address}|${now}|${mac(secret, `${address}|${now}`)}`;
}

/** The visitor's address when the header is signed with `secret` and recent, otherwise null. */
export function verifiedClient(value: unknown, secret: string, now = Date.now()): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  const [address, stamp, signature] = value.split("|");
  if (!address || !stamp || !signature || !/^[0-9a-fA-F:.]{2,64}$/.test(address)) return null;
  const at = Number(stamp);
  if (!Number.isFinite(at) || Math.abs(now - at) > MAX_SKEW_MS) return null;
  const want = Buffer.from(mac(secret, `${address}|${stamp}`));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got) ? address : null;
}

/** Constant-time check of an operator key (Authorization: Bearer …). False when no key is configured. */
export function isOperator(header: unknown, key: string | undefined): boolean {
  if (!key || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const want = Buffer.from(key), got = Buffer.from(header.slice(7).trim());
  return want.length === got.length && timingSafeEqual(want, got);
}

// ── Guest tries ─────────────────────────────────────────────────────────────────────────────────────────────────

export const GUEST_PATHS = ["/decision/parse", "/decision/score-factors", "/decision/triage", "/decision/explain", "/decision/aftermath", "/decision/creative", "/decision/prioritize", "/decision/downside"];
/** Requests one decision may make beyond reading the question (scoring, follow-ups, new paths, the aftermath…). */
const CALLS_PER_DECISION = 12;

export interface GuestConfig { decisions: number; dailyTotal: number }

/** ORION_GUEST_DECISIONS per visitor per day (default 2, 0 turns guests off); ORION_GUEST_DAILY_TOTAL for everyone. */
export function guestConfig(env: Record<string, string | undefined>): GuestConfig | null {
  const n = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return value === undefined || value === "" || !Number.isFinite(parsed) || parsed < 0 ? fallback : Math.floor(parsed);
  };
  const decisions = n(env.ORION_GUEST_DECISIONS, 2);
  return decisions > 0 ? { decisions, dailyTotal: n(env.ORION_GUEST_DAILY_TOTAL, 2000) } : null;
}

const day = (now: number) => new Date(now).toISOString().slice(0, 10);
const TWO_DAYS = 2 * 86_400;

export type GuestVerdict = { allowed: true; left: number } | { allowed: false; error: string; code: "guest_limit" };

/**
 * Counts a signed-out visitor's request. Reading a question starts a decision; the rest of that decision's requests
 * share a budget, so one guest cannot keep a model busy by skipping the first step.
 */
export async function admitGuest(store: Store, config: GuestConfig, client: string, path: string, now = Date.now()): Promise<GuestVerdict> {
  const today = day(now);
  const limit: GuestVerdict = { allowed: false, error: msg("You’ve used today’s free tries. Create a free account to keep deciding — it takes a few seconds."), code: "guest_limit" };
  if (path === "/decision/parse") {
    const mine = await store.incr(`guest:decisions:${today}:${client}`, TWO_DAYS);
    if (mine > config.decisions) return limit;
    if (await store.incr(`guest:total:${today}`, TWO_DAYS) > config.dailyTotal) return limit;
    return { allowed: true, left: config.decisions - mine };
  }
  const calls = await store.incr(`guest:calls:${today}:${client}`, TWO_DAYS);
  return calls > config.decisions * CALLS_PER_DECISION ? limit : { allowed: true, left: Math.max(0, config.decisions - Number(await store.get(`guest:decisions:${today}:${client}`) ?? 0)) };
}

// ── Launch counters and the error log ───────────────────────────────────────────────────────────────────────────

export const EVENTS = ["signup", "login", "guest_decision", "decision", "guest_limit", "rate_limited", "client_error", "server_error"] as const;
export type LaunchEvent = (typeof EVENTS)[number];
const KEEP_DAYS = 45;

/** Adds one to today's count of an event. Never throws: counting must not break the request it describes. */
export async function count(store: Store | null, event: LaunchEvent, now = Date.now()) {
  if (!store) return;
  try { await store.incr(`stat:${day(now)}:${event}`, KEEP_DAYS * 86_400); } catch { /* counting is best-effort */ }
}

/** Keeps the newest 300 errors for two weeks. Error text and page only, never what someone asked. */
export async function logError(store: Store | null, entry: { source: "client" | "server"; message: string; page?: string; version?: string; path?: string }, now = Date.now()) {
  if (!store) return;
  try { await store.push("errors", JSON.stringify({ ...entry, message: entry.message.slice(0, 500), at: new Date(now).toISOString() }), 300, 14 * 86_400); } catch { /* best-effort */ }
}

/** Daily counts for the last `days` days (newest first) and the latest errors, for the operator. */
export async function readStats(store: Store, days = 14, now = Date.now()) {
  const out: { day: string; counts: Record<string, number> }[] = [];
  for (let i = 0; i < days; i++) {
    const d = day(now - i * 86_400_000);
    const values = await Promise.all(EVENTS.map((e) => store.get(`stat:${d}:${e}`)));
    out.push({ day: d, counts: Object.fromEntries(EVENTS.map((e, j) => [e, Number(values[j] ?? 0)])) });
  }
  const errors = (await store.list("errors")).slice(0, 100).map((raw) => { try { return JSON.parse(raw) as unknown; } catch { return raw; } });
  return { days: out, errors };
}
