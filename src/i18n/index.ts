// The interface language. English is the source: every string is written in English in the code and wrapped in
// `t()`, and the English text is the key into the Korean dictionary. A string without a Korean entry shows in English,
// and tests/i18n.test.js fails, so nothing ships half-translated.
//
// Plain TypeScript, no React: the decision engine, the exports and the server use it too. The server answers many
// people at once, so it never relies on the current language; it wraps its synchronous engine calls in `withLocale`.
import { ko } from "./ko/index.ts";

export type Locale = "en" | "ko";
export const LOCALES: { id: Locale; name: string }[] = [
  { id: "en", name: "English" },
  { id: "ko", name: "한국어" },
];
export const isLocale = (value: unknown): value is Locale => value === "en" || value === "ko";

const DICTIONARIES: Record<Locale, Record<string, string>> = { en: {}, ko };
const KEY = "orion.locale";

function stored(): Locale | null {
  try {
    const value = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return isLocale(value) ? value : null;
  } catch { return null; }
}

/** First visit: the device's language if ORION speaks it, else English. */
function detected(): Locale {
  try {
    const languages = typeof navigator !== "undefined" ? [...(navigator.languages ?? []), navigator.language] : [];
    if (languages.some((l) => typeof l === "string" && l.toLowerCase().startsWith("ko"))) return "ko";
  } catch { /* no navigator: native or server */ }
  try {
    if (Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("ko")) return "ko";
  } catch { /* no Intl locale */ }
  return "en";
}

let current: Locale = typeof window !== "undefined" ? stored() ?? detected() : "en";
const listeners = new Set<(locale: Locale) => void>();

export const getLocale = (): Locale => current;

export function setLocale(locale: Locale) {
  if (locale === current) return;
  current = locale;
  try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, locale); } catch { /* this visit only */ }
  for (const listener of listeners) listener(locale);
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs `fn` with `locale` as the language. `fn` must be synchronous: the language is restored when it returns. */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  const before = current;
  current = locale;
  try { return fn(); } finally { current = before; }
}

/**
 * The text in the current language. `{name}` placeholders are filled from `vars`. Write whole sentences, never
 * fragments glued together: word order differs between languages.
 */
export function t(english: string, vars?: Record<string, string | number>): string {
  return tIn(current, english, vars);
}

/** `t` in a named language, for code that must not depend on the current one (Next server components, the server). */
export function tIn(locale: Locale, english: string, vars?: Record<string, string | number>): string {
  const text = locale === "en" ? english : DICTIONARIES[locale][english] ?? english;
  return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
}

/**
 * Marks English text for translation without translating it yet: for tables and constants built when a module loads,
 * before anyone picks a language. Pass the value through `t()` where it is shown.
 */
export const msg = (english: string): string => english;

/** A list read as one phrase: "a, b and c" / "a, b 및 c". */
export function listPhrase(items: string[], joiner: "and" | "or" = "and"): string {
  if (items.length <= 1) return items.join("");
  if (current === "ko") return `${items.slice(0, -1).join(", ")} ${joiner === "and" ? "및" : "또는"} ${items[items.length - 1]}`;
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
}

/** BCP 47 tag for dates and numbers. */
export const intlLocale = (): string => (current === "ko" ? "ko-KR" : "en-GB");
