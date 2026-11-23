// The current language as React state: a screen that reads it re-renders when someone switches.
import { useSyncExternalStore } from "react";
import { getLocale, onLocaleChange, type Locale } from "./index.ts";

export function useLocale(): Locale {
  return useSyncExternalStore((notify) => onLocaleChange(notify), getLocale, () => "en");
}
