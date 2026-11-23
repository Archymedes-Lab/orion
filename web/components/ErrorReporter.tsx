"use client";
// Errors that escape React's boundaries (event handlers, promises, lazy chunks) reach the operator's error log too.
// Message and page only, never what someone typed (see the privacy notice). A few per page view at most.
import { useEffect } from "react";
import { getLocale } from "@orion/i18n/index.ts";

const MAX_PER_PAGE = 3;
// Noise the browser or an extension makes that says nothing about ORION.
const IGNORE = /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|safari-extension:/;

export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const seen = new Set<string>();
    const report = (message: string) => {
      const text = message.slice(0, 500);
      if (!text || IGNORE.test(text) || seen.has(text) || sent >= MAX_PER_PAGE) return;
      seen.add(text);
      sent++;
      void fetch("/api/orion/client-error", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", "X-Orion-Lang": getLocale() },
        body: JSON.stringify({ message: text, page: location.pathname }),
      }).catch(() => {});
    };
    const onError = (e: ErrorEvent) => {
      if (e.filename && !e.filename.startsWith(location.origin)) return;
      report(e.error instanceof Error ? `${e.error.name}: ${e.error.message}` : e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      if (r instanceof Error && r.name === "AbortError") return;
      report(r instanceof Error ? `Unhandled: ${r.name}: ${r.message}` : `Unhandled: ${String(r)}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
