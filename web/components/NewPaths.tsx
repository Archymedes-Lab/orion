"use client";
// "New paths": options the person didn't list, judged next to the ones they did. Answer first — the sound pick and
// the bold bet — then every path with its gate: clear, check first (with the check), or ruled out.
import { useMemo, useState } from "react";
import { msg, withLocale } from "@orion/i18n/index.ts";
import { useLang, useT } from "./LocaleProvider";
import { Button, Notice, Tag } from "./ui";
import { creativeView, findPaths, limitLabel, addPath, type PathRow } from "@/lib/creative";
import { store } from "@/lib/store";
import type { DecisionRun } from "@/lib/decide";
import s from "@/app/app/workspace.module.css";

const STATUS = {
  clear: { tone: "success" as const, label: msg("Clear") },
  verify: { tone: "warning" as const, label: msg("Check first") },
  reject: { tone: "danger" as const, label: msg("Ruled out") },
};

export function NewPaths({ run, onChange }: { run: DecisionRun; onChange: (run: DecisionRun) => void }) {
  const t = useT();
  const locale = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = run.creative ?? null;
  const v = useMemo(() => (data ? withLocale(locale, () => creativeView(run, data)) : null), [run, data, locale]);

  async function find() {
    setBusy(true); setError(null);
    try { onChange({ ...run, creative: await findPaths(run, store.get().company) }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!data || !v) {
    return (
      <div className="stack gap-4">
        <p className="t-small" style={{ maxWidth: "64ch" }}>{t("ORION can look past the options you listed: it writes a few different kinds of approach, then judges them next to yours. An unfamiliar idea isn’t treated as risky — if ORION can’t tell whether it crosses a line, it gives you a quick check to run first, and you keep your current plan if the check fails.")}</p>
        {error && <Notice tone="warning" icon="bulb">{error}</Notice>}
        <div><Button variant="secondary" icon="spark" onClick={find} disabled={busy}>{busy ? t("Looking for new paths…") : t("Find new paths")}</Button></div>
      </div>
    );
  }

  const label = (id: string | null) => v.rows.find((r) => r.id === id)?.label;
  const sound = label(v.commit);
  const bold = v.innovation && v.innovation !== v.commit ? v.rows.find((r) => r.id === v.innovation) : null;
  return (
    <div className="stack gap-5">
      <div className="stack gap-2">
        <p className="ink" style={{ fontWeight: 500 }}>
          {sound ? t("Safest strong pick: {option}.", { option: sound }) : t("Nothing beats keeping things as they are yet.")}
          {bold && <> {t("Bold bet worth a small try: {option}.", { option: bold.label })}</>}
        </p>
        {v.escalate.length > 0 && <p className="t-small">{t("It’s still close: learning one more thing could be worth about {points} points. Compare {a} and {b} first.", { points: v.evpi, a: label(v.escalate[0]) ?? "", b: label(v.escalate[1]) ?? label(v.escalate[0]) ?? "" })}</p>}
      </div>
      {data.divergeFailed && (
        <Notice icon="bulb">
          {t("ORION couldn’t write new paths this time, so this compares only the options you listed.")}{" "}
          <button className={s.linkBtn} onClick={find} disabled={busy}>{busy ? t("Looking for new paths…") : t("Try again")}</button>
        </Notice>
      )}
      {error && <Notice tone="warning" icon="bulb">{error}</Notice>}
      <div className="stack gap-3">
        {v.rows.map((r) => <PathCard key={r.id} r={r} isBold={r.id === bold?.id} isSound={r.id === v.commit} data={data} run={run} onChange={onChange} />)}
      </div>
      <p className="t-micro" style={{ maxWidth: "70ch" }}>
        {data.judge === "typesafe"
          ? t("Judged by Jev, asked twice in different orders to cancel position bias, then calibrated. Scores are expected value on your current weights, with any check that fails counted as keeping your current plan.")
          : t("Judged by a general model, so the estimates are rougher. Scores are expected value on your current weights, with any check that fails counted as keeping your current plan.")}
      </p>
    </div>
  );
}

function PathCard({ r, isBold, isSound, data, run, onChange }: { r: PathRow; isBold: boolean; isSound: boolean; data: NonNullable<DecisionRun["creative"]>; run: DecisionRun; onChange: (run: DecisionRun) => void }) {
  const t = useT();
  return (
    <div className={s.factor} style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start" }}>
      <div className="stack gap-2">
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          <span className="ink t-small" style={{ fontWeight: 500 }}>{r.label}</span>
          <Tag tone={STATUS[r.status].tone}>{t(STATUS[r.status].label)}</Tag>
          {r.baseline && <Tag plain>{t("Current plan")}</Tag>}
          {!r.listed && <Tag tone="blue">{t("New path")}</Tag>}
          {isSound && <Tag tone="success">{t("Sound pick")}</Tag>}
          {isBold && <Tag tone="blue">{t("Bold bet")}</Tag>}
        </div>
        {r.description && <span className="t-small">{r.description}</span>}
        <span className="t-micro">{t("Approach: {niche} · novelty {pct}%", { niche: r.niche, pct: Math.round(r.novelty * 100) })}</span>
        {r.status === "verify" && (
          <span className="t-micro">
            {t("Unsure whether it crosses: {limits}.", { limits: r.checks.map((c) => limitLabel(data, c)).join(", ") })}
            {r.check && <> {t("Check first: {check}", { check: r.check })}</>}
          </span>
        )}
        {r.status === "reject" && <span className="t-micro">{t("Likely to cross a line you can’t undo, so ORION leaves it out.")}</span>}
      </div>
      <div className="stack gap-2" style={{ alignItems: "flex-end" }}>
        <span className="t-mono">{r.status === "reject" ? "—" : r.score}</span>
        {r.status !== "reject" && <span className="t-micro">{t("{pct}% best", { pct: Math.round(r.pBest * 100) })}</span>}
        {!r.listed && r.status !== "reject" && run.scores && (
          r.added ? <span className="t-micro">{t("In the comparison")}</span>
            : <Button size="sm" variant="ghost" icon="plus" onClick={() => onChange(addPath(run, data, r.id))}>{t("Compare")}</Button>
        )}
      </div>
    </div>
  );
}
