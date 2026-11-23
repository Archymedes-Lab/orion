"use client";
// The result, verdict first: one plain answer, the bars that back it, and the depth behind numbered disclosures.
import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { Icon } from "./brand";
import { Ambient } from "./Ambient";
import { AskFriends, ChangeLine, CheckIn, Downside, RecordButton, SeeItDifferently } from "./FollowUp";
import { Futures } from "./Futures";
import { NewPaths } from "./NewPaths";
import { Priorities } from "./Priorities";
import { addToBoard } from "@/lib/board";
import { msg, withLocale } from "@orion/i18n/index.ts";
import { useLang, useT } from "./LocaleProvider";
import { Button, Disclosure, Meter, Notice, Tag } from "./ui";
import { rich } from "@/lib/rich";
import { nudge, toScore, toUnit, view, type DecisionRun } from "@/lib/decide";
import { PHOTOS } from "@/lib/photos";
import s from "@/app/app/workspace.module.css";

const KIND = {
  clear: { tone: "success" as const, label: msg("Clear lead") },
  lean: { tone: "warning" as const, label: msg("Close call") },
  coin: { tone: "blue" as const, label: msg("Toss-up") },
};
const MODE = { playful: msg("Light"), everyday: msg("Everyday"), serious: msg("Serious") };

export function Verdict({ run, onChange, onAsk, onEdit }: {
  run: DecisionRun;
  onChange: (run: DecisionRun) => void;
  onAsk: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const locale = useLang();
  const [flips, setFlips] = useState(0);
  // The engine words the call, the cautions and the support text in the current language.
  const v = useMemo(() => withLocale(locale, () => view(run, flips)), [run, flips, locale]);
  const lead = v.ranked[0];
  const chosen = run.chosen ? run.options.find((o) => o.id === run.chosen) : null;
  const against = chosen && v.call && chosen.id !== v.call.optionId;
  // Numbered disclosures; a company decision gets its priority matrices right after the reasons.
  const sections = ["why", "downside", ...(run.lens === "business" ? ["priorities"] : []), "paths", "friends", "matters", "sure", "how"];
  const choose = (optionId: string) => onChange({ ...run, chosen: optionId, chosenAt: Date.now() });
  const n = (key: string) => String(sections.indexOf(key) + 1).padStart(2, "0");

  if (v.support) {
    return (
      <div className={s.result}>
        <h1 className={s.question}>{run.question}</h1>
        <Notice tone="danger" icon="shield"><strong className="ink">{v.support}</strong></Notice>
        <div className={s.actions}><Button onClick={onAsk} variant="secondary">{t("Ask something else")}</Button></div>
      </div>
    );
  }

  return (
    <div className={s.result}>
      <header className="stack gap-4 rise">
        <div className={s.crumbs}>
          <Tag plain>{run.lens === "business" ? t("Business") : t("Personal")}</Tag>
          <Tag plain>{t(MODE[run.mode])}</Tag>
          {run.source === "ai" && <Tag tone="blue">{t("Scored by ORION")}</Tag>}
          {run.source === "duel" && <Tag>{t("From your answers")}</Tag>}
          {run.offline && <Tag tone="warning">{t("Read on this device")}</Tag>}
        </div>
        <h1 className={s.question}>{run.question}</h1>
        <p className={s.understood}>
          {rich(t("ORION understood: {options}, weighing {factors}."), { options: <b>{run.options.map((o) => o.label).join(" vs ")}</b>, factors: run.factors.map((f) => f.label.toLowerCase()).join(", ") })}{" "}
          <button className={s.linkBtn} onClick={onEdit}>{t("Edit")}</button>
        </p>
      </header>

      {v.caution && <Notice icon="shield">{v.caution}</Notice>}
      {run.notice && run.source !== "ai" && <Notice tone="blue" icon="bulb">{run.notice}</Notice>}

      {v.call && lead && (
        <section className={`o-glass ${s.verdict} rise`} style={{ "--i": 1 } as React.CSSProperties} aria-labelledby="call">
          <div className={s.verdictPhoto}><Image src={PHOTOS.verdict.src} alt="" fill sizes="1080px" /><Ambient scene="night" intensity={0.9} /></div>
          <div className="stack gap-5">
            <div className="row gap-3">
              <span className="t-label" style={{ color: "var(--blue-bright)" }}>{t("ORION’s call")}</span>
              <Tag tone={KIND[v.call.kind].tone}>{t(KIND[v.call.kind].label)}</Tag>
            </div>
            <h2 id="call" className={s.call} style={v.call.headline.length > 30 ? { fontSize: "clamp(2.1rem, 1.4rem + 2.2vw, 3.4rem)", lineHeight: 1.05 } : undefined}>{v.call.headline}</h2>
            <p className={s.callLine}>{v.call.line}</p>
          </div>
          <div className={s.scoreBox}>
            {v.call.kind !== "coin" && (
              <div className="stack gap-2">
                <span className={s.bigScore}>{toScore(lead.jev)}<small>/100</small></span>
                <span className="t-small" style={{ color: "rgb(255 255 255 / 0.7)" }}>{t("Score for {option} — comes out ahead on what matters to you.", { option: lead.label })}</span>
              </div>
            )}
            <div className="stack gap-4">
              {v.ranked.map((r, i) => (
                <Meter key={r.id} label={r.generated ? t("{option} · suggested", { option: r.label }) : r.label} value={toUnit(r.jev)} display={String(toScore(r.jev))} lead={i === 0 && v.call?.kind !== "coin"}
                  band={[toUnit(r.low), toUnit(r.high)]} />
              ))}
            </div>
          </div>
        </section>
      )}

      {v.call && <ChangeLine run={run} v={v} />}

      {v.call && (
        <div className={`${s.actions} rise`} style={{ "--i": 2 } as React.CSSProperties}>
          {chosen ? (
            <Notice tone={against ? undefined : "blue"} icon="check">
              <span className="ink">{t("You chose {option}.", { option: chosen.label })}</span>{" "}
              {against ? t("Your call — the comparison is a guide, not a rule. If something mattered that ORION didn’t weigh, edit the factors and see.") : t("Saved to your history.")}
            </Notice>
          ) : null}
          {chosen ? (
            <>
              <ToBoard title={chosen.label} question={run.question} id={run.id} />
              <RecordButton run={run} />
            </>
          ) : (
            <>
              <Button variant="primary" arrow onClick={() => choose(v.call!.optionId)}>{t("I’ll go with {option}", { option: v.call.label })}</Button>
              {v.ranked.filter((r) => r.id !== v.call!.optionId).map((r) => (
                <Button key={r.id} variant="secondary" onClick={() => choose(r.id)}>{t("Choose {option}", { option: r.label })}</Button>
              ))}
              {v.call.kind === "coin" && <Button variant="ghost" icon="flip" onClick={() => setFlips((f) => f + 1)}>{t("Flip again")}</Button>}
            </>
          )}
          <Button variant="ghost" onClick={onAsk} style={{ marginLeft: "auto" }}>{t("New decision")}</Button>
        </div>
      )}

      {v.call && !chosen && <div className="rise" style={{ "--i": 2 } as React.CSSProperties}><SeeItDifferently run={run} onChange={onChange} /></div>}
      {chosen && <div className="rise" style={{ "--i": 2 } as React.CSSProperties}><CheckIn run={run} onChange={onChange} /></div>}

      {!v.call && !v.duel && (
        <Notice icon="bulb">
          {t("This is a serious decision and the options come out level, so ORION won’t settle it with a coin. Open “What matters” below and tell it which factors count most — the comparison re-ranks as you go.")}
        </Notice>
      )}

      {v.call && chosen && (
        <div className="rise" style={{ "--i": 3, paddingTop: "var(--s-4)" } as React.CSSProperties}>
          <Futures run={run} defaultOptionId={chosen.id} />
        </div>
      )}

      <div className="rise" style={{ "--i": 3 } as React.CSSProperties}>
        {v.call && !chosen && (
          <Disclosure n="00" title={t("Aftermath")} hint={t("What could follow, in 3D")}>
            <Futures run={run} defaultOptionId={v.call.optionId} compact />
          </Disclosure>
        )}
        <Disclosure n={n("why")} title={t("Why this answer")} hint={t("What tips it")}>
          <Drivers v={v} />
        </Disclosure>
        <Disclosure n={n("downside")} title={t("Downside")} hint={t("Worst case, and can you undo it")}>
          <Downside run={run} onChange={onChange} />
        </Disclosure>
        {run.lens === "business" && (
          <Disclosure n={n("priorities")} title={t("Priorities")} hint={t("Urgent, leverage, what first")}>
            <Priorities run={run} onChange={onChange} />
          </Disclosure>
        )}
        <Disclosure n={n("paths")} title={t("New paths")} hint={t("Options you didn’t list")}>
          <NewPaths run={run} onChange={onChange} />
        </Disclosure>
        <Disclosure n={n("friends")} title={t("Ask friends")} hint={t("Their pick, before they see ORION’s")}>
          <AskFriends run={run} onChange={onChange} v={v} />
        </Disclosure>
        <Disclosure n={n("matters")} title={t("What matters")} hint={t("{n} factors · adjust", { n: run.factors.length })} open={!v.call && !v.duel}>
          <p className="t-small" style={{ marginBottom: "var(--s-4)" }}>{t("How much each factor counts. Change one and the comparison re-ranks immediately; nothing is remembered until you choose.")}</p>
          <div className={s.factors}>
            {[...run.factors].sort((a, b) => b.weight - a.weight).map((f) => (
              <div key={f.id} className={s.factor}>
                <div className="stack">
                  <span className="ink t-small" style={{ fontWeight: 500 }}>{f.label}</span>
                  {f.reason && <span className="t-micro">{f.reason}</span>}
                </div>
                <div className="stack gap-1">
                  <div className={s.weight}><span style={{ width: `${Math.round(f.weight * 100)}%` }} /></div>
                  <span className="t-mono faint">{Math.round(f.weight * 100)}%</span>
                </div>
                <div className={s.nudge}>
                  <button className="o-icon-btn" aria-label={t("{factor} matters less", { factor: f.label })} onClick={() => onChange(nudge(run, f.id, "less"))}><Icon name="minus" size={15} /></button>
                  <button className="o-icon-btn" aria-label={t("{factor} matters more", { factor: f.label })} onClick={() => onChange(nudge(run, f.id, "more"))}><Icon name="plus" size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        </Disclosure>
        <Disclosure n={n("sure")} title={t("How sure ORION is")} hint={t("Ranges")}>
          <p className="t-small" style={{ marginBottom: "var(--s-4)" }}>{t("The lighter band on each bar is the range the score could reasonably fall in. Bands that overlap mean the call is close.")}</p>
          <div className="stack gap-3">
            {v.ranked.map((r) => (
              <div key={r.id} className="row between t-small">
                <span className="ink">{r.label}</span>
                <span className="t-mono muted">{t("{low}–{high} · confidence {pct}%", { low: toScore(r.low), high: toScore(r.high), pct: Math.round(r.confidence * 100) })}</span>
              </div>
            ))}
          </div>
        </Disclosure>
        <Disclosure n={n("how")} title={t("How is this calculated?")}>
          <p className="t-small" style={{ maxWidth: "64ch" }}>
            {run.source === "ai"
              ? t("ORION reads your question into options and the factors that matter, weights each factor, then scores every option against every factor in one pass (Jev, TypeSafe’s judgement model, answers first).")
              : run.source === "duel"
                ? t("ORION reads your question into options and the factors that matter, weights each factor, then scores every option against every factor in one pass — here, from your head-to-head answers.")
                : t("ORION reads your question into options and the factors that matter, weights each factor, then scores every option against every factor in one pass.")}{" "}
            {t("Each option’s score is the weighted sum of its factor scores, mapped to 0–100, with a range from how confident each estimate is.")}{" "}
            {t("The call is “clear” when the lead is bigger than that uncertainty and “close” when it isn’t.")}
          </p>
        </Disclosure>
      </div>
    </div>
  );
}

function Drivers({ v }: { v: ReturnType<typeof view> }) {
  const t = useT();
  const [lead, runner] = v.ranked;
  if (!lead || !runner || v.drivers.length === 0) return <p className="t-small">{t("Nothing separates the options yet.")}</p>;
  const max = Math.max(...v.drivers.map((d) => Math.abs(d.impact)), 0.01);
  return (
    <div className={s.drivers}>
      <p className="t-small" style={{ marginBottom: "var(--s-2)" }}>
        {rich(t("Each factor’s pull between {lead} and {runner}, already weighted by how much it matters."), { lead: <span className="ink">{lead.label}</span>, runner: <span className="ink">{runner.label}</span> })}
      </p>
      <div className={s.axisLegend}><span /><span style={{ textAlign: "right" }}>{t("← favours {option}", { option: runner.label })}</span><span>{t("favours {option} →", { option: lead.label })}</span><span /></div>
      {v.drivers.map((d) => {
        const w = `${(Math.abs(d.impact) / max) * 100}%`;
        return (
          <div key={d.id} className={s.driver}>
            <span className={s.driverLabel}>{d.label}</span>
            <span className={s.half}>{d.impact < 0 && <span className={s.bar} style={{ width: w, background: "var(--series-b)" }} />}</span>
            <span className={s.half}>{d.impact > 0 && <span className={s.bar} style={{ display: "block", width: w, background: "var(--series-a)" }} />}</span>
            <span className={s.driverValue}>{d.impact > 0 ? "+" : ""}{(d.impact * 5).toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Turns the choice into a task on the Prioritize board, linked back to this decision. */
function ToBoard({ title, question, id }: { title: string; question: string; id: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  if (state === "done") return <Link href="/app/prioritize" className="t-small" style={{ color: "var(--blue-bright)" }}>{t("Added to Prioritize — score it there")}</Link>;
  return (
    <span className="row gap-2">
      <Button variant="secondary" icon="grid" disabled={state === "busy"} onClick={async () => {
        setState("busy");
        try { await addToBoard({ title, notes: question, from: { kind: "decision", ref: id } }); setState("done"); }
        catch (e) { setState((e as Error).message); }
      }}>{t("Add to Prioritize")}</Button>
      {state !== "idle" && state !== "busy" && <span className="t-micro" style={{ color: "var(--warning)" }}>{state}</span>}
    </span>
  );
}
