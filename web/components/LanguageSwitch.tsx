"use client";
// The one control for choosing the language. Each language is named in itself. Choosing sets the cookie the server
// reads, switches the shared module language (client components update at once), and refreshes server components.
import { useRouter } from "next/navigation";
import { LOCALES, setLocale, type Locale } from "@orion/i18n/index.ts";
import { LOCALE_COOKIE, LOCALE_MAX_AGE } from "@/lib/locale";
import { useLang, useT } from "./LocaleProvider";

export function useChooseLocale() {
  const router = useRouter();
  return (next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_MAX_AGE}; samesite=lax`;
    document.documentElement.lang = next;
    setLocale(next);
    router.refresh();
  };
}

/**
 * `seg`: both languages side by side (desktop header, rail, footer).
 * `toggle`: one compact button naming the other language, for narrow bars.
 */
export function LanguageSwitch({ variant = "seg", className }: { variant?: "seg" | "toggle"; className?: string }) {
  const locale = useLang();
  const t = useT();
  const choose = useChooseLocale();
  if (variant === "toggle") {
    const other = LOCALES.find((l) => l.id !== locale)!;
    return (
      <button type="button" className={`o-lang-toggle ${className ?? ""}`} lang={other.id} onClick={() => choose(other.id)}
        title={t("Change language")}>
        {other.name}
      </button>
    );
  }
  return (
    <div className={`o-seg o-seg--sm ${className ?? ""}`} role="group" aria-label={t("Language")}>
      {LOCALES.map((l) => (
        <button key={l.id} type="button" lang={l.id} aria-pressed={l.id === locale} onClick={() => l.id !== locale && choose(l.id)}>{l.name}</button>
      ))}
    </div>
  );
}
