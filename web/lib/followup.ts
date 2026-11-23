// After the choice: when to ask how it turned out, and a plain record of the decision to keep or share.
// Research behind it: regret is the main fear around big decisions, and people want to be able to say "I did the
// best I could with what I knew". So the record keeps what was known then, and the check-ins come at about two and
// six months, long enough for a choice to show how it is going.
import { msg, t } from "@orion/i18n/index.ts";
import { changers, toScore, view, withFacts, type DecisionRun, type View } from "./decide";

const DAY = 86_400_000;
export const CHECK_INS = [60, 180] as const;

/** When the person chose, for decisions saved before that was recorded. */
export const chosenAt = (run: DecisionRun) => run.chosenAt ?? run.editedAt ?? run.createdAt;

/** Which check-in is due now (index into CHECK_INS), or null. One per window; anything recorded since counts. */
export function dueCheckIn(run: DecisionRun, now = Date.now()): number | null {
  if (!run.chosen) return null;
  const since = chosenAt(run);
  for (let i = CHECK_INS.length - 1; i >= 0; i--) {
    const at = since + CHECK_INS[i] * DAY;
    if (now < at) continue;
    const answered = (run.outcomes ?? []).some((o) => o.at >= at - 10 * DAY);
    return answered ? null : i;
  }
  return null;
}

/** The next check-in date, or null when both are behind it. */
export function nextCheckIn(run: DecisionRun, now = Date.now()): number | null {
  if (!run.chosen) return null;
  const since = chosenAt(run);
  return CHECK_INS.map((d) => since + d * DAY).find((at) => at > now) ?? null;
}

const RESULT = { better: msg("Better than expected"), as_expected: msg("About as expected"), worse: msg("Worse than expected") } as const;
const AGAIN = { yes: msg("Would choose it again"), unsure: msg("Not sure"), no: msg("Would choose differently") } as const;
export const resultLabel = (r: keyof typeof RESULT) => t(RESULT[r]);
export const againLabel = (a: keyof typeof AGAIN) => t(AGAIN[a]);

/** The decision as Markdown: what was asked, what ORION said and why, what was chosen, what would reopen it. */
export function recordMarkdown(run: DecisionRun, date: (ms: number) => string, v: View = view(run)): string {
  const lines: string[] = [];
  const chosen = run.options.find((o) => o.id === run.chosen);
  const change = changers(run, v);
  lines.push(`# ${run.title}`, "", `${t("Decided")}: ${chosen ? date(chosenAt(run)) : t("not yet")} · ${t("Asked")}: ${date(run.createdAt)}`, "");
  lines.push(`## ${t("The question")}`, "", withFacts(run), "");
  lines.push(`## ${t("Options")}`, "", ...v.ranked.map((r) => `- ${r.label} — ${toScore(r.jev)}/100 (${toScore(r.low)}–${toScore(r.high)})`), "");
  if (v.call) lines.push(`## ${t("ORION’s call")}`, "", `${v.call.headline} ${v.call.line}`, "");
  if (v.drivers.length) lines.push(`## ${t("Why")}`, "", ...v.drivers.slice(0, 4).map((d) => `- ${d.label}: ${d.impact >= 0 ? "+" : ""}${(d.impact * 5).toFixed(1)}`), "");
  if (change) {
    lines.push(`## ${t("What would change this")}`, "");
    if (change.byWeight) lines.push(`- ${t("If {factor} mattered more to you, {option} would come out ahead.", { factor: change.byWeight, option: change.runner })}`);
    if (change.byFact) lines.push(`- ${t("If {option} turned out better on {factor} than ORION estimates.", { option: change.runner, factor: change.byFact.factor })}`);
    lines.push("");
  }
  if (run.downside?.length) {
    lines.push(`## ${t("Downside")}`, "", ...run.downside.map((d) => {
      const o = run.options.find((x) => x.id === d.optionId);
      return o ? `- ${o.label}: ${t("worst case {level}/4", { level: d.worst.toFixed(1) })}, ${t("{pct}% likely it can be undone", { pct: Math.round(d.reversible * 100) })}` : "";
    }).filter(Boolean), "");
  }
  lines.push(`## ${t("What I chose")}`, "", chosen ? chosen.label : t("Undecided"), "");
  if (run.note) lines.push(`## ${t("Note")}`, "", run.note, "");
  const next = nextCheckIn(run);
  if (next) lines.push(`${t("Review on")}: ${date(next)}`, "");
  if (run.outcomes?.length) {
    lines.push(`## ${t("How it turned out")}`, "", ...run.outcomes.map((o) => `- ${date(o.at)}: ${resultLabel(o.result)} · ${againLabel(o.again)}${o.note ? ` — ${o.note}` : ""}`), "");
  }
  lines.push("—", t("Recorded with ORION"));
  return lines.join("\n");
}
