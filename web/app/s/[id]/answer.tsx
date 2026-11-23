"use client";
// Answering a friend's question: which option you'd take and what matters most here. You never see ORION's call or
// other people's answers, so what you say is your own.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/LocaleProvider";
import { Button, Field, Notice, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

type Shared = { title: string; options: { id: string; label: string }[]; factors: { id: string; label: string }[] };

export function Answer({ id }: { id: string }) {
  const t = useT();
  const [shared, setShared] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [factor, setFactor] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  useEffect(() => {
    api<Shared>(`share/${id}`).then(setShared).catch((e) => setError(e instanceof ApiError ? e.message : t("This link has expired.")));
  }, [id, t]);

  if (error) return <div className="stack gap-5"><Notice tone="warning">{error}</Notice><div><Link href="/app" className="o-btn o-btn--primary">{t("Make your own decision with ORION")}</Link></div></div>;
  if (!shared) return <div className="stack gap-4"><Skeleton w={160} /><Skeleton h={40} /><Skeleton h={120} r={22} /></div>;
  if (state === "done") {
    return (
      <div className="stack gap-5">
        <span className="t-label">{t("Thank you")}</span>
        <h1 className="t-h1">{t("Your answer is with your friend.")}</h1>
        <p className="t-body muted">{t("They’ll see it next to ORION’s own comparison. Facing a decision of your own? ORION weighs it for you in a few seconds — no account needed to try.")}</p>
        <div><Link href="/app" className="o-btn o-btn--primary">{t("Try ORION")}</Link></div>
      </div>
    );
  }
  const submit = async () => {
    if (!pick) return;
    setState("busy");
    try { await api(`share/${id}/respond`, { optionId: pick, factorId: factor, name: name.trim() || undefined, note: note.trim() || undefined }); setState("done"); }
    catch (e) { setState("idle"); setError(e instanceof ApiError ? e.message : t("Something went wrong. Try again in a moment.")); }
  };
  return (
    <form className="stack gap-6" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="stack gap-3">
        <span className="t-label">{t("A friend asked for your view")}</span>
        <h1 className="t-h1">{shared.title}</h1>
        <p className="t-small">{t("Pick what you’d do in their place. They won’t see who else answered what, and you won’t see what ORION said.")}</p>
      </div>
      <div className="stack gap-3" role="radiogroup" aria-label={t("Which would you choose?")}>
        <span className="o-field__label">{t("Which would you choose?")}</span>
        {shared.options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={pick === o.id} aria-pressed={pick === o.id} className="o-chip" style={{ justifyContent: "flex-start", height: 52, fontSize: "var(--t-body)" }} onClick={() => setPick(o.id)}>{o.label}</button>
        ))}
      </div>
      {shared.factors.length > 0 && (
        <div className="stack gap-3">
          <span className="o-field__label">{t("What matters most here? (optional)")}</span>
          <div className="row gap-2 wrap-row">
            {shared.factors.map((f) => <button key={f.id} type="button" className="o-chip o-chip--quiet" aria-pressed={factor === f.id} onClick={() => setFactor(factor === f.id ? null : f.id)}>{f.label}</button>)}
          </div>
        </div>
      )}
      <Field label={t("A word of advice (optional)")}><textarea className="o-textarea" rows={3} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Field label={t("Your name (optional)")}><input className="o-input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div><Button type="submit" variant="primary" arrow disabled={!pick || state === "busy"}>{state === "busy" ? t("Sending…") : t("Send my answer")}</Button></div>
    </form>
  );
}
