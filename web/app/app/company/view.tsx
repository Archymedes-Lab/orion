"use client";
// The company profile that travels with business decisions (server/business.ts playbook). Everything is optional and
// stays on this device; ORION never fills it in for you.
import { useEffect, useState } from "react";
import { GOALS, RISK, STAGES, TEAM_SIZES, BusinessProfileSchema, type BusinessProfile } from "@orion/business/schema.ts";
import { Button, Field, Index, Notice } from "@/components/ui";
import { Toast } from "@/components/client";
import { useT } from "@/components/LocaleProvider";
import { store, useStore } from "@/lib/store";
import s from "../workspace.module.css";

export function Company() {
  const t = useT();
  const saved = useStore((d) => d.company);
  const [p, setP] = useState<BusinessProfile>(saved);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => setP(saved), [saved]);
  const set = <K extends keyof BusinessProfile>(k: K, v: BusinessProfile[K] | "") => setP({ ...p, [k]: v === "" ? undefined : v });
  const parsed = BusinessProfileSchema.safeParse(p);

  return (
    <div className={s.page}>
      <div className="stack gap-7" style={{ maxWidth: 760 }}>
        <header className="stack gap-4 rise">
          <Index n="—">{t("Company profile")}</Index>
          <h1 className="t-d2">{t("Tell ORION about the business.")}</h1>
          <p className="t-lead muted">{t("Used whenever you ask “for a business”. Fill in what you know — every field is optional, and it stays on this device.")}</p>
        </header>
        <form className="stack gap-5 rise" style={{ "--i": 1 } as React.CSSProperties} onSubmit={(e) => {
          e.preventDefault();
          if (!parsed.success) return;
          store.setCompany(parsed.data);
          store.setLens("business");
          setToast(t("Company profile saved"));
        }}>
          <div className="grid" style={{ rowGap: "var(--s-5)" }}>
            <div className="c-1-6"><Field label={t("Company name")}><input className="o-input" maxLength={80} value={p.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field></div>
            <div className="c-7-6"><Field label={t("Industry")}><input className="o-input" maxLength={80} placeholder={t("e.g. B2B software, coffee roastery")} value={p.industry ?? ""} onChange={(e) => set("industry", e.target.value)} /></Field></div>
            <div className="c-1-6"><Field label={t("Stage")}>
              <select className="o-select" value={p.stage ?? ""} onChange={(e) => set("stage", e.target.value as BusinessProfile["stage"])}>
                <option value="">{t("Not set")}</option>{Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
              </select></Field></div>
            <div className="c-7-6"><Field label={t("Team size")}>
              <select className="o-select" value={p.team ?? ""} onChange={(e) => set("team", e.target.value as BusinessProfile["team"])}>
                <option value="">{t("Not set")}</option>{TEAM_SIZES.map((size) => <option key={size} value={size}>{t(size)}</option>)}
              </select></Field></div>
            <div className="c-1-6"><Field label={t("Runway, in months")} hint={t("Months of cash at today’s burn. Leave blank if profitable or unknown.")}>
              <input className="o-input" type="number" min={0} max={120} inputMode="numeric" value={p.runwayMonths ?? ""} onChange={(e) => set("runwayMonths", e.target.value === "" ? null : Number(e.target.value))} /></Field></div>
            <div className="c-7-6"><Field label={t("Appetite for risk")}>
              <select className="o-select" value={p.risk ?? ""} onChange={(e) => set("risk", e.target.value as BusinessProfile["risk"])}>
                <option value="">{t("Not set")}</option>{Object.entries(RISK).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
              </select></Field></div>
            <div className="c-1-6"><Field label={t("Main goal this year")}>
              <select className="o-select" value={p.goal ?? ""} onChange={(e) => set("goal", e.target.value as BusinessProfile["goal"])}>
                <option value="">{t("Not set")}</option>{Object.entries(GOALS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
              </select></Field></div>
            <div style={{ gridColumn: "1 / -1" }}><Field label={t("Anything else ORION should know")} hint={t("Business model, customers, constraints. Up to 600 characters.")}>
              <textarea className="o-textarea" maxLength={600} value={p.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field></div>
          </div>
          {!parsed.success && <Notice tone="danger">{parsed.error.issues[0]?.message ?? t("Check the fields above.")}</Notice>}
          <div className="row gap-3">
            <Button variant="primary" type="submit" arrow disabled={!parsed.success}>{t("Save profile")}</Button>
            <Button variant="ghost" type="button" onClick={() => { setP({}); store.setCompany({}); setToast(t("Profile cleared")); }}>{t("Clear")}</Button>
          </div>
        </form>
      </div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
