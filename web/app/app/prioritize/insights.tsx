"use client";
// What a matrix alone does not show: urgencies that keep coming back, how much of the week went to Invest, high-leverage
// work that keeps slipping, everything rated top, people over capacity, and work that serves no goal.
import { useState } from "react";
import { goalProgress, inflated, investShare, load, recurring, slipping, unanchored, type Board, type Op, type Task } from "@orion/decision-engine/board.ts";
import type { BusinessProfile } from "@orion/business/schema.ts";
import { Button } from "@/components/ui";
import { useT } from "@/components/LocaleProvider";
import { newId, splitIntoSteps } from "@/lib/board";
import s from "./prioritize.module.css";

export function Insights({ board, me, business, onSelect, dispatch, company }: {
  board: Board; me: string | null; business: boolean; company: BusinessProfile;
  onSelect: (id: string) => void; dispatch: (...ops: Op[]) => boolean;
}) {
  const t = useT();
  const now = Date.now();
  const fires = recurring(board, now).slice(0, 2);
  const week = investShare(board, now);
  const mine = board.kind === "team" && me ? investShare(board, now, me) : null;
  const stuck = slipping(board.tasks)[0] ?? null;
  const gaming = inflated(board.tasks);
  const over = board.kind === "team" ? load(board).filter((x) => x.over) : [];
  const loose = unanchored(board);
  const goals = board.kind === "team" || business ? goalProgress(board, now) : [];
  const pct = (x: number) => Math.round(x * 100);

  function fixCause(theme: string, n: number) {
    const id = newId();
    dispatch({ op: "task.add", task: {
      id, title: t("Fix the cause: {theme}", { theme }).slice(0, 120),
      impact: { value: 4, origin: "ai" }, effort: { value: 3, origin: "ai" }, urgency: { value: 2, origin: "ai" },
      theme, from: { kind: "recurring", theme }, why: t("Created because “{theme}” came back {n} times this month.", { theme, n }).slice(0, 200),
    } });
    onSelect(id);
  }

  return (
    <div className={s.insights}>
      {fires.map((r) => (
        <article key={r.theme} className={s.insight}>
          <span className={s.insightKicker} data-tone="warn">{t("Recurring urgency")}</span>
          <p>{t("“{theme}” came back {n} times this month and cost about {hours} hours.", { theme: r.theme, n: r.tasks.length, hours: Math.round(r.hours) })}{" "}
            {r.fix ? t("Fixing the cause is now an Invest task.") : t("Fixing its cause would be a high-leverage task.")}</p>
          {r.estimated && <span className="t-micro faint">{t("Hours are estimated from effort where no time was logged.")}</span>}
          <div>{r.fix ? <button className={`${s.link} t-small`} onClick={() => onSelect(r.fix!.id)}>{t("See the task")}</button>
            : <Button size="sm" variant="secondary" onClick={() => fixCause(r.theme, r.tasks.length)}>{t("Make it an Invest task")}</Button>}</div>
        </article>
      ))}

      <article className={s.insight}>
        <span className={s.insightKicker} data-tone="blue">{t("Invest time this week")}</span>
        {week.minutes === 0
          ? <p>{t("No time logged this week yet. When you finish a task or log time on it, ORION shows how much went to Invest, against your target of {target}%.", { target: board.investTarget })}</p>
          : <p>{t("{share}% of your logged time went to Invest tasks. Your target is {target}%.", { share: pct(week.share), target: board.investTarget })}{" "}
              {week.share < week.target ? t("Block time for one Invest task before the week fills up.") : t("You’re protecting it. Keep going.")}</p>}
        <div className={s.budget} role="img" aria-label={t("{share}% of {target}%", { share: pct(week.share), target: board.investTarget })}>
          <span className={s.budgetFill} style={{ width: `${pct(week.share)}%` }} />
          <span className={s.budgetMark} style={{ left: `${board.investTarget}%` }} />
        </div>
        <div className={s.budgetAxis}><span>0%</span><span>{t("Target {n}%", { n: board.investTarget })}</span><span>100%</span></div>
        {mine && mine.minutes > 0 && <span className="t-micro muted">{t("Yours: {share}% of {hours} h logged.", { share: pct(mine.share), hours: Math.round(mine.minutes / 6) / 10 })}</span>}
      </article>

      {stuck && <Slipping key={stuck.id} task={stuck} board={board} company={business ? company : null} dispatch={dispatch} onSelect={onSelect} />}

      {gaming && (
        <article className={s.insight}>
          <span className={s.insightKicker} data-tone="warn">{t("Everything is top")}</span>
          <p>{gaming.score === "impact"
            ? t("{share}% of your open tasks have impact 5. When everything is top, nothing stands out. Which would you drop last?", { share: pct(gaming.share) })
            : t("{share}% of your open tasks have urgency 5. If everything is due today, the deadlines aren’t telling you much.", { share: pct(gaming.share) })}</p>
        </article>
      )}

      {over.length > 0 && (
        <article className={s.insight}>
          <span className={s.insightKicker} data-tone="warn">{t("Over capacity")}</span>
          {over.map((x) => <p key={x.member.id}>{t("{name} has about {hours} h of open work for {cap} h a week.", { name: x.member.name, hours: Math.round(x.hours), cap: x.member.hoursPerWeek ?? 0 })}</p>)}
          <span className="t-micro muted">{t("Move a Contain task to someone with spare hours, or drop one.")}</span>
        </article>
      )}

      {goals.length > 0 && (
        <article className={s.insight}>
          <span className={s.insightKicker} data-tone="plain">{t("Goals this week")}</span>
          {goals.map((g) => (
            <p key={g.goal.id}><b>{g.goal.title}</b> · {t("{leverage} high-leverage open, {done} done this week", { leverage: g.leverage, done: g.doneThisWeek })}
              {g.leverage === 0 && <span className="muted"> · {t("nothing is moving it")}</span>}</p>
          ))}
        </article>
      )}

      {loose.length > 0 && (
        <article className={s.insight}>
          <span className={s.insightKicker} data-tone="plain">{t("No goal")}</span>
          <p>{t("{n} open tasks point at no goal, so their impact is a guess.", { n: loose.length })}</p>
          <div><button className={`${s.link} t-small`} onClick={() => onSelect(loose[0].id)}>{t("Show the first")}</button></div>
        </article>
      )}
    </div>
  );
}

function Slipping({ task, board, company, dispatch, onSelect }: { task: Task; board: Board; company: BusinessProfile | null; dispatch: (...ops: Op[]) => boolean; onSelect: (id: string) => void }) {
  const t = useT();
  const [telling, setTelling] = useState(false);
  const [why, setWhy] = useState(task.blocker ?? "");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<{ title: string; impact: 1 | 2 | 3 | 4 | 5; effort: 1 | 2 | 3 | 4 | 5; urgency: 1 | 2 | 3 | 4 | 5 }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function split() {
    setBusy(true); setError(null);
    try { setSteps((await splitIntoSteps(task, board, company)).steps); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function addSteps() {
    if (!steps) return;
    dispatch(...steps.map((x): Op => ({ op: "task.add", task: {
      id: newId(), title: x.title, impact: { value: x.impact, origin: "ai" }, effort: { value: x.effort, origin: "ai" }, urgency: { value: x.urgency, origin: "ai" },
      goalId: task.goalId ?? null, assignee: task.assignee ?? null, from: { kind: "step", parentId: task.id },
    } })));
    setSteps(null);
  }

  return (
    <article className={s.insight}>
      <span className={s.insightKicker} data-tone="warn">{t("Postponed {n} times", { n: task.postponed })}</span>
      <p>{t("“{task}” keeps slipping. What is blocking it?", { task: task.title })}</p>
      {telling ? (
        <form className="stack gap-2" onSubmit={(e) => { e.preventDefault(); dispatch({ op: "task.update", id: task.id, patch: { blocker: why.trim() || null } }); setTelling(false); }}>
          <textarea className="o-textarea" maxLength={400} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t("e.g. I don’t know which segments to target")} aria-label={t("What is blocking it?")} />
          <div className="row gap-2"><Button size="sm" variant="primary" type="submit">{t("Save")}</Button><Button size="sm" variant="ghost" type="button" onClick={() => setTelling(false)}>{t("Cancel")}</Button></div>
        </form>
      ) : steps ? (
        <div className="stack gap-2">
          <ol className="t-small" style={{ paddingLeft: 18 }}>{steps.map((x, k) => <li key={k}>{x.title}</li>)}</ol>
          <div className="row gap-2"><Button size="sm" variant="primary" onClick={addSteps}>{t("Add these steps")}</Button><Button size="sm" variant="ghost" onClick={() => setSteps(null)}>{t("Cancel")}</Button></div>
        </div>
      ) : (
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          <Button size="sm" variant="secondary" onClick={split} disabled={busy}>{busy ? t("Splitting…") : t("Split into steps")}</Button>
          <Button size="sm" variant="secondary" onClick={() => setTelling(true)}>{t("Tell ORION why")}</Button>
          <button className={`${s.link} t-small`} onClick={() => onSelect(task.id)}>{t("See the task")}</button>
        </div>
      )}
      {task.blocker && !telling && <span className="t-micro muted">{t("Blocked by: {why}", { why: task.blocker })}</span>}
      {error && <span className="t-micro" style={{ color: "var(--warning)" }}>{error}</span>}
    </article>
  );
}
