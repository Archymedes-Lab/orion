// The web app's language, shared by server and client: the `orion_locale` cookie (en | ko) and how a first visit picks
// one from the browser's Accept-Language when the cookie is absent.
import { isLocale, type Locale } from "@orion/i18n/index.ts";

export const LOCALE_COOKIE = "orion_locale";
/** One year: the choice should outlive a session. */
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;

export type T = (english: string, vars?: Record<string, string | number>) => string;

/** The language the browser prefers most among the ones ORION speaks; English when it names neither. */
export function fromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return "en";
  const ranked = header.split(",").map((part, i) => {
    const [tag, ...params] = part.trim().toLowerCase().split(";");
    const q = Number(params.find((p) => p.trim().startsWith("q="))?.trim().slice(2) ?? 1);
    return { tag, q: Number.isFinite(q) ? q : 0, i };
  }).sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag, q } of ranked) {
    if (q <= 0) continue;
    if (tag.startsWith("ko")) return "ko";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

export function localeFrom(cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  return isLocale(cookie) ? cookie : fromAcceptLanguage(acceptLanguage);
}
