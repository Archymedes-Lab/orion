"use client";
import { useMemo } from "react";
import { Futures } from "./Futures";
import { useLang } from "./LocaleProvider";
import { demoRun } from "@/lib/demo";

/** The landing page's Aftermath: the real engine, picturing one scripted decision. */
export function FuturesDemo() {
  const locale = useLang();
  const run = useMemo(() => demoRun(locale), [locale]);
  return <Futures run={run} defaultOptionId="full" />;
}
