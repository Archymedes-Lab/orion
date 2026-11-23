// Friend input from the app's side: share a decision, read what friends said, stop sharing.
// Only the title, option names and factor names leave the device; the owner key that unlocks the answers stays here.
import { Platform } from "react-native";
import { API_BASE, apiEnabled, request } from "../ai/http.ts";
import { db } from "../db/database.ts";
import type { FriendAnswer } from "./tally.ts";

export interface SharedDecision {
  title: string;
  options: { id: string; label: string }[];
  factors: { id: string; label: string }[];
  expiresAt: string;
}
export type { FriendAnswer, Tally } from "./tally.ts";
export { tally } from "./tally.ts";
export interface ShareLink { shareId: string; ownerKey: string }

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (status: number, body: Record<string, unknown>, fallback: string): { ok: false; error: string } => ({
  ok: false,
  error: status === 0 ? "Could not reach ORION. Check your connection and try again." : typeof body.error === "string" ? body.error : fallback,
});

/** Where a friend opens the share: this site on web, the configured server elsewhere. */
export function shareUrl(shareId: string): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location) return `${window.location.origin}/s/${shareId}`;
  return `${/^https?:\/\//.test(API_BASE) ? API_BASE.replace(/\/$/, "") : ""}/s/${shareId}`;
}

export const sharingPossible = () => apiEnabled();

export async function linkFor(decisionId: string): Promise<ShareLink | null> {
  await db.init();
  const row = await db.get("decision_shares", decisionId);
  return row ? { shareId: String(row.share_id), ownerKey: String(row.owner_key) } : null;
}

export async function shareDecision(decisionId: string, snapshot: Omit<SharedDecision, "expiresAt">): Promise<Outcome<ShareLink>> {
  const { status, body } = await request("POST", "/share", snapshot);
  if (status !== 201 || typeof body.shareId !== "string" || typeof body.ownerKey !== "string") return fail(status, body, "Could not create a link.");
  const link = { shareId: body.shareId, ownerKey: body.ownerKey };
  await db.init();
  await db.upsert("decision_shares", { id: decisionId, share_id: link.shareId, owner_key: link.ownerKey, created_at: new Date().toISOString() });
  return { ok: true, value: link };
}

export async function friendAnswers(link: ShareLink): Promise<Outcome<FriendAnswer[]>> {
  const { status, body } = await request("POST", `/share/${link.shareId}/results`, { ownerKey: link.ownerKey });
  if (status !== 200 || !Array.isArray(body.responses)) return fail(status, body, "Could not load answers.");
  return { ok: true, value: body.responses as FriendAnswer[] };
}

/** Removes the link everywhere. A link that already expired counts as removed. */
export async function stopSharing(decisionId: string, link: ShareLink): Promise<boolean> {
  const { status } = await request("POST", `/share/${link.shareId}/delete`, { ownerKey: link.ownerKey });
  if (status !== 200 && status !== 404) return false;
  await db.deleteWhere("decision_shares", "id", decisionId);
  return true;
}

/** Best effort before erasing: take every link this device made off the server. */
export async function stopAllSharing(): Promise<void> {
  await db.init();
  for (const row of await db.list("decision_shares")) {
    await stopSharing(String(row.id), { shareId: String(row.share_id), ownerKey: String(row.owner_key) }).catch(() => false);
  }
}

export async function openShared(shareId: string): Promise<Outcome<SharedDecision>> {
  const { status, body } = await request("GET", `/share/${encodeURIComponent(shareId)}`);
  if (status !== 200 || !Array.isArray(body.options)) return fail(status, body, "Could not open this decision.");
  return { ok: true, value: body as unknown as SharedDecision };
}

export async function answerShared(shareId: string, answer: { optionId: string; factorId: string | null; name?: string; note?: string }): Promise<Outcome<true>> {
  const { status, body } = await request("POST", `/share/${encodeURIComponent(shareId)}/respond`, answer);
  return status === 200 ? { ok: true, value: true } : fail(status, body, "Could not send your answer.");
}
