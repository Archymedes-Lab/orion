// Prioritize boards kept on the server, for people signed in: a personal board each, and team boards shared by
// invite code. Every change is an operation from src/decision-engine/board.ts, applied to the stored board under a
// short lock, so two people editing at once both land instead of one overwriting the other.
//
// Who may do what: every member reads and edits tasks and goals; only an owner adds or removes members, renames the
// board, sets the Invest budget, invites or deletes it. Account ids never leave the server: a reader sees `me`, the
// id of their own member row, and nothing that links other members to accounts.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Store } from "./store.ts";
import { applyAll, emptyBoard, LIMITS, type Board, type Op } from "../src/decision-engine/board.ts";
import { msg } from "../src/i18n/index.ts";

export const BOARD_ROUTE = /^\/boards\/(list|read|create|ops|invite|join|leave|delete)$/;
export const MAX_BOARD_BYTES = 600_000;
export const MAX_BOARDS = 20;
const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export class BoardError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}

const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const boardId = z.string().regex(/^[A-Za-z0-9_-]{16,40}$/);
const level = z.number().int().min(1).max(5);
const score = z.object({ value: level, origin: z.enum(["user", "ai", "default"]) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const name = z.string().trim().min(1).max(60);
const from = z.union([
  z.object({ kind: z.literal("recurring"), theme: text(60).min(1) }),
  z.object({ kind: z.literal("step"), parentId: id }),
  z.object({ kind: z.literal("decision"), ref: text(100).min(1) }),
]).nullable().optional();
const patch = z.object({
  title: text(LIMITS.title).min(1), notes: text(LIMITS.notes), impact: score, effort: score, urgency: score,
  goalId: id.nullable(), due: day.nullable(), theme: text(60).nullable(), assignee: id.nullable(), blocker: text(400).nullable(), why: text(200).nullable(),
}).partial().strict();
const minutes = z.number().int().min(1).max(24 * 60);

export const OpSchema: z.ZodType<Op> = z.discriminatedUnion("op", [
  z.object({ op: z.literal("task.add"), task: z.object({
    id, title: text(LIMITS.title).min(1), notes: text(LIMITS.notes).optional(), impact: score, effort: score, urgency: score,
    goalId: id.nullable().optional(), due: day.nullable().optional(), theme: text(60).nullable().optional(), assignee: id.nullable().optional(),
    blocker: text(400).nullable().optional(), why: text(200).nullable().optional(), from, postponed: z.number().int().min(0).max(99).optional(),
  }).strict() }),
  z.object({ op: z.literal("task.update"), id, patch }),
  z.object({ op: z.literal("task.done"), id, minutes: minutes.optional() }),
  z.object({ op: z.literal("task.reopen"), id }),
  z.object({ op: z.literal("task.drop"), id }),
  z.object({ op: z.literal("task.postpone"), id }),
  z.object({ op: z.literal("task.log"), id, minutes }),
  z.object({ op: z.literal("task.remove"), id }),
  z.object({ op: z.literal("goals.set"), goals: z.array(z.object({ id, title: text(80).min(1), metric: text(80).optional(), ownerId: id.nullable().optional() }).strict()).max(LIMITS.goals) }),
  z.object({ op: z.literal("member.add"), member: z.object({ id, name, role: text(80).optional(), hoursPerWeek: z.number().min(0).max(80).nullable().optional() }).strict() }),
  z.object({ op: z.literal("member.update"), id, patch: z.object({ name, role: text(80), hoursPerWeek: z.number().min(0).max(80).nullable() }).partial().strict() }),
  z.object({ op: z.literal("member.remove"), id }),
  z.object({ op: z.literal("board.set"), name: name.optional(), investTarget: z.number().min(0).max(100).optional() }),
]) as z.ZodType<Op>;

export const BoardReadRequest = z.object({ boardId });
export const BoardCreateRequest = z.object({ name, you: name });
export const BoardOpsRequest = z.object({ boardId, ops: z.array(OpSchema).min(1).max(50) });
export const BoardInviteRequest = z.object({ boardId, memberId: id.optional() });
export const BoardJoinRequest = z.object({ code: z.string().trim().min(8).max(40), you: name });

const boardKey = (boardId: string) => `board:${boardId}`;
const listKey = (userId: string) => `boards:${userId}`;
const lockKey = (boardId: string) => `lock:board:${boardId}`;
const inviteKey = (code: string) => `invite:${code}`;
const newId = (bytes = 12) => randomBytes(bytes).toString("base64url");

export interface Viewer { id: string; email: string }
export interface BoardSummary { id: string; name: string; kind: Board["kind"]; members: number; open: number; owner: boolean }

/** What a member sees: no account links, plus which member row is theirs. */
export function view(board: Board, viewer: Viewer) {
  const me = board.members.find((m) => m.accountId === viewer.id) ?? null;
  return { board: { ...board, members: board.members.map(({ accountId, ...m }) => ({ ...m, linked: Boolean(accountId) })) }, me: me?.id ?? null };
}

async function readBoard(store: Store, boardId: string): Promise<Board | null> {
  const raw = await store.get(boardKey(boardId));
  return raw ? (JSON.parse(raw) as Board) : null;
}
async function writeBoard(store: Store, board: Board) {
  const json = JSON.stringify(board);
  if (Buffer.byteLength(json) > MAX_BOARD_BYTES) throw new BoardError(413, msg("This board is full. Remove some old tasks first."), "board_full");
  await store.set(boardKey(board.id), json);
}
async function listOf(store: Store, userId: string): Promise<string[]> {
  const raw = await store.get(listKey(userId));
  return raw ? (JSON.parse(raw) as string[]) : [];
}
async function setList(store: Store, userId: string, ids: string[]) { await store.set(listKey(userId), JSON.stringify([...new Set(ids)].slice(0, MAX_BOARDS))); }

/** Runs `work` while holding the board's lock (5 s at most), waiting up to about 3 s for someone else's to clear. */
async function locked<T>(store: Store, boardId: string, work: () => Promise<T>, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await store.setIfAbsent(lockKey(boardId), "1", 5)) {
      try { return await work(); } finally { await store.del(lockKey(boardId)); }
    }
    await wait(100);
  }
  throw new BoardError(409, msg("Someone else is saving this board. Try again in a moment."), "busy");
}

async function memberBoard(store: Store, boardId: string, viewer: Viewer): Promise<Board> {
  const board = await readBoard(store, boardId);
  if (!board || !board.members.some((m) => m.accountId === viewer.id)) throw new BoardError(404, msg("This board doesn't exist or you're not on it."), "not_found");
  return board;
}

/** Everyone gets a personal board the first time they open Prioritize. */
async function ensurePersonal(store: Store, viewer: Viewer, now: number): Promise<string[]> {
  const ids = await listOf(store, viewer.id);
  for (const boardId of ids) {
    const b = await readBoard(store, boardId);
    if (b?.kind === "personal") return ids;
  }
  const board = emptyBoard(newId(), "My priorities", "personal", now, { id: newId(6), name: viewer.email.split("@")[0].slice(0, 60) || "Me", accountId: viewer.id });
  await writeBoard(store, board);
  const next = [board.id, ...ids];
  await setList(store, viewer.id, next);
  return next;
}

export async function boardsRoute(store: Store, action: string, input: unknown, viewer: Viewer, now = Date.now()): Promise<unknown> {
  switch (action) {
    case "list": {
      const ids = await ensurePersonal(store, viewer, now);
      const boards = (await Promise.all(ids.map((i) => readBoard(store, i)))).filter((b): b is Board => !!b && b.members.some((m) => m.accountId === viewer.id));
      // Boards someone was removed from, or that were deleted, drop out of their list.
      if (boards.length !== ids.length) await setList(store, viewer.id, boards.map((b) => b.id));
      return {
        boards: boards.map((b): BoardSummary => ({ id: b.id, name: b.name, kind: b.kind, members: b.members.length, open: b.tasks.filter((t) => t.status === "open").length, owner: b.members.some((m) => m.accountId === viewer.id && m.access === "owner") })),
      };
    }
    case "read": {
      const { boardId } = BoardReadRequest.parse(input);
      return view(await memberBoard(store, boardId, viewer), viewer);
    }
    case "create": {
      const req = BoardCreateRequest.parse(input);
      const ids = await listOf(store, viewer.id);
      if (ids.length >= MAX_BOARDS) throw new BoardError(409, msg("You're on the most boards ORION allows. Leave one first."), "limit");
      const board = emptyBoard(newId(), req.name, "team", now, { id: newId(6), name: req.you, accountId: viewer.id });
      await writeBoard(store, board);
      await setList(store, viewer.id, [...ids, board.id]);
      return view(board, viewer);
    }
    case "ops": {
      const req = BoardOpsRequest.parse(input);
      return locked(store, req.boardId, async () => {
        const board = await memberBoard(store, req.boardId, viewer);
        const actor = board.members.find((m) => m.accountId === viewer.id)!.id;
        const { board: next, skipped } = applyAll(board, req.ops, { now, actor });
        if (next !== board) await writeBoard(store, next);
        return { ...view(next, viewer), skipped };
      });
    }
    case "invite": {
      const req = BoardInviteRequest.parse(input);
      const board = await memberBoard(store, req.boardId, viewer);
      if (board.kind !== "team" || !board.members.some((m) => m.accountId === viewer.id && m.access === "owner")) throw new BoardError(403, msg("Only the board's owner can invite people."), "forbidden");
      if (req.memberId && !board.members.some((m) => m.id === req.memberId && !m.accountId)) throw new BoardError(400, msg("That person already has an account on this board."), "linked");
      const code = newId(9);
      await store.set(inviteKey(code), JSON.stringify({ boardId: board.id, memberId: req.memberId ?? null }), INVITE_TTL_SECONDS);
      return { code, expiresAt: new Date(now + INVITE_TTL_SECONDS * 1000).toISOString() };
    }
    case "join": {
      const req = BoardJoinRequest.parse(input);
      const raw = await store.get(inviteKey(req.code));
      if (!raw) throw new BoardError(404, msg("This invite has expired or was already used."), "invite_gone");
      const invite = JSON.parse(raw) as { boardId: string; memberId: string | null };
      const ids = await listOf(store, viewer.id);
      if (ids.length >= MAX_BOARDS && !ids.includes(invite.boardId)) throw new BoardError(409, msg("You're on the most boards ORION allows. Leave one first."), "limit");
      const joined = await locked(store, invite.boardId, async () => {
        const board = await readBoard(store, invite.boardId);
        if (!board) throw new BoardError(404, msg("This invite has expired or was already used."), "invite_gone");
        if (board.members.some((m) => m.accountId === viewer.id)) return board;
        if (board.members.length >= LIMITS.members) throw new BoardError(409, msg("This board has the most members ORION allows."), "limit");
        const slot = invite.memberId ? board.members.find((m) => m.id === invite.memberId && !m.accountId) : null;
        const members = slot
          ? board.members.map((m) => (m.id === slot.id ? { ...m, accountId: viewer.id } : m))
          : [...board.members, { id: newId(6), name: req.you, accountId: viewer.id, access: "editor" as const }];
        const next = { ...board, members, version: board.version + 1, updatedAt: now };
        await writeBoard(store, next);
        return next;
      });
      await store.del(inviteKey(req.code)); // one invite, one person
      await setList(store, viewer.id, [...ids, joined.id]);
      return view(joined, viewer);
    }
    case "leave": {
      const { boardId } = BoardReadRequest.parse(input);
      await locked(store, boardId, async () => {
        const board = await memberBoard(store, boardId, viewer);
        const me = board.members.find((m) => m.accountId === viewer.id)!;
        if (board.kind === "personal") throw new BoardError(400, msg("Your personal board stays with your account."), "personal");
        if (me.access === "owner" && !board.members.some((m) => m.access === "owner" && m.id !== me.id)) throw new BoardError(400, msg("You own this board. Delete it, or it stays."), "owner");
        await writeBoard(store, { ...board, members: board.members.filter((m) => m.id !== me.id), tasks: board.tasks.map((t) => (t.assignee === me.id ? { ...t, assignee: null } : t)), version: board.version + 1, updatedAt: now });
      });
      await setList(store, viewer.id, (await listOf(store, viewer.id)).filter((i) => i !== boardId));
      return { ok: true };
    }
    case "delete": {
      const { boardId } = BoardReadRequest.parse(input);
      const board = await memberBoard(store, boardId, viewer);
      if (board.kind === "personal") throw new BoardError(400, msg("Your personal board stays with your account."), "personal");
      if (!board.members.some((m) => m.accountId === viewer.id && m.access === "owner")) throw new BoardError(403, msg("Only the board's owner can delete it."), "forbidden");
      await store.del(boardKey(boardId));
      await setList(store, viewer.id, (await listOf(store, viewer.id)).filter((i) => i !== boardId));
      return { ok: true };
    }
  }
  throw new BoardError(404, msg("Not found"));
}

/** Called when an account is deleted: leaves its team boards and removes its personal one. */
export async function forgetBoards(store: Store, userId: string) {
  for (const boardId of await listOf(store, userId)) {
    const board = await readBoard(store, boardId);
    if (!board) continue;
    if (board.kind === "personal" || board.members.every((m) => m.accountId === userId || !m.accountId)) await store.del(boardKey(boardId));
    else {
      // The board outlives the account; if it had no other owner, the longest-standing linked member becomes one.
      const leaving = board.members.find((m) => m.accountId === userId);
      const heir = leaving?.access === "owner" && !board.members.some((m) => m.access === "owner" && m.id !== leaving.id)
        ? board.members.find((m) => m.accountId && m.accountId !== userId) : null;
      await writeBoard(store, { ...board, members: board.members.map((m) => (m.accountId === userId ? { ...m, accountId: null, access: "editor" as const } : m.id === heir?.id ? { ...m, access: "owner" as const } : m)) });
    }
  }
  await store.del(listKey(userId));
}
