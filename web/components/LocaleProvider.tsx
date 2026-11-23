"use client";
// Hands the request's language (read from the cookie by the root layout) to client components. On first render in the
// browser it also sets the shared module language, so the decision engine and the API client speak it too.
//
// Client components read the language from here rather than from the module during render: the server renders many
// people at once and never changes the module language, so this keeps the server HTML and the first browser render
// identical. Engine calls made while rendering are wrapped in withLocale(locale, …) for the same reason.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getLocale, onLocaleChange, setLocale, tIn, type Locale } from "@orion/i18n/index.ts";
import type { T } from "@/lib/locale";

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const first = useRef(true);
  // Before any child renders, in the browser only. Nothing has subscribed yet, so no one is notified mid-render.
  if (first.current && typeof window !== "undefined") {
    first.current = false;
    if (getLocale() !== locale) setLocale(locale);
  }
  const [current, setCurrent] = useState<Locale>(locale);
  useEffect(() => onLocaleChange(setCurrent), []);
  // The server's answer after a refresh (cookie changed elsewhere, e.g. another tab).
  useEffect(() => {
    setCurrent(locale);
    if (getLocale() !== locale) setLocale(locale);
  }, [locale]);
  return <LocaleContext.Provider value={current}>{children}</LocaleContext.Provider>;
}

/** The current language; components that read it re-render when someone switches. */
export const useLang = (): Locale => useContext(LocaleContext);

/** `t` in the current language, safe during server rendering. */
export function useT(): T {
  const locale = useLang();
  return useCallback<T>((english, vars) => tIn(locale, english, vars), [locale]);
}
