"use client";
// The selected task: its three scores (each showing who set it), the one-sentence reason for its box, and what to do
// with it. Changing a score moves the task at once.
import { useState } from "react";
import { listPhrase, msg } from "@orion/i18n/index.ts";
import { delegateTo, placement, type Board, type Level, type Op, type Placement, type Task } from "@orion/decision-engine/board.ts";
import type { BusinessProfile } from "@orion/business/schema.ts";
import { Button, Field, Glass, Tag } from "@/components/ui";
import { useT } from "@/components/LocaleProvider";
import { ANCHORS, download, dueLabel, quadrantName, toICS } from "@/lib/board";
import { BOXES } from "./view";
import s from "./prioritize.module.css";

type T = ReturnType<typeof useT>;
const SCORES = [
  { k: "impact", label: msg("Impact") },
  { k: "effort", label: msg("Effort") },
  { k: "urgency", label: msg("Urgency") },
] as const;
export const TIMES = [15, 30, 60, 120, 240, 480];
export const timeLabel = (m: number, t: T) => (m < 60 ? t("{n} min", { n: m }) : m === 240 ? t("Half a day") : m === 480 ? t("A day") : t("{n} h", { n: Math.round(m / 6) / 10 }));

/** "Why Invest: impact 4 on a key goal makes it high leverage; urgency 2 means it is not urgent." */
export function reason(p: Placement, t: T): string {
  const box = quadrantName(p.quadrant);
  const lev = p.leverage === "impact"
    ? p.goal ? t("Impact {impact} on “{goal}” makes it high leverage.", { impact: p.impact, goal: p.goal.title }) : t("Impact {impact} makes it high leverage.", { impact: p.impact })
    : p.leverage === "quick_win" ? t("Impact 3 for effort {effort} makes it a quick win, so high leverage.", { effort: p.effort })
    : t("Impact {impact} for effort {effort} is low leverage.", { impact: p.impact, effort: p.effort });
  const urg = p.urgent ? t("Urgency {urgency} means it is urgent.", { urgency: p.urgency }) : t("Urgency {urgency} means it is not urgent.", { urgency: p.urgency });
  const close = (["urgency", "impact", "effort"] as const).filter((k) => p.edge[k]).map((k) => t(SCORES.find((x) => x.k === k)!.label).toLowerCase());
  return `${t("Why {box}:", { box })} ${lev} ${urg}${close.length ? ` ${t("One point on {scores} would move it.", { scores: listPhrase(close) })}` : ""}`;
}

export function TaskPanel({ task, board, me, pending, dispatch, onClose, onScore, onSelect, toast }: {
  task: Task; board: Board; me: string | null; company: BusinessProfile; pending: boolean;
  dispatch: (...ops: Op[]) => boolean; onClose: () => void; onScore: () => void; onSelect: (id: string | null) => void; toast: (m: string) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [timing, setTiming] = useState<"done" | "log" | null>(null);
  const p = placement(task, board.goals);
  const update = (patch: Extract<Op, { op: "task.update" }>["patch"]) => dispatch({ op: "task.update", id: task.id, patch });
  const team = board.kind === "team";
  const delegate = p.quadrant === "contain" && team ? delegateTo(board, task, me) : null;
  const unscored = [task.impact, task.effort, task.urgency].every((x) => x.origin === "default");
  const open = task.status === "open";

  const context = {
    impact: p.goal?.title ?? t(ANCHORS.impact[task.impact.value - 1]),
    effort: t(ANCHORS.effort[task.effort.value - 1]),
    urgency: dueLabel(task.due) ?? t(ANCHORS.urgency[task.urgency.value - 1]),
  };
  const origin = (o: Task["impact"]["origin"]) => (o === "user" ? <Tag tone="blue">{t("Set by you")}</Tag> : o === "ai" ? <Tag plain>{t("AI proposed")}</Tag> : <Tag plain>{t("Not scored")}</Tag>);

  function finish(minutes?: number) {
    if (timing === "done") { dispatch({ op: "task.done", id: task.id, minutes }); toast(t("Done. Well spent.")); onSelect(null); }
    else if (minutes) { dispatch({ op: "task.log", id: task.id, minutes }); toast(t("Logged {time}.", { time: timeLabel(minutes, t) })); }
    setTiming(null);
  }

  return (
    <Glass className={s.panel} aria-label={t("Selected task")}>
      <div className="row gap-2" style={{ justifyContent: "space-between" }}>
        <span className="t-label">{t("Selected task")} · {t(BOXES[p.quadrant].title)}</span>
        <Button variant="ghost" size="sm" icon="close" aria-label={t("Close")} onClick={onClose} />
      </div>
      <input className={s.panelTitle} value={title} maxLength={120} aria-label={t("Task")} onChange={(e) => setTitle(e.target.value)}
        onBlur={() => { if (title.trim() && title.trim() !== task.title) update({ title: title.trim() }); else setTitle(task.title); }} />

      {unscored && (
        <div className="row gap-2">
          {pending ? <span className="t-small muted">{t("ORION is scoring…")}</span>
            : <Button size="sm" variant="secondary" icon="spark" onClick={onScore}>{t("Ask ORION to score it")}</Button>}
          <span className="t-micro faint">{t("or set the three scores below.")}</span>
        </div>
      )}

      {SCORES.map(({ k, label }) => (
        <div key={k} className={s.score} data-k={k}>
          <div className={s.scoreHead}>
            <span><b>{t(label)}</b> · {context[k]}</span>
            {origin(task[k].origin)}
          </div>
          <div className={s.steps} role="radiogroup" aria-label={t(label)}>
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} type="button" role="radio" aria-checked={task[k].value === v} className={s.step} data-on={task[k].origin !== "default" && v <= task[k].value}
                title={`${v} · ${t(ANCHORS[k][v - 1])}`} aria-label={`${v} · ${t(ANCHORS[k][v - 1])}`}
                onClick={() => update({ [k]: { value: v as Level, origin: "user" } })}>{v}</button>
            ))}
          </div>
        </div>
      ))}

      {!unscored && <div className={s.why}>{reason(p, t)}{task.why && <span className="faint" style={{ display: "block", marginTop: 6 }}>{t("ORION’s reading: {why}", { why: task.why })}</span>}</div>}

      {open && (
        <div className="stack gap-2">
          {timing ? (
            <>
              <span className="t-small">{timing === "done" ? t("How long did it take? It counts toward this week’s split.") : t("How much time did you spend?")}</span>
              <div className={s.timeChips}>
                {TIMES.map((m) => <button key={m} className="o-chip" onClick={() => finish(m)}>{timeLabel(m, t)}</button>)}
                <button className="o-chip o-chip--quiet" onClick={() => (timing === "done" ? finish() : setTiming(null))}>{timing === "done" ? t("Skip") : t("Cancel")}</button>
              </div>
            </>
          ) : (
            <>
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                {p.quadrant === "invest" && <Button variant="primary" icon="clock" onClick={() => { download("orion-invest.ics", "text/calendar", toICS(task)); toast(t("Calendar block downloaded. Open it to add it to your calendar.")); }}>{t("Schedule time")}</Button>}
                {delegate && <Button variant="primary" icon="people" onClick={() => { update({ assignee: delegate.member.id }); toast(t("Assigned to {name}.", { name: delegate.member.name })); }}>{t("Delegate to {name}", { name: delegate.member.name })}</Button>}
                {p.quadrant === "drop" && <Button variant="primary" onClick={() => { dispatch({ op: "task.drop", id: task.id }); onSelect(null); toast(t("Dropped. It’s in “Done and dropped” if you need it back.")); }}>{t("Drop it")}</Button>}
                <Button variant={p.quadrant === "act" ? "primary" : "secondary"} icon="check" onClick={() => setTiming("done")}>{t("Done")}</Button>
              </div>
              {p.quadrant === "contain" && !delegate && (
                <p className="t-micro muted">{team ? t("No one has spare hours for it. Time-box it: 30 minutes, good enough.") : t("Can it be automated, simplified, or done good-enough in 30 minutes?")}</p>
              )}
              {delegate && <p className="t-micro muted">{delegate.because === "role" ? t("{name}’s role fits this task.", { name: delegate.member.name }) : t("{name} has the most spare hours this week.", { name: delegate.member.name })}</p>}
              <div className="row gap-3" style={{ flexWrap: "wrap" }}>
                <button className={`${s.link} t-small`} onClick={() => setTiming("log")}>{t("Log time")}</button>
                <button className={`${s.link} t-small`} onClick={() => { dispatch({ op: "task.postpone", id: task.id }); toast(task.postponed + 1 >= 3 ? t("Postponed {n} times. ORION will ask what’s blocking it.", { n: task.postponed + 1 }) : t("Moved to next week.")); }}>{t("Not this week")}</button>
                {p.quadrant !== "drop" && <button className={`${s.link} t-small`} onClick={() => { dispatch({ op: "task.drop", id: task.id }); onSelect(null); }}>{t("Drop")}</button>}
                <button className={`${s.link} t-small`} onClick={() => { if (confirm(t("Delete this task for good?"))) { dispatch({ op: "task.remove", id: task.id }); onSelect(null); } }}>{t("Delete")}</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className={s.fields}>
        <Field label={t("Goal")}>
          <select className="o-select" value={task.goalId ?? ""} onChange={(e) => update({ goalId: e.target.value || null })}>
            <option value="">{t("No goal")}</option>{board.goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
        <Field label={t("Deadline")}>
          <input className="o-input" type="date" value={task.due ?? ""} onChange={(e) => update({ due: e.target.value || null })} />
        </Field>
        {team && (
          <Field label={t("Owner")}>
            <select className="o-select" value={task.assignee ?? ""} onChange={(e) => update({ assignee: e.target.value || null })}>
              <option value="">{t("Unassigned")}</option>{board.members.map((m) => <option key={m.id} value={m.id}>{m.id === me ? t("{name} (you)", { name: m.name }) : m.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={t("Cause, if it keeps coming back")}>
          <input className="o-input" maxLength={60} placeholder={t("e.g. invoicing errors")} defaultValue={task.theme ?? ""} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (task.theme ?? null)) update({ theme: v }); }} />
        </Field>
      </div>
      <Field label={t("Notes")}>
        <textarea className="o-textarea" maxLength={600} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== (task.notes ?? "")) update({ notes }); }} />
      </Field>
      {task.blocker && <p className="t-micro muted">{t("Blocked by: {why}", { why: task.blocker })}</p>}
      {task.log.length > 0 && <p className="t-micro faint">{t("{time} logged so far.", { time: timeLabel(task.log.reduce((a, l) => a + l.minutes, 0), t) })}</p>}
    </Glass>
  );
}
