"use client";
import Link from "next/link";
import { useEffect } from "react";
import { getLocale } from "@orion/i18n/index.ts";
import { useT } from "./LocaleProvider";
import { Button } from "./ui";

/** Shared body of the error boundaries: what happened, in words, and two ways out. */
export function Fault({ error, retry, home = "/" }: { error: Error & { digest?: string }; retry: () => void; home?: string }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
    // Report the message and the page, never the content of a decision (see the privacy notice).
    void fetch("/api/orion/client-error", { method: "POST", headers: { "Content-Type": "application/json", "X-Orion-Lang": getLocale() }, body: JSON.stringify({ message: error.message.slice(0, 500), page: location.pathname }) }).catch(() => {});
  }, [error]);
  return (
    <div className="stack gap-5" role="alert" style={{ maxWidth: 560, paddingBlock: "var(--s-9)" }}>
      <span className="t-label">{t("Something went wrong")}</span>
      <h1 className="t-h1">{t("This page hit an error.")}</h1>
      <p className="t-body muted">{t("Your decisions are safe on this device. Try again, or go back and carry on.")}</p>
      {error.digest && <span className="t-mono faint">{t("Reference {digest}", { digest: error.digest })}</span>}
      <div className="row gap-3"><Button variant="primary" onClick={retry}>{t("Try again")}</Button><Link href={home} className="o-btn o-btn--ghost">{t("Go back")}</Link></div>
    </div>
  );
}
