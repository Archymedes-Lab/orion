"use client";
// Prioritize: one 2×2 of urgency × leverage (src/decision-engine/board.ts). The AI proposes three scores per task,
// the person confirms or changes them, and the task visibly moves. Impact is anchored in two or three declared goals.
// Signed in, boards are kept with the account and can be shared with a team; otherwise the board stays on this device.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { msg } from "@orion/i18n/index.ts";
import { arrange, quadrant, type Board, type Goal, type Level, type Op, type Quadrant, type Task } from "@orion/decision-engine/board.ts";
import { Button, Disclosure, Glass, Index, Notice, Tag } from "@/components/ui";
import { Toast } from "@/components/client";
import { useT } from "@/components/LocaleProvider";
import { useStore } from "@/lib/store";
import { download, dueLabel, newId, proposeScores, toCSV, urgencyFromDue, useBoards, type Proposal, type ViewMember } from "@/lib/board";
import { TaskPanel } from "./panel";
import { Insights } from "./insights";
import { TeamSettings } from "./team";
import s from "./prioritize.module.css";

export const BOXES: Record<Quadrant, { kicker: string; title: string; hint: string; personal: string }> = {
  act: { kicker: msg("High leverage"), title: msg("Act now"), hint: msg("Do it yourself, first."), personal: msg("Do it yourself, first.") },
  invest: { kicker: msg("High leverage"), title: msg("Invest"), hint: msg("Block protected time. This is where the business grows."), personal: msg("Block protected time. This is where real progress happens.") },
  contain: { kicker: msg("Low leverage"), title: msg("Contain"), hint: msg("Delegate, time-box, good enough."), personal: msg("Automate, simplify or time-box. Good enough is enough.") },
  drop: { kicker: msg("Low leverage"), title: msg("Drop"), hint: msg("Delete, batch or postpone. Reviewed weekly."), personal: msg("Delete, batch or postpone. Reviewed weekly.") },
};
const SHOWN = 6;

/** A task counts as placed once any of its three scores came from the AI or the person. */
export const scored = (x: Task) => x.impact.origin !== "default" || x.urgency.origin !== "default" || x.effort.origin !== "default";
export const boardName = (b: Pick<Board, "name" | "kind">, t: ReturnType<typeof useT>) => (b.kind === "personal" && b.name === "My priorities" ? t("My priorities") : b.name);

export function Prioritize() {
  const t = useT();
  const params = useSearchParams();
  const b = useBoards(params.get("board"));
  const company = useStore((d) => d.company);
  const lens = useStore((d) => d.lens);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [moved, setMoved] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const board = b.board;

  // Remember each task's box, so a score change that moves it can flash it in its new place.
  const boxes = useRef(new Map<string, Quadrant>());
  useEffect(() => {
    if (!board) return;
    for (const x of board.tasks) {
      const q = quadrant(x), was = boxes.current.get(x.id);
      if (was && was !== q) { setMoved(x.id); setTimeout(() => setMoved((m) => (m === x.id ? null : m)), 1000); }
      boxes.current.set(x.id, q);
    }
  }, [board]);

  const placed = useMemo(() => arrange(board ? board.tasks.filter(scored) : []), [board]);
  const unscored = useMemo(() => (board ? board.tasks.filter((x) => x.status === "open" && !scored(x)) : []), [board]);
  const task = board?.tasks.find((x) => x.id === selected) ?? null;
  const business = board?.kind === "team" || lens === "business";

  /** Ask the AI for scores and apply them, never over a score the person set meanwhile. */
  async function score(tasks: Pick<Task, "id" | "title" | "notes" | "due">[], current: Board) {
    if (!tasks.length) return;
    setPending((p) => new Set([...p, ...tasks.map((x) => x.id)]));
    try {
      const { tasks: proposals } = await proposeScores(tasks, current, business ? company : null);
      b.dispatch(...proposals.map((p): Op => ({ op: "task.update", id: p.id, patch: patchFrom(p, current.tasks.find((x) => x.id === p.id)) })));
    } catch (e) { setToast((e as Error).message); }
    finally { setPending((p) => { const n = new Set(p); tasks.forEach((x) => n.delete(x.id)); return n; }); }
  }
  // Read the latest version of a task when the proposal lands, so edits made while waiting win.
  const latest = useRef(board);
  latest.current = board;
  function patchFrom(p: Proposal, before?: Task) {
    const now = latest.current?.tasks.find((x) => x.id === p.id) ?? before;
    const keep = (k: "impact" | "effort" | "urgency", v: Level) => (now?.[k].origin === "user" ? now[k] : { value: v, origin: "ai" as const });
    return {
      impact: keep("impact", p.impact), effort: keep("effort", p.effort), urgency: keep("urgency", p.urgency),
      ...(now?.goalId ? {} : { goalId: p.goalId }), ...(now?.theme ? {} : { theme: p.theme }), why: p.why,
    };
  }

  function addTasks(text: string, due: string) {
    if (!board) return;
    const titles = text.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean).slice(0, 12).map((l) => l.slice(0, 120));
    if (!titles.length) return;
    const tasks = titles.map((title) => ({
      id: newId(), title, impact: { value: 3, origin: "default" }, effort: { value: 3, origin: "default" },
      urgency: { value: urgencyFromDue(due || null), origin: "default" }, due: due || null, goalId: null, theme: null, assignee: null,
    } satisfies Extract<Op, { op: "task.add" }>["task"]));
    if (!b.dispatch(...tasks.map((task): Op => ({ op: "task.add", task })))) return;
    if (tasks.length === 1) setSelected(tasks[0].id);
    void score(tasks, board);
  }

  if (b.mode === "loading") return <div className={s.page}><p className="t-small muted">{t("Loading your priorities…")}</p></div>;
  if (b.mode === "signed_out") {
    return (
      <div className={s.page}>
        <Glass className={s.empty}>
          <Index n="—">{t("Prioritize")}</Index>
          <h1 className="t-h1">{t("Sign in to prioritize.")}</h1>
          <p className="t-small muted" style={{ maxWidth: "60ch" }}>{t("Your board is kept with your account, so it follows you between devices and can be shared with your team.")}</p>
          <div><Link className="o-btn o-btn--primary" href="/signin?next=/app/prioritize">{t("Sign in")}</Link></div>
        </Glass>
      </div>
    );
  }
  if (!board) return <div className={s.page}><Notice tone="warning" icon="bulb">{b.error ?? t("ORION’s server can’t be reached right now.")}</Notice></div>;

  const join = params.get("join");
  const open = board.tasks.filter((x) => x.status === "open");
  const boxProps = { business, members: board.members, selected, moved, pending, onSelect: setSelected };
  const doneThisWeek = board.tasks.filter((x) => x.status !== "open").sort((a, z) => (z.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, 20);

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div className="stack gap-2">
          <Index n="—">{t("Prioritize")}</Index>
          <h1 className="t-h1">{boardName(board, t)}</h1>
        </div>
        <div className={s.headTools}>
          {b.mode === "remote" && b.boards.length > 1 && (
            <select className={`o-select ${s.boardPick}`} aria-label={t("Board")} value={board.id} onChange={(e) => { setSelected(null); void b.open(e.target.value); }}>
              {b.boards.map((x) => <option key={x.id} value={x.id}>{x.kind === "personal" ? t("My priorities") : x.name}</option>)}
            </select>
          )}
          {b.saving && <span className="t-micro faint">{t("Saving…")}</span>}
          <Button variant="ghost" size="sm" icon="copy" onClick={() => download(`${boardName(board, t).replace(/[^\p{L}\p{N}]+/gu, "-")}.csv`, "text/csv", toCSV(board))} disabled={!board.tasks.length}>{t("Export CSV")}</Button>
        </div>
      </header>

      {join && b.mode === "remote" && <JoinCard code={join} onJoin={async (you) => { await b.join(join, you); setToast(t("You joined the board.")); }} />}
      {b.mode === "local" && <p className="t-micro faint">{t("Local mode — this board stays on this device. Team boards need an account.")}</p>}
      {b.error && <Notice tone="warning" icon="bulb"><span>{b.error}</span> <button className={`${s.link} t-small`} style={{ marginLeft: 8 }} onClick={b.clearError}>{t("Dismiss")}</button></Notice>}

      <Goals goals={board.goals} members={board.members} team={board.kind === "team"} onSave={(goals) => b.dispatch({ op: "goals.set", goals })} />

      <AddTasks onAdd={addTasks} />

      {unscored.length > 0 && (
        <div className="stack gap-2">
          <span className="t-label">{t("Not scored yet")}</span>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            {unscored.map((x) => (
              <button key={x.id} className="o-chip" aria-pressed={selected === x.id} onClick={() => setSelected(x.id)}>
                {x.title}{pending.has(x.id) && <span className="faint"> · {t("ORION is scoring…")}</span>}
              </button>
            ))}
            {unscored.some((x) => !pending.has(x.id)) && <Button size="sm" variant="ghost" icon="spark" onClick={() => score(unscored.filter((x) => !pending.has(x.id)), board)}>{t("Ask ORION to score them")}</Button>}
          </div>
        </div>
      )}

      <div className={s.layout}>
        <div className="stack gap-3">
          <div className={s.matrix}>
            <span />
            <span className={s.colHead}><b>{t("Urgent")}</b> · {t("urgency 4–5")}</span>
            <span className={s.colHead}><b>{t("Not urgent")}</b> · {t("urgency 1–3")}</span>
            <span className={s.rowHead}>{t("High leverage")}</span>
            <Box q="act" list={placed.act} {...boxProps} />
            <Box q="invest" list={placed.invest} {...boxProps} />
            <span className={s.rowHead}>{t("Low leverage")}</span>
            <Box q="contain" list={placed.contain} {...boxProps} />
            <Box q="drop" list={placed.drop} {...boxProps} />
          </div>
          <p className="t-micro faint">{t("Inside each box, tasks are ordered by impact ÷ effort, highest first; ties go to the nearest deadline.")}</p>
        </div>
        {task
          ? <TaskPanel key={task.id} task={task} board={board} me={b.me} company={company} pending={pending.has(task.id)}
              dispatch={b.dispatch} onClose={() => setSelected(null)} onScore={() => score([task], board)} onSelect={setSelected} toast={setToast} />
          : <HowItWorks empty={!open.length} />}
      </div>

      <Insights board={board} me={b.me} business={business} onSelect={setSelected} dispatch={b.dispatch} company={company} />

      {doneThisWeek.length > 0 && (
        <Disclosure title={t("Done and dropped")} hint={t("{n} recent", { n: doneThisWeek.length })}>
          <div className={s.doneList}>
            {doneThisWeek.map((x) => (
              <div key={x.id} className={s.doneRow}>
                <span>{x.status === "done" ? "✓" : "–"} {x.title}</span>
                <button className={`${s.link} t-micro`} onClick={() => b.dispatch({ op: "task.reopen", id: x.id })}>{t("Reopen")}</button>
              </div>
            ))}
          </div>
        </Disclosure>
      )}

      <TeamSettings b={b} board={board} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

interface BoxProps { q: Quadrant; list: Task[]; business: boolean; members: ViewMember[]; selected: string | null; moved: string | null; pending: Set<string>; onSelect: (id: string | null) => void }

function Box({ q, list, business, ...rest }: BoxProps) {
  const t = useT();
  const [all, setAll] = useState(false);
  const meta = BOXES[q];
  return (
    <section className={s.box} data-q={q} aria-label={t(meta.title)}>
      <div className="stack gap-1">
        <span className={s.boxKicker}>{t(meta.kicker)}</span>
        <span className={s.boxTitle}>{t(meta.title)}</span>
        <span className={s.boxHint}>{t(business ? meta.hint : meta.personal)}</span>
      </div>
      {list.length === 0 && <span className={s.boxEmpty}>{t("Nothing here.")}</span>}
      {(all ? list : list.slice(0, SHOWN)).map((x) => <Card key={x.id} task={x} {...rest} />)}
      {list.length > SHOWN && <button className={s.more} onClick={() => setAll(!all)}>{all ? t("Show fewer") : t("Show {n} more", { n: list.length - SHOWN })}</button>}
    </section>
  );
}

function Card({ task: x, members, selected, moved, pending, onSelect }: Omit<BoxProps, "q" | "list" | "business"> & { task: Task }) {
  const t = useT();
  const who = members.find((m) => m.id === x.assignee);
  const due = dueLabel(x.due);
  const repeats = x.from?.kind === "recurring";
  const meta = [t("Impact {n}", { n: x.impact.value }), t("Effort {n}", { n: x.effort.value }), due, repeats ? t("From a recurring urgency") : null, x.from?.kind === "step" ? t("A step") : null].filter(Boolean).join(" · ");
  return (
    <button className={`${s.card} ${moved === x.id ? s.moved : ""}`} aria-pressed={selected === x.id} onClick={() => onSelect(selected === x.id ? null : x.id)}>
      <span style={{ minWidth: 0 }}>
        <span className={s.cardTitle}>{x.title}</span>
        <span className={s.cardMeta} style={{ display: "block" }}>{meta}</span>
      </span>
      <span className={s.cardBadges}>
        {x.postponed >= 3 && <Tag tone="warning">{t("Postponed {n}×", { n: x.postponed })}</Tag>}
        {repeats && x.createdAt > Date.now() - 7 * 86_400_000 && <Tag tone="blue">{t("New")}</Tag>}
        {pending.has(x.id) && <Tag plain>{t("Scoring…")}</Tag>}
        {who && <span className={s.who} title={who.name}>{initials(who.name)}</span>}
      </span>
    </button>
  );
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("").toUpperCase();

function Goals({ goals, members, team, onSave }: { goals: Goal[]; members: ViewMember[]; team: boolean; onSave: (goals: Goal[]) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Goal[]>(goals);
  useEffect(() => { if (!editing) setDraft(goals); }, [goals, editing]);

  if (!editing && goals.length === 0) {
    return (
      <Glass className={s.empty}>
        <span className="t-label">{t("Start with your goals")}</span>
        <p className="t-small" style={{ maxWidth: "70ch" }}>{t("Impact is measured against two or three goals, like “Sign 3 pilot clients” or “Hire a sales lead”. Without them, “important” stays vague and everything looks urgent.")}</p>
        <div><Button variant="primary" icon="plus" onClick={() => { setDraft([{ id: newId(), title: "" }]); setEditing(true); }}>{t("Add goals")}</Button></div>
      </Glass>
    );
  }
  if (!editing) {
    return (
      <div className={s.goals}>
        <span>{t("Impact is measured against your goals:")}</span>
        {goals.map((g) => <span key={g.id} className={s.goal}>{g.title}{g.metric && <small>{g.metric}</small>}{team && g.ownerId && <small>· {members.find((m) => m.id === g.ownerId)?.name}</small>}</span>)}
        <button className={`${s.link} t-small`} onClick={() => setEditing(true)}>{t("Edit goals")}</button>
      </div>
    );
  }
  const valid = draft.filter((g) => g.title.trim());
  return (
    <Glass className={s.empty}>
      <span className="t-label">{t("Your goals")}</span>
      <p className="t-micro muted">{t("Two or three is best; five at most. Say how you’ll know it moved, if you can.")}</p>
      {draft.map((g, k) => (
        <div key={g.id} className="row gap-2" style={{ flexWrap: "wrap" }}>
          <input className="o-input" style={{ flex: "2 1 240px" }} maxLength={80} placeholder={t("e.g. Sign 3 pilot clients")} value={g.title} aria-label={t("Goal")} onChange={(e) => setDraft(draft.map((x, j) => (j === k ? { ...x, title: e.target.value } : x)))} />
          <input className="o-input" style={{ flex: "1 1 160px" }} maxLength={80} placeholder={t("Measure (optional)")} value={g.metric ?? ""} aria-label={t("Measure")} onChange={(e) => setDraft(draft.map((x, j) => (j === k ? { ...x, metric: e.target.value || undefined } : x)))} />
          {team && (
            <select className="o-select" style={{ flex: "1 1 140px" }} aria-label={t("Goal owner")} value={g.ownerId ?? ""} onChange={(e) => setDraft(draft.map((x, j) => (j === k ? { ...x, ownerId: e.target.value || null } : x)))}>
              <option value="">{t("No owner")}</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <Button variant="ghost" size="sm" icon="close" aria-label={t("Remove goal")} onClick={() => setDraft(draft.filter((_, j) => j !== k))} />
        </div>
      ))}
      <div className="row gap-2">
        {draft.length < 5 && <Button variant="ghost" size="sm" icon="plus" onClick={() => setDraft([...draft, { id: newId(), title: "" }])}>{t("Add a goal")}</Button>}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>{t("Cancel")}</Button>
        <Button variant="primary" size="sm" onClick={() => { onSave(valid.map((g) => ({ ...g, title: g.title.trim(), metric: g.metric?.trim() || undefined }))); setEditing(false); }}>{t("Save goals")}</Button>
      </div>
    </Glass>
  );
}

function AddTasks({ onAdd }: { onAdd: (text: string, due: string) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const submit = () => { if (!text.trim()) return; onAdd(text, due); setText(""); setDue(""); };
  return (
    <form className={s.add} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea className="o-textarea" rows={1} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={t("Add a task — or paste a list, one per line")} aria-label={t("New task")}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
      <input className="o-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label={t("Due date (optional)")} title={t("Due date (optional)")} />
      <Button variant="primary" type="submit" icon="plus" disabled={!text.trim()}>{t("Add")}</Button>
    </form>
  );
}

function HowItWorks({ empty }: { empty: boolean }) {
  const t = useT();
  return (
    <Glass className={s.panel}>
      <span className="t-label">{empty ? t("How it works") : t("Select a task")}</span>
      {!empty && <p className="t-small muted">{t("Pick a task to see why it sits where it does, change its scores, and act on it.")}</p>}
      <div className="stack gap-3 t-small">
        <p>{t("ORION proposes three scores for every task, 1 to 5: impact on your goals, effort, and urgency. You confirm or change them.")}</p>
        <p>{t("Urgent means urgency 4 or 5. High leverage means impact 4 or 5, or impact 3 for little effort (a quick win).")}</p>
        <p>{t("Invest is the box that slips: not urgent, but where progress comes from. ORION keeps it visible and shows how much of your week it got.")}</p>
      </div>
    </Glass>
  );
}

function JoinCard({ code, onJoin }: { code: string; onJoin: (you: string) => Promise<void> }) {
  const t = useT();
  const [you, setYou] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <Glass className={s.empty}>
      <span className="t-label">{t("Invitation")}</span>
      <p className="t-small">{t("You’ve been invited to a team board. Your teammates will see the name you give here.")}</p>
      <form className="row gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onJoin(you.trim()); setDone(true); } catch { /* shown above */ } finally { setBusy(false); } }}>
        <input className="o-input" style={{ maxWidth: 280 }} required maxLength={60} placeholder={t("Your name")} value={you} onChange={(e) => setYou(e.target.value)} aria-label={t("Your name")} data-code={code} />
        <Button variant="primary" type="submit" disabled={busy || !you.trim()}>{busy ? t("Joining…") : t("Join the board")}</Button>
      </form>
    </Glass>
  );
}
