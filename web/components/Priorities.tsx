"use client";
// Business priorities: what's urgent, what has the most leverage, what to do first. The answer comes first; the
// matrices that back it (Eisenhower, impact/effort, RICE, ICE, WSJF, leverage) sit underneath.
import { useMemo, useState } from "react";
import { msg } from "@orion/i18n/index.ts";
import { prioritize, type EffortQuadrant, type EisenhowerQuadrant } from "@orion/decision-engine/prioritize.ts";
import { useT } from "./LocaleProvider";
import { Button, Notice, Tag } from "./ui";
import { findPriorities } from "@/lib/priorities";
import { store } from "@/lib/store";
import type { DecisionRun } from "@/lib/decide";
import s from "@/app/app/workspace.module.css";

const EISENHOWER: { id: EisenhowerQuadrant; title: string; hint: string }[] = [
  { id: "do", title: msg("Do now"), hint: msg("Urgent and important") },
  { id: "schedule", title: msg("Schedule"), hint: msg("Important, not urgent") },
  { id: "delegate", title: msg("Delegate"), hint: msg("Urgent, less important") },
  { id: "drop", title: msg("Later or never"), hint: msg("Neither") },
];
const EFFORT: { id: EffortQuadrant; title: string; hint: string }[] = [
  { id: "quick_win", title: msg("Quick wins"), hint: msg("High impact, low effort") },
  { id: "big_bet", title: msg("Big bets"), hint: msg("High impact, high effort") },
  { id: "fill_in", title: msg("Fill-ins"), hint: msg("Low impact, low effort") },
  { id: "money_pit", title: msg("Money pits"), hint: msg("Low impact, high effort") },
];

export function Priorities({ run, onChange }: { run: DecisionRun; onChange: (run: DecisionRun) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = run.priorities;
  // Ratings for options that are no longer in the run are ignored; a new option needs a fresh rating.
  const current = data && run.options.every((o) => data.judgments.some((j) => j.optionId === o.id)) ? data : null;
  const p = useMemo(() => (current ? prioritize(current.judgments.filter((j) => run.options.some((o) => o.id === j.optionId))) : null), [current, run.options]);
  const name = (id: string | null) => run.options.find((o) => o.id === id)?.label ?? "";
  const list = (ids: string[]) => ids.map(name).join(", ");

  async function rate() {
    setBusy(true); setError(null);
    try { onChange({ ...run, priorities: await findPriorities(run, store.get().company) }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!p) {
    return (
      <div className="stack gap-4">
        <p className="t-small" style={{ maxWidth: "64ch" }}>{t("Rate each option the way operators prioritise: how urgent it is, how much it moves the goal, how many it reaches, how sure you can be, what it costs, what it unlocks and whether you can undo it. ORION then lays them out on the standard matrices and finds where they agree.")}</p>
        {data && !current && <Notice icon="bulb">{t("The options changed since they were rated.")}</Notice>}
        {error && <Notice tone="warning" icon="bulb">{error}</Notice>}
        <div><Button variant="secondary" icon="grid" onClick={rate} disabled={busy}>{busy ? t("Rating the options…") : data ? t("Rate again") : t("Rate priorities")}</Button></div>
      </div>
    );
  }

  const first = p.rows[0];
  return (
    <div className="stack gap-6">
      <div className="stack gap-2">
        <p className="ink" style={{ fontWeight: 500 }}>{t("Do first: {option}.", { option: name(p.first) })}</p>
        <p className="t-small">
          {p.urgent.length > 0 ? t("Urgent and important: {list}.", { list: list(p.urgent) }) : t("Nothing here is both urgent and important.")}{" "}
          {p.highestLeverage && t("Highest leverage: {option}.", { option: name(p.highestLeverage) })}{" "}
          {p.quickWins.length > 0 && t("Quick wins: {list}.", { list: list(p.quickWins) })}
        </p>
        <p className="t-micro">
          {p.agreement >= 0.7 ? t("The frameworks largely agree on this order.") : p.agreement >= 0.4 ? t("The frameworks partly agree; the order near the top is less certain.") : t("The frameworks disagree, so the order depends on which lens you trust.")}{" "}
          {first && t("Chance {option} truly comes first by cost of delay: {pct}%.", { option: name(first.optionId), pct: Math.round(first.pFirst * 100) })}
          {first?.door === "one_way" && <> {t("It is hard to undo, so decide it carefully.")}</>}
        </p>
      </div>

      <Matrix title={t("Urgent × important")} cells={EISENHOWER.map((q) => ({ ...q, ids: p.rows.filter((r) => r.eisenhower === q.id).map((r) => r.optionId) }))} name={name} />
      <Matrix title={t("Impact × effort")} cells={EFFORT.map((q) => ({ ...q, ids: p.rows.filter((r) => r.effortMatrix === q.id).map((r) => r.optionId) }))} name={name} />

      <div style={{ overflowX: "auto" }}>
        <table className="t-small" style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr className="t-micro" style={{ textAlign: "right" }}>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>{t("Order")}</th>
              <th style={{ padding: "6px 8px" }} title={t("Reach × impact × confidence ÷ effort")}>RICE</th>
              <th style={{ padding: "6px 8px" }} title={t("Impact × confidence × ease")}>ICE</th>
              <th style={{ padding: "6px 8px" }} title={t("Cost of delay ÷ job size")}>WSJF</th>
              <th style={{ padding: "6px 8px" }} title={t("Impact × what it unlocks ÷ effort")}>{t("Leverage")}</th>
              <th style={{ padding: "6px 8px" }}>{t("Door")}</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.optionId} style={{ borderTop: "1px solid var(--hair)", textAlign: "right" }}>
                <td style={{ textAlign: "left", padding: "8px" }}><span className="t-mono faint">{r.rank}</span> <span className="ink">{name(r.optionId)}</span></td>
                <td className="t-mono" style={{ padding: "8px" }}>{r.rice.toFixed(1)}</td>
                <td className="t-mono" style={{ padding: "8px" }}>{Math.round(r.ice)}</td>
                <td className="t-mono" style={{ padding: "8px" }}>{r.wsjf.toFixed(1)}</td>
                <td className="t-mono" style={{ padding: "8px" }}>{r.leverage.toFixed(1)}</td>
                <td style={{ padding: "8px" }}>{r.door === "one_way" ? <Tag tone="warning">{t("One-way")}</Tag> : <Tag plain>{t("Two-way")}</Tag>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="t-micro" style={{ maxWidth: "70ch" }}>
        {current!.judge === "typesafe" ? t("Rated by Jev, each question asked twice with the scale reversed, then calibrated.") : t("Rated by a general model, so the ratings are rougher.")}{" "}
        {t("The order is a vote across RICE, ICE, WSJF, leverage and the urgent × important matrix. A one-way door is hard to undo; a two-way door is cheap to reverse, so it can be decided fast.")}
      </p>
    </div>
  );
}

function Matrix({ title, cells, name }: { title: string; cells: { id: string; title: string; hint: string; ids: string[] }[]; name: (id: string) => string }) {
  const t = useT();
  return (
    <div className="stack gap-3">
      <span className="t-label">{title}</span>
      <div className={s.matrix}>
        {cells.map((c) => (
          <div key={c.id} className={s.matrixCell}>
            <span className="ink t-small" style={{ fontWeight: 500 }}>{t(c.title)}</span>
            <span className="t-micro">{t(c.hint)}</span>
            <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: "var(--s-2)" }}>
              {c.ids.length ? c.ids.map((id) => <span key={id} className={s.chip} title={name(id)}>{name(id)}</span>) : <span className="t-micro faint">—</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
