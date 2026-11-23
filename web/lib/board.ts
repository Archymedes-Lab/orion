"use client";
// Prioritize in the browser. Signed in, boards live on the server (/boards/*) and are shared with a team; on a server
// without accounts the one personal board stays on this device. Either way every change is an operation from
// src/decision-engine/board.ts: applied here at once, then sent; the server's board replaces ours when it answers,
// with anything still unsent re-applied on top, so typing never waits on the network.
import { useCallback, useEffect, useRef, useState } from "react";
import { msg, t } from "@orion/i18n/index.ts";
import { applyAll, emptyBoard, quadrant, type Board, type Level, type Op, type Task } from "@orion/decision-engine/board.ts";
import type { BusinessProfile } from "@orion/business/schema.ts";
import { api, ApiError } from "./api";

export type ViewMember = Board["members"][number] & { linked?: boolean };
export interface BoardSummary { id: string; name: string; kind: Board["kind"]; members: number; open: number; owner: boolean }
export type Mode = "loading" | "local" | "remote" | "signed_out" | "error";

/** The anchors people see beside each score (the proposal's table, five steps). */
export const ANCHORS: Record<"impact" | "effort" | "urgency", string[]> = {
  impact: [msg("No visible effect on any goal"), msg("Barely moves a goal"), msg("Moves one goal a little"), msg("Clearly moves a goal"), msg("Moves a key goal a lot, or durably")],
  effort: [msg("Under an hour"), msg("A few hours"), msg("One or two days"), msg("Several days"), msg("More than a week")],
  urgency: [msg("No deadline, no cost of waiting"), msg("Due in the coming months"), msg("Due this month"), msg("Due this week"), msg("Due today, or waiting costs something every day")],
};

export const today = (now = Date.now()) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysUntil = (due: string, now = Date.now()) => Math.round((Date.parse(`${due}T12:00:00`) - Date.parse(`${today(now)}T12:00:00`)) / 86_400_000);
/** Before anyone has scored a task, its deadline is the only honest signal of urgency. */
export function urgencyFromDue(due: string | null | undefined, now = Date.now()): Level {
  if (!due) return 2;
  const d = daysUntil(due, now);
  return d <= 0 ? 5 : d <= 7 ? 4 : d <= 31 ? 3 : 2;
}
export function dueLabel(due: string | null | undefined, now = Date.now()): string | null {
  if (!due) return null;
  const d = daysUntil(due, now);
  if (d < 0) return t("Overdue");
  if (d === 0) return t("Due today");
  if (d === 1) return t("Due tomorrow");
  if (d < 7) return t("Due {day}", { day: new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" }) });
  return t("Due {date}", { date: new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
}

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Math.random().toString(36).slice(2, 18));

// ── Device storage for the local board ─────────────────────────────────────────────────────────────────────────

const LOCAL_KEY = "orion.web.board.v1";
function readLocal(): Board {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw) as Board;
  } catch { /* private mode: start fresh */ }
  return emptyBoard("local", "My priorities", "personal", Date.now());
}
function writeLocal(board: Board) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(board)); } catch { /* full or private: keep it in memory */ }
}

// ── The hook ───────────────────────────────────────────────────────────────────────────────────────────────────

interface State { mode: Mode; boards: BoardSummary[]; board: Board | null; me: string | null; error: string | null; saving: boolean }
type Served = { board: Board; me: string | null; skipped?: { index: number; code: string }[] };

const explain = (e: unknown) => (e instanceof ApiError ? e.message : t("ORION’s server can’t be reached right now."));

export function useBoards(initialId?: string | null) {
  const [state, setState] = useState<State>({ mode: "loading", boards: [], board: null, me: null, error: null, saving: false });
  const base = useRef<Board | null>(null); // the last board the server confirmed
  const queue = useRef<Op[]>([]); // applied here, not yet confirmed
  const sending = useRef(false);
  const mode = useRef<Mode>("loading");
  const me = useRef<string | null>(null);

  const show = useCallback((served: Served) => {
    base.current = served.board;
    me.current = served.me;
    const board = queue.current.length ? applyAll(served.board, queue.current, { now: Date.now(), actor: served.me }).board : served.board;
    setState((s) => ({ ...s, board, me: served.me }));
  }, []);

  const open = useCallback(async (boardId: string) => {
    try {
      queue.current = [];
      show(await api<Served>("boards/read", { boardId }));
      try { localStorage.setItem("orion.web.board.last", boardId); } catch { /* fine */ }
    } catch (e) { setState((s) => ({ ...s, error: explain(e) })); }
  }, [show]);

  const refreshList = useCallback(async () => {
    const { boards } = await api<{ boards: BoardSummary[] }>("boards/list", {});
    setState((s) => ({ ...s, boards }));
    return boards;
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const boards = await refreshList();
        if (!live) return;
        mode.current = "remote";
        setState((s) => ({ ...s, mode: "remote" }));
        let last: string | null = null;
        try { last = localStorage.getItem("orion.web.board.last"); } catch { /* fine */ }
        const pick = boards.find((b) => b.id === initialId) ?? boards.find((b) => b.id === last) ?? boards.find((b) => b.kind === "personal") ?? boards[0];
        if (pick) await open(pick.id);
      } catch (e) {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) {
          mode.current = "local";
          const board = readLocal();
          base.current = board;
          setState((s) => ({ ...s, mode: "local", board, me: null, boards: [] }));
        } else if (e instanceof ApiError && e.status === 401) {
          mode.current = "signed_out";
          setState((s) => ({ ...s, mode: "signed_out" }));
        } else {
          mode.current = "error";
          setState((s) => ({ ...s, mode: "error", error: explain(e) }));
        }
      }
    })();
    return () => { live = false; };
  }, [initialId, open, refreshList]);

  const flush = useCallback(async () => {
    if (sending.current || !queue.current.length || !base.current) return;
    sending.current = true;
    setState((s) => ({ ...s, saving: true }));
    const batch = queue.current.slice(0, 50);
    try {
      const served = await api<Served>("boards/ops", { boardId: base.current.id, ops: batch });
      queue.current = queue.current.slice(batch.length);
      show(served);
      if (served.skipped?.some((x) => x.code === "forbidden")) setState((s) => ({ ...s, error: t("Only the board’s owner can change that.") }));
    } catch (e) {
      // A rejected batch is dropped and the server's board shown again, so the screen never lies about what is saved.
      queue.current = queue.current.slice(batch.length);
      setState((s) => ({ ...s, error: explain(e) }));
      if (base.current) show({ board: base.current, me: me.current });
    } finally {
      sending.current = false;
      setState((s) => ({ ...s, saving: queue.current.length > 0 }));
      if (queue.current.length) void flush();
    }
  }, [show]);

  /** Apply operations now; save them in the background. Returns false when one could not apply here. */
  const dispatch = useCallback((...ops: Op[]): boolean => {
    let ok = true;
    setState((s) => {
      if (!s.board) return s;
      const { board, skipped } = applyAll(s.board, ops, { now: Date.now(), actor: s.me });
      if (skipped.length) ok = false;
      if (mode.current === "local") { writeLocal(board); base.current = board; }
      return { ...s, board, error: skipped.some((x) => x.code === "forbidden") ? t("Only the board’s owner can change that.") : skipped.some((x) => x.code === "limit") ? t("This board has reached its limit.") : s.error };
    });
    if (mode.current === "remote") { queue.current.push(...ops); void flush(); }
    return ok;
  }, [flush]);

  // A team board picks up teammates' changes every 15 seconds while the page is in view.
  const boardId = state.board?.id;
  const shared = state.board?.kind === "team";
  useEffect(() => {
    if (mode.current !== "remote" || !boardId || !shared) return;
    const tick = () => {
      if (document.visibilityState !== "visible" || sending.current || queue.current.length) return;
      api<Served>("boards/read", { boardId }).then(show).catch(() => { /* next tick */ });
    };
    const id = setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [boardId, shared, show]);

  const action = useCallback(async <T,>(path: string, body: unknown): Promise<T> => {
    try { return await api<T>(path, body); }
    catch (e) { setState((s) => ({ ...s, error: explain(e) })); throw e; }
  }, []);

  return {
    ...state,
    dispatch,
    open,
    clearError: () => setState((s) => ({ ...s, error: null })),
    async create(name: string, you: string) { const served = await action<Served>("boards/create", { name, you }); await refreshList(); queue.current = []; show(served); return served.board; },
    async invite(memberId?: string) { return action<{ code: string; expiresAt: string }>("boards/invite", { boardId, memberId }); },
    async join(code: string, you: string) { const served = await action<Served>("boards/join", { code, you }); await refreshList(); queue.current = []; show(served); return served.board; },
    async leave() { await action("boards/leave", { boardId }); const boards = await refreshList(); const next = boards.find((b) => b.kind === "personal") ?? boards[0]; if (next) await open(next.id); },
    async remove() { await action("boards/delete", { boardId }); const boards = await refreshList(); const next = boards.find((b) => b.kind === "personal") ?? boards[0]; if (next) await open(next.id); },
  };
}

// ── The AI's proposals ─────────────────────────────────────────────────────────────────────────────────────────

export interface Proposal { id: string; impact: Level; effort: Level; urgency: Level; goalId: string | null; theme: string | null; why: string | null }

export async function proposeScores(tasks: Pick<Task, "id" | "title" | "notes" | "due">[], board: Board, company: BusinessProfile | null): Promise<{ tasks: Proposal[]; judge: "typesafe" | "ai" }> {
  try {
    return await api("tasks/score", {
      tasks: tasks.slice(0, 12).map((x) => ({ id: x.id, title: x.title, notes: x.notes || undefined, due: x.due ?? null })),
      goals: board.goals.map(({ id, title, metric }) => ({ id, title, metric: metric || undefined })),
      today: today(),
      business: company && Object.keys(company).length ? company : undefined,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) throw new Error(t("ORION won’t score this one. If you’re going through something hard, please reach out to someone you trust or a local helpline."));
    throw new Error(error instanceof ApiError && error.status !== 503 ? error.message : t("ORION can’t propose scores right now. Set them yourself, or try again shortly."));
  }
}

export async function splitIntoSteps(task: Task, board: Board, company: BusinessProfile | null) {
  try {
    return await api<{ steps: { title: string; impact: Level; effort: Level; urgency: Level }[] }>("tasks/split", {
      task: { title: task.title, notes: task.notes || undefined, blocker: task.blocker ?? null },
      goals: board.goals.map(({ id, title, metric }) => ({ id, title, metric: metric || undefined })),
      today: today(),
      business: company && Object.keys(company).length ? company : undefined,
    });
  } catch {
    throw new Error(t("ORION can’t split this task right now. Try again shortly."));
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────────────────────────────────────

const QUADRANT_NAMES = { act: msg("Act now"), invest: msg("Invest"), contain: msg("Contain"), drop: msg("Drop") } as const;
export const quadrantName = (q: keyof typeof QUADRANT_NAMES) => t(QUADRANT_NAMES[q]);

/** Every task as CSV (open first), for a spreadsheet or a weekly review. */
export function toCSV(board: Board): string {
  const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const goal = (id?: string | null) => board.goals.find((g) => g.id === id)?.title ?? "";
  const member = (id?: string | null) => board.members.find((m) => m.id === id)?.name ?? "";
  const head = [t("Task"), t("Box"), t("Impact"), t("Effort"), t("Urgency"), t("Goal"), t("Owner"), t("Deadline"), t("Status"), t("Postponed"), t("Minutes logged"), t("Cause")];
  const rows = [...board.tasks].sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open")).map((x) => [
    x.title, quadrantName(quadrant(x)), x.impact.value, x.effort.value, x.urgency.value, goal(x.goalId), member(x.assignee), x.due ?? "",
    x.status === "open" ? t("Open") : x.status === "done" ? t("Done") : t("Dropped"), x.postponed, x.log.reduce((a, l) => a + l.minutes, 0), x.theme ?? "",
  ]);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

/** A calendar block for an Invest task: the next weekday at 9:00, as long as the work (capped at three hours). */
export function toICS(task: Task, now = Date.now()): string {
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  while (start.getDay() === 0 || start.getDay() === 6) start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const hours = Math.min(3, [0.75, 2, 3, 3, 3][task.effort.value - 1]);
  const end = new Date(start.getTime() + hours * 3_600_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ORION//Prioritize//EN", "BEGIN:VEVENT", `UID:${task.id}-${start.getTime()}@orion`, `DTSTAMP:${stamp(new Date(now))}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(t("Invest: {task}", { task: task.title }))}`,
    `DESCRIPTION:${esc(t("Protected time from ORION Prioritize. Not urgent, but it grows what matters."))}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

export function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Adds one task to the board used last (else the personal one) from another screen, such as a decision's verdict.
 * It arrives unscored and waits in "Not scored yet", so nothing is guessed on the person's behalf.
 */
export async function addToBoard(task: { title: string; notes?: string; from: Task["from"] }): Promise<void> {
  const op: Op = { op: "task.add", task: {
    id: newId(), title: task.title.slice(0, 120), notes: task.notes?.slice(0, 600), from: task.from,
    impact: { value: 3, origin: "default" }, effort: { value: 3, origin: "default" }, urgency: { value: 2, origin: "default" },
  } };
  try {
    const { boards } = await api<{ boards: BoardSummary[] }>("boards/list", {});
    let last: string | null = null;
    try { last = localStorage.getItem("orion.web.board.last"); } catch { /* fine */ }
    const target = boards.find((b) => b.id === last) ?? boards.find((b) => b.kind === "personal") ?? boards[0];
    if (!target) throw new Error(t("Boards are unavailable right now. Try again shortly."));
    await api("boards/ops", { boardId: target.id, ops: [op] });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e instanceof ApiError ? new Error(e.message) : e;
    // No accounts on this server: the board lives on this device.
    const board = readLocal();
    writeLocal(applyAll(board, [op], { now: Date.now(), actor: null }).board);
  }
}
