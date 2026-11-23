"use client";
// Replaces the root layout when it fails, so it brings its own document and minimal styles. The root layout (and its
// language provider) is gone, so this reads the module language, which the provider set on first load.
import { getLocale, t } from "@orion/i18n/index.ts";

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang={getLocale()}>
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#05080f", color: "#fff", fontFamily: "system-ui, sans-serif", wordBreak: "keep-all" }}>
        <title>{t("Something went wrong · ORION")}</title>
        <div style={{ maxWidth: 480, padding: 24 }}>
          <p style={{ letterSpacing: "0.22em", textTransform: "uppercase", fontSize: 11, opacity: 0.6 }}>ORION</p>
          <h1 style={{ fontWeight: 300, fontSize: 32 }}>{t("Something went wrong.")}</h1>
          <p style={{ opacity: 0.7 }}>{t("Your decisions are safe on this device.")}</p>
          <button onClick={retry} style={{ marginTop: 16, height: 44, padding: "0 20px", borderRadius: 999, border: 0, background: "#1C66FE", color: "#fff", fontSize: 14, cursor: "pointer" }}>{t("Try again")}</button>
        </div>
      </body>
    </html>
  );
}
