// Prioritize: one 2×2 that merges the Eisenhower matrix (urgency) with the leverage matrix (impact ÷ effort).
// The proposal is "Orion combined prioritization tool (Eisenhower × Leverage)": the AI proposes three scores per task,
// the person confirms them, and this file places the task with rules that fit in one sentence:
//
//   urgent         = urgency 4 or 5
//   high leverage  = impact 4 or 5 (big bets stay visible), or impact 3 with effort 1 or 2 (quick wins)
//   order in a box = impact ÷ effort, highest first; ties go to the nearest deadline
//
//                     urgent        not urgent
//   high leverage     Act now       Invest        ← the box founders sacrifice; Orion protects it with a time budget
//   low leverage      Contain       Drop
//
// Beyond placement it finds what a matrix alone does not: urgencies that keep coming back (fix the cause: an Invest
// task), how much of the week went to Invest against the budget, high-leverage work that keeps slipping, everything
// rated top (score gaming), and for teams who could take a Contain task and who is over capacity.
//
// Pure: the clock, ids and the acting member are passed in, so the browser and the server apply the same operations
// to the same board and get the same result.

export type Level = 1 | 2 | 3 | 4 | 5;
/** Who set a score: the person, the AI's proposal, or a placeholder because nothing proposed one yet. */
export type Origin = "user" | "ai" | "default";
export interface Score { value: Level; origin: Origin }
export type Quadrant = "act" | "invest" | "contain" | "drop";
export const QUADRANTS: Quadrant[] = ["act", "invest", "contain", "drop"];

export interface Goal { id: string; title: string; /** How the team will know it moved, e.g. "3 signed pilots". */ metric?: string; ownerId?: string | null }
export interface Member {
  id: string;
  name: string;
  /** What they do, in their own words; delegation suggestions match it against task titles. */
  role?: string;
  /** Hours a week they can give to the board's work; enables the overload check. */
  hoursPerWeek?: number | null;
  /** Linked ORION account (server side only ever compares it, never shows it). */
  accountId?: string | null;
  access: "owner" | "editor";
}
export interface TimeLog { at: number; minutes: number; quadrant: Quadrant; by?: string | null }
export interface Task {
  id: string;
  title: string;
  notes?: string;
  impact: Score;
  effort: Score;
  urgency: Score;
  goalId?: string | null;
  /** YYYY-MM-DD. */
  due?: string | null;
  /** A short label for the cause of an urgency ("invoicing errors"); repeated themes become a recurring urgency. */
  theme?: string | null;
  assignee?: string | null;
  status: "open" | "done" | "dropped";
  createdAt: number;
  closedAt?: number | null;
  postponed: number;
  /** What the person says is blocking it, when asked. */
  blocker?: string | null;
  /** The AI's one-line reason for its proposal. */
  why?: string | null;
  /** Where it came from: a recurring urgency, a step of a bigger task, or an ORION decision. */
  from?: { kind: "recurring"; theme: string } | { kind: "step"; parentId: string } | { kind: "decision"; ref: string } | null;
  log: TimeLog[];
}
export interface Board {
  id: string;
  name: string;
  kind: "personal" | "team";
  goals: Goal[];
  members: Member[];
  tasks: Task[];
  /** Share of logged time the board aims to spend on Invest, 0–100. */
  investTarget: number;
  version: number;
  updatedAt: number;
}

export const LIMITS = { goals: 5, members: 50, tasks: 400, logPerTask: 200, title: 120, notes: 600 } as const;
/** Done and dropped tasks stay this long, so recurring urgencies and the weekly Invest share have history. */
export const KEEP_CLOSED_MS = 90 * 86_400_000;
export const DAY = 86_400_000;
export const RECURRING_WINDOW_MS = 30 * DAY;
export const RECURRING_MIN = 3;
export const POSTPONED_MIN = 3;
/** Typical hours per effort level (the anchors: under an hour · a few hours · one or two days · several days · over a week). */
export const EFFORT_HOURS: Record<Level, number> = { 1: 0.75, 2: 3, 3: 12, 4: 28, 5: 50 };

// ── Placement ──────────────────────────────────────────────────────────────────────────────────────────────────

export const isUrgent = (t: Pick<Task, "urgency">) => t.urgency.value >= 4;
/** Why a task is high leverage, or null when it is not. */
export function leverageBy(t: Pick<Task, "impact" | "effort">): "impact" | "quick_win" | null {
  if (t.impact.value >= 4) return "impact";
  if (t.impact.value === 3 && t.effort.value <= 2) return "quick_win";
  return null;
}
export function quadrant(t: Pick<Task, "impact" | "effort" | "urgency">): Quadrant {
  const high = leverageBy(t) !== null;
  return isUrgent(t) ? (high ? "act" : "contain") : high ? "invest" : "drop";
}
export const ratio = (t: Pick<Task, "impact" | "effort">) => t.impact.value / t.effort.value;

/** Impact ÷ effort, highest first; then the nearest deadline (none last); then the oldest. Stable for equal tasks. */
export function compareTasks(a: Task, b: Task): number {
  return ratio(b) - ratio(a)
    || (a.due ?? "9999-12-31").localeCompare(b.due ?? "9999-12-31")
    || a.createdAt - b.createdAt
    || a.id.localeCompare(b.id);
}

/** The structured reason for a placement; the interface turns it into one sentence. */
export interface Placement {
  quadrant: Quadrant;
  urgent: boolean;
  leverage: "impact" | "quick_win" | null;
  impact: Level; effort: Level; urgency: Level;
  goal: Goal | null;
  /** Which way a one-point change would move it, so the sentence can say how close to the line it is. */
  edge: { urgency: boolean; impact: boolean; effort: boolean };
}
export function placement(t: Task, goals: Goal[] = []): Placement {
  const q = quadrant(t);
  const moved = (patch: Partial<Pick<Task, "impact" | "effort" | "urgency">>) => quadrant({ ...t, ...patch }) !== q;
  const step = (s: Score, d: number) => ({ ...s, value: Math.max(1, Math.min(5, s.value + d)) as Level });
  return {
    quadrant: q, urgent: isUrgent(t), leverage: leverageBy(t),
    impact: t.impact.value, effort: t.effort.value, urgency: t.urgency.value,
    goal: goals.find((g) => g.id === t.goalId) ?? null,
    edge: {
      urgency: moved({ urgency: step(t.urgency, 1) }) || moved({ urgency: step(t.urgency, -1) }),
      impact: moved({ impact: step(t.impact, 1) }) || moved({ impact: step(t.impact, -1) }),
      effort: moved({ effort: step(t.effort, 1) }) || moved({ effort: step(t.effort, -1) }),
    },
  };
}

export const isOpen = (t: Task) => t.status === "open";
/** Open tasks per quadrant, each in its order. */
export function arrange(tasks: Task[]): Record<Quadrant, Task[]> {
  const out: Record<Quadrant, Task[]> = { act: [], invest: [], contain: [], drop: [] };
  for (const t of tasks) if (isOpen(t)) out[quadrant(t)].push(t);
  for (const q of QUADRANTS) out[q].sort(compareTasks);
  return out;
}

// ── Insights ───────────────────────────────────────────────────────────────────────────────────────────────────

const STOP = new Set("a an the and or of to for in on at by with from up out again new our my your their this that is are be fix follow check about re".split(" "));
/** A crude English stem, so "invoice", "invoices" and "invoicing" meet; other scripts pass through. */
export function stem(w: string): string {
  if (!/^[a-z]+$/.test(w)) return w;
  for (const [suffix, min] of [["ing", 6], ["ed", 5], ["es", 5], ["s", 5], ["e", 5]] as const) if (w.length >= min && w.endsWith(suffix) && !w.endsWith("ss")) return w.slice(0, -suffix.length);
  return w;
}
const tokens = (text: string) => text.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
/** Content words of a title, lower-cased and stemmed, numbers and stop words removed. */
export function words(text: string): string[] {
  return [...new Set(tokens(text).map(stem))];
}
const shared = (a: string[], b: string[]) => { const B = new Set(b); return a.filter((w) => B.has(w)); };
/** Two titles are about the same thing when they share two content words making up half of the shorter one (or its only word). */
const similar = (a: string[], b: string[]) => {
  const n = shared(a, b).length, short = Math.min(a.length, b.length);
  return n >= 2 ? n / short >= 0.5 : n === 1 && short === 1;
};
const overlap = (a: string[], b: string[]) => (a.length && b.length ? shared(a, b).length / Math.min(a.length, b.length) : 0);
export const normalTheme = (theme: string) => theme.trim().toLowerCase().normalize("NFKC").replace(/\s+/g, " ");

export interface Recurring {
  theme: string;
  tasks: Task[];
  /** Logged hours, or the effort anchors where nothing was logged. */
  hours: number;
  estimated: boolean;
  /** An open task already fixing the cause. */
  fix: Task | null;
}
/**
 * Urgencies that came back: urgent tasks created in the last 30 days, grouped by their theme (set by the AI or the
 * person), or, without one, by titles that share most of their words. Three or more in a group is a pattern.
 */
export function recurring(board: Pick<Board, "tasks">, now: number): Recurring[] {
  const fires = board.tasks.filter((t) => isUrgent(t) && t.status !== "dropped" && now - t.createdAt <= RECURRING_WINDOW_MS && t.from?.kind !== "recurring");
  // A task joins a group when it is about the same thing as one of the tasks already in it (single link).
  const groups: { theme: string | null; tasks: Task[]; stems: string[][] }[] = [];
  for (const t of [...fires].sort((a, b) => a.createdAt - b.createdAt)) {
    const theme = t.theme ? normalTheme(t.theme) : null;
    const w = words(t.title);
    const g = theme ? groups.find((x) => x.theme === theme) : groups.find((x) => x.theme === null && x.stems.some((y) => similar(y, w)));
    if (g) { g.tasks.push(t); g.stems.push(w); }
    else groups.push({ theme, tasks: [t], stems: [w] });
  }
  return groups.filter((g) => g.tasks.length >= RECURRING_MIN).map((g) => ({ ...g, theme: g.theme ?? label(g.tasks) })).map((g) => {
    const all = new Set(g.stems.flat());
    const hours = g.tasks.reduce((a, t) => a + (t.log.length ? t.log.reduce((m, l) => m + l.minutes, 0) / 60 : EFFORT_HOURS[t.effort.value]), 0);
    // The fix was named after the group when it was made; the group may have grown since, so match on its words too.
    const fix = board.tasks.find((t) => {
      if (!isOpen(t) || t.from?.kind !== "recurring") return false;
      const w = words(t.from.theme);
      return normalTheme(t.from.theme) === normalTheme(g.theme) || (w.length > 0 && w.filter((x) => all.has(x)).length >= Math.min(2, w.length));
    }) ?? null;
    return { theme: g.theme, tasks: g.tasks, hours, estimated: g.tasks.some((t) => t.log.length === 0), fix };
  }).sort((a, b) => b.tasks.length - a.tasks.length || b.hours - a.hours);
}

/** An untagged group's label: the words most of its titles share (in the first title's wording), else the first title. */
function label(tasks: Task[]): string {
  const count = new Map<string, number>(), surface = new Map<string, string>();
  tasks.forEach((t) => { for (const w of new Set(tokens(t.title))) { const s = stem(w); if (!surface.has(s)) surface.set(s, w); } for (const s of words(t.title)) count.set(s, (count.get(s) ?? 0) + 1); });
  const order = [...surface.keys()];
  const common = order.filter((s) => (count.get(s) ?? 0) >= Math.max(2, Math.ceil(tasks.length * 0.6))).slice(0, 3);
  return common.length ? common.map((s) => surface.get(s)!).join(" ") : tasks[0].title.trim();
}

/** Monday 00:00 (UTC) of the week holding `now`. Boards are small teams in one place; UTC weeks keep server and browser equal. */
export function weekStart(now: number): number {
  const day = Math.floor(now / DAY);
  const weekday = (day + 3) % 7; // 1970-01-01 was a Thursday; 0 = Monday
  return (day - weekday) * DAY;
}
export interface InvestShare { minutes: number; invest: number; share: number; target: number; byQuadrant: Record<Quadrant, number> }
/** How this week's logged time split across the quadrants, and the Invest share against the board's target. */
export function investShare(board: Pick<Board, "tasks" | "investTarget">, now: number, memberId?: string | null): InvestShare {
  const from = weekStart(now);
  const byQuadrant: Record<Quadrant, number> = { act: 0, invest: 0, contain: 0, drop: 0 };
  for (const t of board.tasks) for (const l of t.log) if (l.at >= from && l.at <= now && (memberId === undefined || l.by === memberId)) byQuadrant[l.quadrant] += l.minutes;
  const minutes = QUADRANTS.reduce((a, q) => a + byQuadrant[q], 0);
  return { minutes, invest: byQuadrant.invest, share: minutes ? byQuadrant.invest / minutes : 0, target: board.investTarget / 100, byQuadrant };
}

/** High-leverage work that keeps slipping, most postponed first. */
export const slipping = (tasks: Task[]) =>
  tasks.filter((t) => isOpen(t) && t.postponed >= POSTPONED_MIN && leverageBy(t) !== null).sort((a, b) => b.postponed - a.postponed || compareTasks(a, b));

/** "If everything is rated 5, nothing is prioritized": which score most open tasks share at the top, if any. */
export function inflated(tasks: Task[]): { score: "impact" | "urgency"; share: number } | null {
  const open = tasks.filter(isOpen);
  if (open.length < 5) return null;
  for (const score of ["impact", "urgency"] as const) {
    const share = open.filter((t) => t[score].value === 5).length / open.length;
    if (share >= 0.6) return { score, share };
  }
  return null;
}

/** Hours of open work assigned to each member (effort anchors), against their weekly hours. */
export function load(board: Pick<Board, "tasks" | "members">): { member: Member; hours: number; over: boolean }[] {
  return board.members.map((member) => {
    const hours = board.tasks.filter((t) => isOpen(t) && t.assignee === member.id && quadrant(t) !== "drop").reduce((a, t) => a + EFFORT_HOURS[t.effort.value], 0);
    return { member, hours, over: member.hoursPerWeek != null && member.hoursPerWeek > 0 && hours > member.hoursPerWeek };
  });
}

/**
 * Who could take a Contain task: someone other than the person asking, whose role shares words with the task,
 * else the one with the most spare hours. Null on a board of one, where the advice becomes "automate or simplify".
 */
export function delegateTo(board: Pick<Board, "tasks" | "members">, task: Task, self?: string | null): { member: Member; because: "role" | "capacity" } | null {
  const others = load(board).filter((x) => x.member.id !== self && x.member.id !== task.assignee);
  if (!others.length) return null;
  const w = words(`${task.title} ${task.theme ?? ""}`);
  const spare = (x: { member: Member; hours: number }) => (x.member.hoursPerWeek ?? 40) - x.hours;
  const byRole = others.map((x) => ({ x, fit: x.member.role ? overlap(words(x.member.role), w) : 0 })).filter((r) => r.fit > 0 && !r.x.over)
    .sort((a, b) => b.fit - a.fit || spare(b.x) - spare(a.x));
  if (byRole[0]) return { member: byRole[0].x.member, because: "role" };
  const free = others.filter((x) => !x.over).sort((a, b) => spare(b) - spare(a) || a.member.name.localeCompare(b.member.name));
  return free[0] ? { member: free[0].member, because: "capacity" } : null;
}

/** Progress per goal: open high-leverage tasks pointing at it, and tasks done for it this week. */
export function goalProgress(board: Pick<Board, "tasks" | "goals">, now: number) {
  const from = weekStart(now);
  return board.goals.map((goal) => {
    const mine = board.tasks.filter((t) => t.goalId === goal.id);
    return {
      goal,
      open: mine.filter(isOpen).length,
      leverage: mine.filter((t) => isOpen(t) && leverageBy(t) !== null).length,
      doneThisWeek: mine.filter((t) => t.status === "done" && (t.closedAt ?? 0) >= from).length,
    };
  });
}
/** Open tasks that point at no goal while goals exist: their impact cannot be anchored. */
export const unanchored = (board: Pick<Board, "tasks" | "goals">) => (board.goals.length ? board.tasks.filter((t) => isOpen(t) && !board.goals.some((g) => g.id === t.goalId)) : []);

// ── Operations ─────────────────────────────────────────────────────────────────────────────────────────────────
// Every change to a board is one of these. The browser applies them at once (optimistic) and, for a shared board,
// the server applies the same ones to the stored board under a lock, so concurrent edits merge instead of overwrite.

export type TaskPatch = Partial<Pick<Task, "title" | "notes" | "impact" | "effort" | "urgency" | "goalId" | "due" | "theme" | "assignee" | "blocker" | "why">>;
export type Op =
  | { op: "task.add"; task: Omit<Task, "status" | "createdAt" | "postponed" | "log" | "closedAt"> & Partial<Pick<Task, "postponed">> }
  | { op: "task.update"; id: string; patch: TaskPatch }
  | { op: "task.done"; id: string; minutes?: number }
  | { op: "task.reopen"; id: string }
  | { op: "task.drop"; id: string }
  | { op: "task.postpone"; id: string }
  | { op: "task.log"; id: string; minutes: number }
  | { op: "task.remove"; id: string }
  | { op: "goals.set"; goals: Goal[] }
  | { op: "member.add"; member: Omit<Member, "access" | "accountId"> }
  | { op: "member.update"; id: string; patch: Partial<Pick<Member, "name" | "role" | "hoursPerWeek">> }
  | { op: "member.remove"; id: string }
  | { op: "board.set"; name?: string; investTarget?: number };

export class OpError extends Error {
  constructor(public readonly code: "not_found" | "limit" | "forbidden" | "invalid", message: string) { super(message); }
}

export interface OpContext {
  now: number;
  /** The member acting, for time logs and permission checks; null on a personal board kept on one device. */
  actor?: string | null;
}

// Civil date ↔ day number (Howard Hinnant's algorithm), so moving a due date needs no Date object.
export function dayNumber(date: string): number {
  const [y0, m, d] = date.split("-").map(Number);
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400), yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}
export function dateOf(days: number): string {
  const z = days + 719468, era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153), d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const addDays = (date: string, days: number) => dateOf(dayNumber(date) + days);

/** Applies one operation, returning a new board. Throws OpError when it cannot apply. */
export function apply(board: Board, op: Op, ctx: OpContext): Board {
  const actorMember = board.members.find((m) => m.id === ctx.actor) ?? null;
  const owner = board.kind === "personal" || actorMember?.access === "owner";
  const task = (id: string) => {
    const t = board.tasks.find((x) => x.id === id);
    if (!t) throw new OpError("not_found", "task");
    return t;
  };
  const withTask = (id: string, change: (t: Task) => Task): Board => {
    task(id);
    return { ...board, tasks: board.tasks.map((t) => (t.id === id ? change(t) : t)) };
  };
  const logged = (t: Task, minutes: number): Task => ({
    ...t, log: [...t.log, { at: ctx.now, minutes: Math.round(minutes), quadrant: quadrant(t), by: ctx.actor ?? null }].slice(-LIMITS.logPerTask),
  });
  const known = (memberId: string | null | undefined) => memberId == null || board.members.some((m) => m.id === memberId);
  const goalKnown = (goalId: string | null | undefined) => goalId == null || board.goals.some((g) => g.id === goalId);

  let next: Board;
  switch (op.op) {
    case "task.add": {
      if (board.tasks.some((t) => t.id === op.task.id)) return board; // a retried add is a no-op
      if (board.tasks.filter(isOpen).length >= LIMITS.tasks) throw new OpError("limit", "tasks");
      if (!known(op.task.assignee) || !goalKnown(op.task.goalId)) throw new OpError("invalid", "reference");
      next = { ...board, tasks: [...board.tasks, { ...op.task, status: "open", createdAt: ctx.now, postponed: op.task.postponed ?? 0, log: [], closedAt: null }] };
      break;
    }
    case "task.update":
      if (!known(op.patch.assignee) || !goalKnown(op.patch.goalId)) throw new OpError("invalid", "reference");
      next = withTask(op.id, (t) => ({ ...t, ...op.patch }));
      break;
    case "task.done":
      next = withTask(op.id, (t) => ({ ...(op.minutes ? logged(t, op.minutes) : t), status: "done", closedAt: ctx.now }));
      break;
    case "task.reopen":
      next = withTask(op.id, (t) => ({ ...t, status: "open", closedAt: null }));
      break;
    case "task.drop":
      next = withTask(op.id, (t) => ({ ...t, status: "dropped", closedAt: ctx.now }));
      break;
    case "task.postpone":
      next = withTask(op.id, (t) => ({ ...t, postponed: t.postponed + 1, due: t.due ? addDays(t.due, 7) : t.due }));
      break;
    case "task.log":
      next = withTask(op.id, (t) => logged(t, op.minutes));
      break;
    case "task.remove":
      task(op.id);
      next = { ...board, tasks: board.tasks.filter((t) => t.id !== op.id) };
      break;
    case "goals.set": {
      if (op.goals.length > LIMITS.goals) throw new OpError("limit", "goals");
      const ids = new Set(op.goals.map((g) => g.id));
      // A removed goal leaves its tasks unanchored rather than pointing at nothing.
      next = { ...board, goals: op.goals, tasks: board.tasks.map((t) => (t.goalId && !ids.has(t.goalId) ? { ...t, goalId: null } : t)) };
      break;
    }
    case "member.add":
      if (!owner) throw new OpError("forbidden", "member");
      if (board.members.length >= LIMITS.members) throw new OpError("limit", "members");
      if (board.members.some((m) => m.id === op.member.id)) return board;
      next = { ...board, members: [...board.members, { ...op.member, access: "editor", accountId: null }] };
      break;
    case "member.update":
      if (!owner && op.id !== ctx.actor) throw new OpError("forbidden", "member");
      if (!board.members.some((m) => m.id === op.id)) throw new OpError("not_found", "member");
      next = { ...board, members: board.members.map((m) => (m.id === op.id ? { ...m, ...op.patch } : m)) };
      break;
    case "member.remove": {
      const m = board.members.find((x) => x.id === op.id);
      if (!m) throw new OpError("not_found", "member");
      if ((!owner && op.id !== ctx.actor) || m.access === "owner") throw new OpError("forbidden", "member");
      next = { ...board, members: board.members.filter((x) => x.id !== op.id), tasks: board.tasks.map((t) => (t.assignee === op.id ? { ...t, assignee: null } : t)) };
      break;
    }
    case "board.set":
      if (!owner) throw new OpError("forbidden", "board");
      next = { ...board, name: op.name ?? board.name, investTarget: op.investTarget === undefined ? board.investTarget : Math.max(0, Math.min(100, Math.round(op.investTarget))) };
      break;
  }
  return prune({ ...next, version: board.version + 1, updatedAt: ctx.now }, ctx.now);
}

/** Applies operations in order; one that cannot apply (a task someone else just removed) is skipped, not fatal. */
export function applyAll(board: Board, ops: Op[], ctx: OpContext): { board: Board; skipped: { index: number; code: OpError["code"] }[] } {
  const skipped: { index: number; code: OpError["code"] }[] = [];
  let b = board;
  ops.forEach((op, index) => {
    try { b = apply(b, op, ctx); }
    catch (e) { if (e instanceof OpError) skipped.push({ index, code: e.code }); else throw e; }
  });
  return { board: b, skipped };
}

/** Closed tasks older than 90 days leave the board. */
export function prune(board: Board, now: number): Board {
  const keep = board.tasks.filter((t) => isOpen(t) || now - (t.closedAt ?? t.createdAt) <= KEEP_CLOSED_MS);
  return keep.length === board.tasks.length ? board : { ...board, tasks: keep };
}

export function emptyBoard(id: string, name: string, kind: Board["kind"], now: number, owner?: Omit<Member, "access">): Board {
  return { id, name, kind, goals: [], members: owner ? [{ ...owner, access: "owner" }] : [], tasks: [], investTarget: 20, version: 0, updatedAt: now };
}
