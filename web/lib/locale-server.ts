// The request's language in server components: the `orion_locale` cookie, else the browser's Accept-Language.
// Server components never touch the shared module language (many people are served at once); they use tIn().
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { tIn, type Locale } from "@orion/i18n/index.ts";
import { LOCALE_COOKIE, localeFrom, type T } from "./locale";

export const requestLocale = cache(async (): Promise<Locale> => {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  return localeFrom(jar.get(LOCALE_COOKIE)?.value, head.get("accept-language"));
});

/** `t` bound to this request's language. */
export async function getT(): Promise<T> {
  const locale = await requestLocale();
  return (english, vars) => tIn(locale, english, vars);
}
