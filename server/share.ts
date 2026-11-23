// Friend input: the owner shares a snapshot of a decision (title, options, factors — never the full question text or
// personal context), friends say which option they would pick and what matters most, and only the owner can read
// the answers back. Snapshots expire after 30 days. Nothing here feeds the engine; friends' votes are shown beside
// the comparison, not mixed into it.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Store } from "./store.ts";
import { msg } from "../src/i18n/index.ts";

export const SHARE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAX_RESPONSES = 50;
/** Answers one network may send to one share per hour. */
const RESPONSES_PER_CLIENT = 5;

const id = z.string().trim().min(1).max(100);
const label = z.string().trim().min(1).max(80);
export const ShareCreateRequest = z.object({
  title: z.string().trim().min(1).max(120),
  options: z.array(z.object({ id, label })).min(2).max(4),
  factors: z.array(z.object({ id, label: label.max(40) })).max(8).default([]),
});
export const ShareRespondRequest = z.object({
  optionId: id,
  factorId: id.nullable().optional(),
  name: z.string().trim().max(40).optional(),
  note: z.string().trim().max(280).optional(),
});
export const ShareOwnerRequest = z.object({ ownerKey: z.string().min(20).max(100) });

export class ShareError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

interface Snapshot {
  title: string;
  options: { id: string; label: string }[];
  factors: { id: string; label: string }[];
  ownerHash: string;
  createdAt: string;
  expiresAt: string;
}
export interface ShareResponse { optionId: string; factorId: string | null; name: string; note: string; at: string }

/** `/share/<id>` or `/share/<id>/<action>`; anything else is not a share route. */
export const SHARE_ROUTE = /^\/share(?:\/([A-Za-z0-9_-]{16,40})(?:\/(respond|results|delete))?)?$/;
const key = (shareId: string) => `share:${shareId}`;
const responsesKey = (shareId: string) => `share:${shareId}:responses`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createShare(store: Store, input: z.infer<typeof ShareCreateRequest>, now = new Date()) {
  const unique = (rows: { id: string }[]) => new Set(rows.map((r) => r.id)).size === rows.length;
  if (!unique(input.options) || !unique(input.factors)) throw new ShareError(400, msg("Duplicate option or factor ids"));
  const shareId = randomBytes(12).toString("base64url");
  const ownerKey = randomBytes(24).toString("base64url");
  const snapshot: Snapshot = {
    title: input.title, options: input.options, factors: input.factors, ownerHash: hash(ownerKey),
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + SHARE_TTL_SECONDS * 1000).toISOString(),
  };
  await store.set(key(shareId), JSON.stringify(snapshot), SHARE_TTL_SECONDS);
  return { shareId, ownerKey, expiresAt: snapshot.expiresAt };
}

async function load(store: Store, shareId: string): Promise<Snapshot> {
  const raw = await store.get(key(shareId));
  if (!raw) throw new ShareError(404, msg("This link has expired or was removed by its owner."));
  return JSON.parse(raw) as Snapshot;
}

/** What a friend sees: no owner key, no answers from others. */
export async function readShare(store: Store, shareId: string) {
  const { title, options, factors, expiresAt } = await load(store, shareId);
  return { title, options, factors, expiresAt };
}

export async function respond(store: Store, shareId: string, input: z.infer<typeof ShareRespondRequest>, client: string, now = new Date()) {
  const snapshot = await load(store, shareId);
  if (!snapshot.options.some((o) => o.id === input.optionId)) throw new ShareError(400, msg("Pick one of the options."));
  const factorId = input.factorId ?? null;
  if (factorId !== null && !snapshot.factors.some((f) => f.id === factorId)) throw new ShareError(400, msg("Pick one of the listed factors."));
  if (await store.incr(`share:${shareId}:rate:${hash(client)}`, 3600) > RESPONSES_PER_CLIENT) {
    throw new ShareError(429, msg("Thanks — that is enough answers from here for now."));
  }
  const answer: ShareResponse = { optionId: input.optionId, factorId, name: input.name ?? "", note: input.note ?? "", at: now.toISOString() };
  await store.push(responsesKey(shareId), JSON.stringify(answer), MAX_RESPONSES, SHARE_TTL_SECONDS);
  return { ok: true };
}

async function owned(store: Store, shareId: string, ownerKey: string) {
  const snapshot = await load(store, shareId);
  const a = Buffer.from(snapshot.ownerHash, "hex");
  const b = Buffer.from(hash(ownerKey), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ShareError(403, msg("Only the person who shared this can see the answers."));
  return snapshot;
}

export async function results(store: Store, shareId: string, ownerKey: string) {
  const snapshot = await owned(store, shareId, ownerKey);
  const responses = (await store.list(responsesKey(shareId))).flatMap((raw) => {
    try { return [JSON.parse(raw) as ShareResponse]; } catch { return []; }
  });
  return { title: snapshot.title, expiresAt: snapshot.expiresAt, responses };
}

export async function deleteShare(store: Store, shareId: string, ownerKey: string) {
  await owned(store, shareId, ownerKey);
  await store.del(key(shareId), responsesKey(shareId));
  return { ok: true };
}
