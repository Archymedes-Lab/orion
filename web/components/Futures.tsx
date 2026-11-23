"use client";
// Aftermath, in 3D: where each option's future could go, drawn from ORION's own estimates. The answer is printed before
// any interaction — which path comes out ahead, how likely each is to go well, when the lead changes — and the scene,
// the readout panel, the moment card and a hidden table all say the same thing, so nothing depends on seeing 3D.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, Star } from "./brand";
import { withLocale } from "@orion/i18n/index.ts";
import { useLang, useT } from "./LocaleProvider";
import { Tag } from "./ui";
import { rich } from "@/lib/rich";
import { futuresFor, type Futures as FuturesData } from "@/lib/futures";
import type { DecisionRun } from "@/lib/decide";
import type { SceneHandle, ViewMode } from "./futures-scene";
import s from "./futures.module.css";

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function Futures({ run, defaultOptionId, compact }: { run: DecisionRun; defaultOptionId: string; compact?: boolean }) {
  const [optionId, setOptionId] = useState(defaultOptionId);
  useEffect(() => setOptionId(defaultOptionId), [defaultOptionId]);
  const locale = useLang();
  // The engine words each moment ("In 6 months", likely turns, signs) in the current language.
  const data = useMemo(() => withLocale(locale, () => futuresFor(run, optionId)), [run, optionId, locale]);
  if (!data) return null;
  return <FuturesView run={run} data={data} optionId={optionId} onOption={setOptionId} compact={compact} />;
}

export function FuturesView({ run, data, optionId, onOption, compact }: {
  run: Pick<DecisionRun, "options" | "chosen">; data: FuturesData; optionId: string; onOption: (id: string) => void; compact?: boolean;
}) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneHandle | null>(null);
  const [gl, setGl] = useState<"loading" | "ok" | "none">("loading");
  const [moment, setMoment] = useState(() => Math.max(0, data.moments.findIndex((m) => m.days >= 180)));
  const [view, setView] = useState<ViewMode>("depth");
  // Phones start in the flat side view: it reads like a chart and fits a narrow screen; depth is one tap away.
  useEffect(() => { if (window.matchMedia("(max-width: 640px)").matches) setView("side"); }, []);
  const [playing, setPlaying] = useState(false);
  const [hint, setHint] = useState(true);
  const dataRef = useRef(data);
  dataRef.current = data;
  const onOptionRef = useRef(onOption);
  onOptionRef.current = onOption;
  // The scene loads asynchronously; these let it start from whatever moment and view are current by then.
  const momentRef = useRef(moment);
  momentRef.current = moment;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    let live = true;
    const probe = document.createElement("canvas");
    if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) { setGl("none"); return; }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void import("./futures-scene").then(({ createFuturesScene }) => {
      if (!live || !host.current || !overlay.current) return;
      scene.current = createFuturesScene(host.current, overlay.current, {
        reducedMotion: reduced,
        onMoment: (i) => { setPlaying(false); setMoment(i); },
        onPickPath: (id) => onOptionRef.current(id),
        onHoverPath: () => {},
        onInteract: () => setHint(false),
      });
      scene.current.setData(dataRef.current);
      scene.current.setMoment(momentRef.current);
      scene.current.setView(viewRef.current);
      setGl("ok");
    }).catch(() => setGl("none"));
    return () => { live = false; scene.current?.dispose(); scene.current = null; };
  }, []);

  useEffect(() => { scene.current?.setData(data); }, [data]);
  useEffect(() => { scene.current?.setMoment(moment); }, [moment, data]);
  useEffect(() => { scene.current?.setView(view); }, [view]);

  // Play walks through the moments, then stops at the horizon.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setMoment((m) => {
      if (m >= data.moments.length - 1) { setPlaying(false); return m; }
      return m + 1;
    }), 1400);
    return () => clearInterval(id);
  }, [playing, data.moments.length]);
  const play = () => { if (moment >= data.moments.length - 1) setMoment(0); setPlaying((p) => !p); };

  const onKey = useCallback((e: React.KeyboardEvent) => {
    const last = data.moments.length - 1;
    const go = (i: number) => { e.preventDefault(); setPlaying(false); setMoment(Math.max(0, Math.min(last, i))); };
    if (e.key === "ArrowRight") go(moment + 1);
    else if (e.key === "ArrowLeft") go(moment - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(last);
    else if (e.key === " ") { e.preventDefault(); play(); }
    else if (e.key === "+" || e.key === "=") scene.current?.zoom(1);
    else if (e.key === "-") scene.current?.zoom(-1);
    else if (e.key.toLowerCase() === "r") scene.current?.resetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment, data.moments.length]);

  const m = data.moments[moment];
  const pictured = data.paths.find((p) => p.pictured)!;
  const step = data.picture.steps.find((st) => st.days === m.days) ?? data.picture.steps[Math.min(moment, data.picture.steps.length - 1)];
  const horizon = data.moments[data.moments.length - 1];
  const win = horizon.readings[0];
  const second = horizon.readings[1];
  const changer = data.leadChange;
  const label = (id: string) => data.paths.find((p) => p.id === id)?.label ?? "";

  return (
    <section className={s.root} aria-label={t("Aftermath of choosing {option}", { option: data.picture.optionLabel })}>
      <header className={s.head}>
        <div className="stack gap-2">
          <span className="row gap-2"><Star size={12} /><span className="t-label blue">{t("Aftermath · {when}", { when: horizon.when })}</span></span>
          <h3 className="t-h1">
            {data.winner.close ? t("Too close to call by the horizon.") : rich(t("{option} comes out ahead."), { option: <span className={s.win}>{data.winner.label}</span> })}
          </h3>
          <p className="t-small" style={{ maxWidth: "64ch" }}>
            {second
              ? t("By {when}: {well} chance {option} goes well, against {otherWell} for {other}.", { when: horizon.when.toLowerCase(), well: pct(win.odds.well), option: win.label.toLowerCase(), otherWell: pct(second.odds.well), other: second.label.toLowerCase() })
              : t("By {when}: {well} chance {option} goes well.", { when: horizon.when.toLowerCase(), well: pct(win.odds.well), option: win.label.toLowerCase() })}
            {changer ? <> {t("{from} leads at first; {to} takes over around {when}.", { from: label(changer.fromId), to: label(changer.toId), when: data.moments[changer.index].when.toLowerCase() })}</> : null}
            {" "}{t("Estimates from ORION’s comparison, not a prediction.")}
          </p>
        </div>
        {run.options.length > 1 && (
          <div className="stack gap-2" style={{ alignItems: "flex-end" }}>
            <span className="t-micro">{t("Picture the path of")}</span>
            <div className="row gap-2 wrap-row" role="radiogroup" aria-label={t("Picture the aftermath of")} style={{ justifyContent: "flex-end" }}>
              {run.options.map((o) => (
                <button key={o.id} role="radio" aria-checked={o.id === optionId} className="o-chip" aria-pressed={o.id === optionId} onClick={() => onOption(o.id)}>
                  {o.id === data.winner.id && !data.winner.close && <Star size={10} />}{o.label}{o.id === run.chosen && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {data.picture.caution && <p className={`t-small ${s.caution}`}>{data.picture.caution}</p>}

      <div className={s.stageWrap}>
        <div className={s.stage} data-compact={compact || undefined} data-gl={gl} tabIndex={0} onKeyDown={onKey}
          aria-label={t("3D view of possible futures. {when}. Use arrow keys to move through time, space to play, plus and minus to zoom, R to reset.", { when: m.when })}>
          <div ref={host} className={s.canvas} />
          <div ref={overlay} className={s.overlay} aria-hidden />
          {gl === "none" && <p className={`t-small ${s.nogl}`}>{t("This browser can’t draw the 3D view — the readout and table say the same thing.")}</p>}

          <div className={s.legend} aria-hidden>
            <span><i style={{ background: "var(--blue-bright)" }} />{pictured.label}</span>
            {data.paths.length > 1 && <span><i style={{ background: "var(--series-b)" }} />{t("Other options")}</span>}
            <span><i className={s.legendGlow} />{t("Likely range")}</span>
            <span><i className={s.legendThreads} />{t("Other ways it could go")}</span>
          </div>

          <div className={s.tools}>
            <div className="o-seg" role="group" aria-label={t("View")}>
              <button type="button" aria-pressed={view === "depth"} onClick={() => setView("depth")}>{t("Depth")}</button>
              <button type="button" aria-pressed={view === "side"} onClick={() => setView("side")}>{t("Side")}</button>
            </div>
            <button type="button" className={s.tool} onClick={() => scene.current?.zoom(1)} aria-label={t("Zoom in")}><Icon name="plus" size={15} /></button>
            <button type="button" className={s.tool} onClick={() => scene.current?.zoom(-1)} aria-label={t("Zoom out")}><Icon name="minus" size={15} /></button>
            <button type="button" className={s.tool} onClick={() => scene.current?.resetView()} aria-label={t("Reset view")}><Icon name="flip" size={15} /></button>
          </div>

          {gl === "ok" && hint && <p className={s.hint} aria-hidden>{t("Drag to orbit · ⌘/Ctrl + scroll to zoom · click a path to picture it · double-click to reset")}</p>}
        </div>

        <div className={s.hud} aria-live="polite">
          <div className="row between gap-4">
            <span className="t-label">{t("At {when}", { when: m.when.toLowerCase() })}</span>
            <span className="t-micro">{m.checkIn ? t("ORION checks in") : t("Projection")}</span>
          </div>
          <ol className={s.hudRows}>
            {m.readings.map((r, i) => (
              <li key={r.id} data-pictured={r.id === optionId || undefined}>
                <button type="button" onClick={() => onOption(r.id)} className={s.hudRow} title={t("Picture {option}", { option: r.label })}>
                  <span className={s.hudName}><i style={{ background: r.id === optionId ? "var(--blue-bright)" : "var(--series-b)" }} />{r.label}</span>
                  <span className={s.hudScore}>{r.score}</span>
                  <span className={s.hudBar} aria-hidden><span style={{ width: pct(r.odds.well) }} /></span>
                  <span className={s.hudPct}>{pct(r.odds.well)}</span>
                  {i === 0 && !m.close && <span className={s.ahead}>{t("Ahead")}</span>}
                </button>
              </li>
            ))}
          </ol>
          <span className="t-micro">{t("Score out of 100 (50 = no change) · chance it goes well")}</span>
        </div>
      </div>

      <div className={s.timeline}>
        <button type="button" className={s.play} onClick={play} aria-label={playing ? t("Pause") : t("Play through time")}>
          {playing ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor" /><rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor" /></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M4 2.5v9l7.5-4.5z" fill="currentColor" /></svg>}
        </button>
        <nav className={s.scrub} aria-label={t("Moments")}>
          {data.moments.map((mo, i) => (
            <button key={mo.days} className={s.tick} aria-current={i === moment ? "step" : undefined} onClick={() => { setPlaying(false); setMoment(i); }}>
              <span className={s.tickBar} />
              <span className="t-mono">{String(i + 1).padStart(2, "0")}{changer?.index === i && <span className={s.tickCross} title={t("Lead changes here")}>◆</span>}</span>
              <span className={s.tickLabel}>{mo.when}</span>
              <span className={s.tickLead}>{mo.close ? t("Level") : label(mo.leaderId)}</span>
            </button>
          ))}
        </nav>
      </div>

      <article className={s.card} key={`${optionId}-${m.days}`}>
        <div className={s.cardWhen}>
          <span className="t-label">{m.checkIn ? t("{option} · check-in", { option: pictured.label }) : t("{option} · projection", { option: pictured.label })}</span>
          <span className={s.when}>{m.when}</span>
          <div className={s.odds} role="img" aria-label={t("Goes well {well}, mixed {mixed}, hard {hard}", { well: pct(step.odds.well), mixed: pct(step.odds.mixed), hard: pct(step.odds.hard) })}>
            <span style={{ flex: step.odds.well, background: "var(--blue-bright)" }} />
            <span style={{ flex: step.odds.mixed, background: "var(--line-strong)" }} />
            <span style={{ flex: step.odds.hard, background: "var(--series-b)" }} />
          </div>
          <div className={s.oddsKey}>
            <span>{t("Goes well")} <b>{pct(step.odds.well)}</b></span><span>{t("Mixed")} <b>{pct(step.odds.mixed)}</b></span><span>{t("Hard")} <b>{pct(step.odds.hard)}</b></span>
          </div>
        </div>
        <div className={s.cardBody}>
          <p className={s.likely}>{step.likely}</p>
          <div className={s.turns}>
            <div><Tag tone="success">{t("If it goes well")}</Tag><p className="t-small">{step.goodTurn}</p></div>
            <div><Tag tone="warning">{t("If it’s hard")}</Tag><p className="t-small">{step.hardTurn}</p></div>
          </div>
          {step.sign && <p className={s.sign}><Icon name="search" size={15} /> <span><span className="t-label">{t("Watch for")}</span><br />{step.sign}</span></p>}
        </div>
      </article>

      <div className="sr-only"><table>
        <caption>{t("Possible futures by moment: score out of 100 and chance it goes well, for each option.")}</caption>
        <thead><tr><th scope="col">{t("Moment")}</th>{data.paths.map((p) => <th key={p.id} scope="col">{p.label}</th>)}<th scope="col">{t("Ahead")}</th></tr></thead>
        <tbody>
          {data.moments.map((mo) => (
            <tr key={mo.days}>
              <th scope="row">{mo.when}</th>
              {data.paths.map((p) => { const r = mo.readings.find((x) => x.id === p.id)!; return <td key={p.id}>{t("{score}, {well} goes well", { score: r.score, well: pct(r.odds.well) })}</td>; })}
              <td>{mo.close ? t("Level") : label(mo.leaderId)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}
