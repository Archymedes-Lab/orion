"use client";
// The pieces of a decision shared by /app (asking) and /app/d/[id] (a saved decision).
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./brand";
import { Button, Glass, Kbd, Notice, Skeleton } from "./ui";
import { intlLocale, withLocale } from "@orion/i18n/index.ts";
import { useLang, useT } from "./LocaleProvider";
import { Verdict } from "./Verdict";
import { toScore, view, type DecisionRun } from "@/lib/decide";
import { rich } from "@/lib/rich";
import s from "@/app/app/workspace.module.css";

export function RecentCard({ run }: { run: DecisionRun }) {
  const t = useT();
  const locale = useLang();
  const v = withLocale(locale, () => view(run));
  const lead = v.ranked[0];
  const chosen = run.options.find((o) => o.id === run.chosen);
  return (
    <Link href={`/app/d/${run.id}`} className={`o-card ${s.recent}`}>
      <div className="row between">
        <span className="t-mono faint">{new Date(run.createdAt).toLocaleDateString(withLocale(locale, intlLocale), { month: "short", day: "numeric" })}</span>
        {chosen ? <span className="o-tag o-tag--success">{t("Chose {option}", { option: chosen.label })}</span> : <span className="o-tag">{t("Undecided")}</span>}
      </div>
      <span className={s.recentTitle}>{run.question}</span>
      {lead && v.call && <span className="t-small" style={{ marginTop: "auto" }}>{rich(t("ORION: {option} · {score}"), { option: <span className="ink">{v.call.label}</span>, score: toScore(lead.jev) })}</span>}
    </Link>
  );
}

export function Loading({ question, stage, preview, onCancel }: { question: string; stage: "reading" | "scoring"; preview: string[]; onCancel: () => void }) {
  const t = useT();
  const steps = [
    { key: "reading", label: t("Reading your question") },
    { key: "scoring", label: preview.length ? t("Weighing {options}", { options: preview.join(" vs ") }) : t("Weighing the options") },
    { key: "call", label: t("Making the call") },
  ];
  const at = stage === "reading" ? 0 : 1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className={s.loading} aria-live="polite">
      <span className="t-label">{t("Working on it")}</span>
      <h1 className={s.question}>{question}</h1>
      <div className="o-progress" />
      <div className={s.stageList}>
        {steps.map((st, i) => (
          <div key={st.key} className={s.stageRow} data-state={i < at ? "done" : i === at ? "active" : "todo"}>
            <span className={s.dot} />{st.label}
          </div>
        ))}
      </div>
      <div className="stack gap-3" aria-hidden>
        <Skeleton h={180} r={28} />
        <Skeleton w="60%" h={14} />
        <Skeleton w="40%" h={14} />
      </div>
      <div className="row gap-2"><Button variant="ghost" size="sm" onClick={onCancel}>{t("Cancel")}</Button><Kbd>Esc</Kbd></div>
    </div>
  );
}

export function Result({ run, onChange, onAsk, onEdit }: { run: DecisionRun; onChange: (r: DecisionRun) => void; onAsk: () => void; onEdit: () => void }) {
  const v = view(run);
  if (v.duel) return <Duel run={run} factor={v.duel.factor} onAnswer={(winner) => onChange({ ...run, duels: { ...run.duels, [v.duel!.factor.id]: winner } })} onAsk={onAsk} />;
  return <Verdict run={run} onChange={onChange} onAsk={onAsk} onEdit={onEdit} />;
}

/** One tap per factor, most important first; ORION stops as soon as the rest can't change the answer. */
function Duel({ run, factor, onAnswer, onAsk }: { run: DecisionRun; factor: { id: string; label: string }; onAnswer: (winner: string | null) => void; onAsk: () => void }) {
  const t = useT();
  const answered = Object.keys(run.duels).length;
  return (
    <div className={s.result}>
      <header className="stack gap-4">
        <span className="t-label">{t("Quick question {n}", { n: answered + 1 })}</span>
        <h1 className={s.question}>{run.question}</h1>
        {run.notice && <Notice tone="blue" icon="bulb">{run.notice}</Notice>}
      </header>
      <Glass className={`${s.duel} rise`} key={factor.id}>
        <div className="row between">
          <span className="t-label blue">{t("On {factor}", { factor: factor.label.toLowerCase() })}</span>
          <div className={s.progressDots} aria-hidden>{run.factors.slice(0, 4).map((f, i) => <i key={f.id} data-on={i <= answered} />)}</div>
        </div>
        <h2 className="t-h1">{t("Which comes out ahead on {factor}?", { factor: factor.label.toLowerCase() })}</h2>
        <div className={s.duelOptions}>
          {run.options.map((o) => <button key={o.id} className={s.duelOption} onClick={() => onAnswer(o.id)}>{o.label}</button>)}
        </div>
        <div className="row between wrap-row gap-3">
          <Button variant="ghost" onClick={() => onAnswer(null)}>{t("About the same")}</Button>
          <span className="t-micro">{t("ORION stops asking as soon as the rest couldn’t change the answer.")}</span>
        </div>
      </Glass>
      <div><Button variant="ghost" size="sm" onClick={onAsk} icon="arrow-left">{t("New decision")}</Button></div>
    </div>
  );
}

/** Put ORION's reading right: rename, add or remove options and factors, then score again. */
export function Editor({ run, onCancel, onSave }: { run: DecisionRun; onCancel: () => void; onSave: (r: DecisionRun) => void }) {
  const t = useT();
  const [options, setOptions] = useState(run.options.map((o) => o.label));
  const [factors, setFactors] = useState(run.factors.map((f) => f.label));
  const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  const ok = clean(options).length >= 2 && clean(options).length <= 4 && clean(factors).length >= 1 && clean(factors).length <= 8;
  const save = () => {
    const opts = clean(options).map((label, i) => ({ id: run.options.find((o) => o.label === label)?.id ?? `opt_${i}_${Date.now().toString(36)}`, label }));
    const facs = clean(factors);
    const existing = facs.map((label) => run.factors.find((f) => f.label === label));
    const fallback = 1 / facs.length;
    const raw = facs.map((label, i) => ({ id: existing[i]?.id ?? `fac_${i}_${Date.now().toString(36)}`, label: label.slice(0, 40), weight: existing[i]?.weight ?? fallback, reason: existing[i]?.reason }));
    const total = raw.reduce((a, f) => a + f.weight, 0) || 1;
    onSave({ ...run, options: opts, factors: raw.map((f) => ({ ...f, weight: f.weight / total })) });
  };
  const List = ({ label, items, set, min, max, hint }: { label: string; items: string[]; set: (x: string[]) => void; min: number; max: number; hint: string }) => (
    <div className="stack gap-3">
      <div className="row between"><span className="o-field__label">{label}</span><span className="t-micro">{hint}</span></div>
      <div className={s.editRows}>
        {items.map((item, i) => (
          <div key={i} className="row gap-2">
            <input className="o-input" value={item} maxLength={80} aria-label={`${label} ${i + 1}`} onChange={(e) => set(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="o-icon-btn" disabled={items.length <= min} aria-label={t("Remove")} onClick={() => set(items.filter((_, j) => j !== i))}><Icon name="close" size={15} /></button>
          </div>
        ))}
      </div>
      {items.length < max && <div><Button size="sm" variant="ghost" icon="plus" onClick={() => set([...items, ""])}>{t("Add")}</Button></div>}
    </div>
  );
  return (
    <div className={s.result}>
      <header className="stack gap-3">
        <span className="t-label">{t("Edit what ORION understood")}</span>
        <h1 className={s.question}>{run.question}</h1>
        <p className="t-small">{t("ORION’s reading is a guess — most of all when the question is vague. Fix it here and it will score again.")}</p>
      </header>
      <Glass className={s.editor}>
        <div className="grid" style={{ rowGap: "var(--s-6)" }}>
          <div className="c-1-6">{List({ label: t("Options"), items: options, set: setOptions, min: 2, max: 4, hint: t("2 to 4") })}</div>
          <div className="c-7-6">{List({ label: t("What matters"), items: factors, set: setFactors, min: 1, max: 8, hint: t("1 to 8") })}</div>
        </div>
        <div className="row gap-3">
          <Button variant="primary" arrow disabled={!ok} onClick={save}>{t("Score again")}</Button>
          <Button variant="ghost" onClick={onCancel}>{t("Cancel")}</Button>
        </div>
      </Glass>
    </div>
  );
}
