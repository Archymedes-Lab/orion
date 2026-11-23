// One scripted decision, scored as the engine would, for the landing page's Aftermath. Chosen because the options trade
// places over time: tuition and lost evenings are felt at once, while career growth and income build for years.
import { msg, tIn, type Locale } from "@orion/i18n/index.ts";
import type { DecisionRun } from "./decide";

const scores = (optionId: string, values: Record<string, number>, confidence: number) =>
  Object.entries(values).map(([factorId, value]) => ({ optionId, factorId, value, probabilityConfidence: confidence }));

export const DEMO_RUN: DecisionRun = {
  id: "demo-masters",
  createdAt: 0,
  question: msg("Should I do a master’s degree full-time, study part-time while working, or keep working?"),
  lens: "personal",
  title: msg("Master’s degree or keep working"),
  category: ["Career", "Education"],
  stakes: "major",
  safety: "normal",
  mode: "serious",
  source: "ai",
  notice: null,
  offline: false,
  options: [
    { id: "full", label: msg("Full-time master’s") },
    { id: "part", label: msg("Part-time while working") },
    { id: "keep", label: msg("Keep working") },
  ],
  factors: [
    { id: "gr", label: msg("Career growth"), weight: 0.3 },
    { id: "inc", label: msg("Income"), weight: 0.25 },
    { id: "cost", label: msg("Tuition cost"), weight: 0.25 },
    { id: "time", label: msg("Free time"), weight: 0.2 },
  ],
  scores: [
    ...scores("full", { gr: 9, inc: 8, cost: -7, time: -4 }, 0.6),
    ...scores("part", { gr: 5, inc: 4, cost: -3, time: -6 }, 0.62),
    ...scores("keep", { gr: 0, inc: 1, cost: 0, time: 3 }, 0.75),
  ],
  scenarios: null,
  duels: {},
  chosen: null,
};

/** The demo in a language: the same decision and numbers, its words translated. */
export function demoRun(locale: Locale): DecisionRun {
  const t = (english: string) => tIn(locale, english);
  return {
    ...DEMO_RUN,
    question: t(DEMO_RUN.question),
    title: t(DEMO_RUN.title),
    options: DEMO_RUN.options.map((o) => ({ ...o, label: t(o.label) })),
    factors: DEMO_RUN.factors.map((f) => ({ ...f, label: t(f.label) })),
  };
}
