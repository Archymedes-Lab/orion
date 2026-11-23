"use client";
// What sits around the verdict, each from the launch research:
//   SeeItDifferently  people distrust AI that just agrees with them; ORION re-scores only on facts, never on pushback.
//   Downside          the most common advice on Hacker News: know the worst case and whether you can undo it.
//   AskFriends        people ask others "which would you take?"; friends answer before they see ORION's call.
//   CheckIn           regret is the main fear; asking how it turned out closes the loop and brings people back.
//   RecordButton      founders want a record of why they decided, and nobody keeps one by hand.
import { useEffect, useState } from "react";
import { Icon } from "./brand";
import { useLang, useT } from "./LocaleProvider";
import { Button, Notice } from "./ui";
import { api, ApiError } from "@/lib/api";
import { changers, score, view, withFacts, type DecisionRun, type Downside as DownsideItem, type Outcome, type View } from "@/lib/decide";
import { againLabel, dueCheckIn, nextCheckIn, recordMarkdown, resultLabel } from "@/lib/followup";
import { download } from "@/lib/history";
import { store } from "@/lib/store";
import { toast } from "@/lib/toast";
import { intlLocale, withLocale } from "@orion/i18n/index.ts";
import s from "@/app/app/workspace.module.css";

const useDate = () => {
  const locale = useLang();
  return (ms: number) => new Date(ms).toLocaleDateString(withLocale(locale, intlLocale), { day: "numeric", month: "long", year: "numeric" });
};

/** One line under the verdict: what would hand the lead to the runner-up. */
export function ChangeLine({ run, v }: { run: DecisionRun; v: View }) {
  const t = useT();
  const c = changers(run, v);
  if (!c || (!c.byWeight && !c.byFact)) return null;
  const parts = [
    c.byWeight && t("if {factor} mattered more to you", { factor: c.byWeight }),
    c.byFact && (c.byFact.size === "small"
      ? t("if it is even a little better on {factor} than ORION estimates", { factor: c.byFact.factor })
      : c.byFact.size === "clear"
        ? t("if it is clearly better on {factor} than ORION estimates", { factor: c.byFact.factor })
        : t("only if it is far better on {factor} than ORION estimates", { factor: c.byFact.factor })),
  ].filter(Boolean) as string[];
  return (
    <p className={s.changeLine}>
      <Icon name="flip" size={15} />
      <span><span className="ink">{t("What would change this:")}</span> {t("{option} would come out ahead {conditions}.", { option: c.runner, conditions: parts.join(t(", or ")) })}</span>
    </p>
  );
}

/** Tell ORION what it doesn't know. The call moves only if the facts move it. */
export function SeeItDifferently({ run, onChange }: { run: DecisionRun; onChange: (run: DecisionRun) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const facts = run.facts ?? [];

  const rescore = async (nextFacts: string[]) => {
    setBusy(true);
    setResult(null);
    const before = view(run).call?.optionId;
    const next = { ...run, facts: nextFacts };
    try {
      const scored = await score(next, store.get().company);
      if (!scored.scores) { setResult(scored.notice ?? t("ORION couldn’t re-score just now. Try again in a moment.")); return; }
      const updated: DecisionRun = { ...next, scores: scored.scores, scenarios: scored.scenarios, source: "ai", notice: null, downside: null };
      const after = view(updated).call;
      onChange(updated);
      setText("");
      setResult(after && after.optionId !== before
        ? t("With what you added, {option} now comes out ahead.", { option: after.label })
        : t("Still {option}: what you added didn’t change the comparison enough.", { option: after?.label ?? "" }));
    } catch (e) {
      setResult(e instanceof ApiError && e.status === 401 ? e.message : t("ORION couldn’t re-score just now. Try again in a moment."));
    } finally { setBusy(false); }
  };

  if (!open) return <Button variant="ghost" icon="chat" onClick={() => setOpen(true)}>{t("See it differently?")}</Button>;
  return (
    <div className={s.panel} role="region" aria-label={t("See it differently?")}>
      <div className="stack gap-2">
        <span className="ink t-small" style={{ fontWeight: 500 }}>{t("What does ORION not know yet?")}</span>
        <p className="t-small">{t("ORION changes its call when the facts change, not because you disagree. Add something true about your situation and it scores everything again.")}</p>
      </div>
      {facts.length > 0 && (
        <ul className={s.facts}>
          {facts.map((f, i) => (
            <li key={i}><span>{f}</span>
              <button type="button" className="o-icon-btn" aria-label={t("Remove “{fact}”", { fact: f })} disabled={busy} onClick={() => void rescore(facts.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="stack gap-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void rescore([...facts, text.trim()].slice(-6)); }}>
        <textarea className="o-textarea" rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={t("e.g. The new job is fully remote, or I have six months of savings.")} aria-label={t("What does ORION not know yet?")} />
        <div className="row gap-3 wrap-row">
          <Button type="submit" variant="primary" disabled={busy || !text.trim()}>{busy ? t("Scoring again…") : t("Score it again with this")}</Button>
          <Button type="button" variant="ghost" onClick={() => { setOpen(false); setResult(null); }}>{t("Close")}</Button>
        </div>
      </form>
      {result && <p className="t-small ink" role="status">{result}</p>}
    </div>
  );
}

/** Jev's 0–4 worst-case level in words (the scale server/downside.ts asks on). */
const worstWords = (t: ReturnType<typeof useT>, level: number) =>
  [t("Hardly any downside"), t("A minor setback"), t("A real setback, months to recover"), t("A serious, lasting loss"), t("Severe, hard to recover")][Math.max(0, Math.min(4, Math.round(level)))];

/** Worst case and reversibility per option, from Jev, fetched when the person asks. */
export function Downside({ run, onChange }: { run: DecisionRun; onChange: (run: DecisionRun) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = (run.downside ?? []).filter((d) => run.options.some((o) => o.id === d.optionId));
  const complete = items.length === run.options.length;
  const check = async () => {
    setBusy(true); setError(null);
    try {
      const res = await api<{ options: DownsideItem[] }>("decision/downside", {
        context: withFacts(run).slice(0, 4000), stakes: run.stakes,
        options: run.options.slice(0, 6).map(({ id, label }) => ({ id, label })),
        business: run.lens === "business" ? store.get().company : undefined,
      });
      onChange({ ...run, downside: res.options });
    } catch (e) { setError(e instanceof ApiError ? e.message : t("The downside check is unavailable right now")); }
    finally { setBusy(false); }
  };
  return (
    <div className="stack gap-4">
      <p className="t-small" style={{ maxWidth: "64ch" }}>{t("For each option: how bad it gets if it goes wrong, and whether you could undo it. A choice you can undo is cheap to try; one you can’t deserves more care.")}</p>
      {complete && (
        <div className={s.downside}>
          {run.options.map((o) => {
            const d = items.find((x) => x.optionId === o.id)!;
            const undoable = d.reversible >= 0.6, locked = d.reversible <= 0.35;
            return (
              <div key={o.id} className={s.downsideRow}>
                <span className="ink t-small" style={{ fontWeight: 500 }}>{o.label}</span>
                <span className="stack gap-1">
                  <span className="t-small">{worstWords(t, d.worst)}</span>
                  <span className={s.severity} aria-hidden><span style={{ width: `${(d.worst / 4) * 100}%` }} /></span>
                </span>
                <span className="t-small" style={{ color: undoable ? "var(--success)" : locked ? "var(--warning)" : "var(--text)" }}>
                  {undoable ? t("Can be undone") : locked ? t("Hard to undo") : t("Partly reversible")} · {Math.round(d.reversible * 100)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
      {error && <Notice tone="warning">{error}</Notice>}
      <div><Button variant="secondary" icon="shield" onClick={check} disabled={busy}>{busy ? t("Checking the downside…") : complete ? t("Check again") : t("Check the downside")}</Button></div>
    </div>
  );
}

/** A link friends can answer without an account; they pick before they ever see ORION's call. */
export function AskFriends({ run, onChange, v }: { run: DecisionRun; onChange: (run: DecisionRun) => void; v: View }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<{ optionId: string; factorId: string | null; name: string; note: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const share = run.share && new Date(run.share.expiresAt).getTime() > Date.now() ? run.share : null;
  const link = share ? `${typeof location === "undefined" ? "" : location.origin}/s/${share.id}` : "";

  const load = async () => {
    if (!share) return;
    try { setAnswers((await api<{ responses: typeof answers }>(`share/${share.id}/results`, { ownerKey: share.ownerKey })).responses ?? []); }
    catch (e) { setError(e instanceof ApiError && e.status === 404 ? t("This link has expired.") : t("Couldn’t load the answers just now.")); }
  };
  useEffect(() => { void load(); }, [share?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const made = await api<{ shareId: string; ownerKey: string; expiresAt: string }>("share", {
        title: run.title.slice(0, 120), options: run.options.slice(0, 4).map(({ id, label }) => ({ id, label })),
        factors: run.factors.slice(0, 8).map(({ id, label }) => ({ id, label: label.slice(0, 40) })),
      });
      onChange({ ...run, share: { id: made.shareId, ownerKey: made.ownerKey, expiresAt: made.expiresAt } });
    } catch { setError(t("Couldn’t create a link just now. Try again in a moment.")); }
    finally { setBusy(false); }
  };
  const send = async () => {
    const text = t("Help me decide: {title}", { title: run.title });
    if (navigator.share) { try { await navigator.share({ title: text, text, url: link }); return; } catch { /* cancelled */ } }
    await navigator.clipboard?.writeText(link).then(() => toast(t("Link copied")), () => toast(t("Couldn’t copy the link")));
  };

  const votes = run.options.map((o) => ({ ...o, n: (answers ?? []).filter((a) => a.optionId === o.id).length })).sort((a, b) => b.n - a.n);
  const total = answers?.length ?? 0;
  return (
    <div className="stack gap-4">
      <p className="t-small" style={{ maxWidth: "64ch" }}>{t("Send a link to friends, family or your team. They pick an option and what matters most — without seeing ORION’s call, so they can’t be swayed by it. Only you see their answers. The link shows the title and options, never your full question.")}</p>
      {!share ? (
        <div><Button variant="secondary" icon="people" onClick={create} disabled={busy}>{busy ? t("Creating the link…") : t("Create a link to ask")}</Button></div>
      ) : (
        <>
          <div className="row gap-3 wrap-row">
            <code className={s.shareLink}>{link}</code>
            <Button variant="primary" icon="link" onClick={send}>{t("Send")}</Button>
            <Button variant="ghost" onClick={load}>{t("Refresh answers")}</Button>
          </div>
          {total === 0 ? <p className="t-small faint">{t("No answers yet.")}</p> : (
            <div className="stack gap-3">
              <span className="t-small">{t("{n} answers", { n: total })}{v.call ? ` · ${votes[0].n > 0 && votes[0].id === v.call.optionId ? t("Most of them agree with ORION.") : t("ORION’s call: {option}.", { option: v.call.label })}` : ""}</span>
              {votes.map((o) => (
                <div key={o.id} className="o-meter">
                  <span className="o-meter__label">{o.label}</span><span className="o-meter__value">{o.n}</span>
                  <span className="o-meter__track"><span className="o-meter__fill" style={{ width: `${total ? (o.n / total) * 100 : 0}%` }} /></span>
                </div>
              ))}
              {(answers ?? []).filter((a) => a.note).slice(0, 8).map((a, i) => (
                <p key={i} className="t-small"><span className="ink">{a.name || t("A friend")}:</span> {a.note}</p>
              ))}
            </div>
          )}
        </>
      )}
      {error && <Notice tone="warning">{error}</Notice>}
    </div>
  );
}

/** "How did it turn out?" — open any time after choosing; asked for at two and six months. */
export function CheckIn({ run, onChange }: { run: DecisionRun; onChange: (run: DecisionRun) => void }) {
  const t = useT();
  const date = useDate();
  const due = dueCheckIn(run);
  const [open, setOpen] = useState(due !== null);
  const [result, setResult] = useState<Outcome["result"] | null>(null);
  const [again, setAgain] = useState<Outcome["again"] | null>(null);
  const [note, setNote] = useState("");
  const next = nextCheckIn(run);
  const outcomes = run.outcomes ?? [];
  const save = () => {
    if (!result || !again) return;
    onChange({ ...run, outcomes: [...outcomes, { at: Date.now(), result, again, note: note.trim() || undefined }] });
    setOpen(false); setResult(null); setAgain(null); setNote("");
    toast(t("Saved. ORION will ask again later."));
  };
  return (
    <div className={s.panel} data-due={due !== null || undefined}>
      <div className="row between wrap-row gap-3">
        <span className="ink t-small" style={{ fontWeight: 500 }}>{due !== null ? t("It’s been a while — how did it turn out?") : t("How it turned out")}</span>
        {next && <span className="t-micro faint">{t("Next check-in: {date}", { date: date(next) })}</span>}
      </div>
      {outcomes.map((o, i) => (
        <p key={i} className="t-small">{date(o.at)} · <span className="ink">{resultLabel(o.result)}</span> · {againLabel(o.again)}{o.note ? ` — ${o.note}` : ""}</p>
      ))}
      {!open ? <div><Button variant="ghost" size="sm" onClick={() => setOpen(true)}>{t("Record how it’s going")}</Button></div> : (
        <div className="stack gap-3">
          <div className="row gap-2 wrap-row" role="group" aria-label={t("Compared with what you expected")}>
            {(["better", "as_expected", "worse"] as const).map((r) => <button key={r} type="button" className="o-chip" aria-pressed={result === r} onClick={() => setResult(r)}>{resultLabel(r)}</button>)}
          </div>
          <div className="row gap-2 wrap-row" role="group" aria-label={t("Knowing what you know now")}>
            {(["yes", "unsure", "no"] as const).map((a) => <button key={a} type="button" className="o-chip" aria-pressed={again === a} onClick={() => setAgain(a)}>{againLabel(a)}</button>)}
          </div>
          <textarea className="o-textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Anything worth remembering? (optional)")} aria-label={t("Note")} />
          <p className="t-micro faint">{t("You decided with what you knew then. This is for learning, not for blame.")}</p>
          <div className="row gap-3"><Button variant="primary" disabled={!result || !again} onClick={save}>{t("Save")}</Button><Button variant="ghost" onClick={() => setOpen(false)}>{t("Later")}</Button></div>
        </div>
      )}
    </div>
  );
}

/** Downloads the decision record as Markdown. */
export function RecordButton({ run }: { run: DecisionRun }) {
  const t = useT();
  const date = useDate();
  return (
    <Button variant="ghost" icon="download" onClick={() => download(`${run.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "decision"}.md`, recordMarkdown(run, date), "text/markdown")}>
      {t("Decision record")}
    </Button>
  );
}
