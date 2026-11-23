// One decision as something to keep or send: plain text (share sheet, clipboard), Markdown, a printable
// page, a laid-out PDF and a workbook. Everything is derived from the same model the screens use, so a
// report never says something the app does not.
import type { DecisionFactor, DecisionOption } from "../types.ts";
import { normalizeWeights } from "../decision-engine/expectedValue.ts";
import { scoreAll } from "../decision-engine/uncertainty.ts";
import { impactOf, sensitivity } from "../decision-engine/sensitivity.ts";
import { bestThingToLearn } from "../decision-engine/informationGain.ts";
import type { TheCall } from "../decision-engine/call.ts";
import type { Tally } from "../share/tally.ts";
import { PdfDocument } from "./pdf.ts";
import { buildWorkbook, type Sheet } from "./xlsx.ts";
import { getLocale, intlLocale, t } from "../i18n/index.ts";

export interface ReportInput {
  title: string;
  question: string;
  options: DecisionOption[];
  factors: DecisionFactor[];
  /** False when nothing has been scored: the report says so instead of printing zeros as findings. */
  signal: boolean;
  chosenId: string | null;
  call: TheCall | null;
  friends?: Tally | null;
  nextCheckIn?: string | null;
  date?: Date;
}

export interface Report {
  text: string;
  markdown: string;
  html: string;
  filename: string;
  /** Built on demand: a reader only ever asks for one of them. */
  pdf: () => Uint8Array;
  workbook: () => Uint8Array;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
/** One decimal, without the "-0.0" that `toFixed` produces for a value just under zero. */
export const score = (n: number) => (Math.round(n * 10) / 10 + 0).toFixed(1);
/** Dates in the report's language. English keeps the device's own date format, as it always has. */
export const dateLocale = (): string | undefined => (getLocale() === "en" ? undefined : intlLocale());
const day = (d: Date | string) => new Date(d).toLocaleDateString(dateLocale(), { year: "numeric", month: "long", day: "numeric" });
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** What one option is worth on one factor, averaged over how its outcomes could land. */
const factorValue = impactOf;

export function buildReport(input: ReportInput): Report {
  const date = input.date ?? new Date();
  const label = (id: string | null) => input.options.find((o) => o.id === id)?.label ?? "";
  const ranked = scoreAll(input.options, input.factors).sort((a, b) => b.jev - a.jev);
  const weights = normalizeWeights(input.factors).sort((a, b) => b.weight - a.weight);
  const sens = input.signal && input.options.length > 1 ? sensitivity(input.options, input.factors) : null;
  const flip = sens?.flips[0];
  const learn = sens ? bestThingToLearn(input.options, input.factors) : null;

  const notScored = t("Not scored yet: ORION had no estimates for this decision, so it makes no comparison.");
  const noFlip = t("No single change would flip the result.");
  const callHeading = t("ORION's call");
  const votes = (count: number) => (count === 1 ? t("1 vote") : t("{n} votes", { n: count }));

  // Sections as [heading, lines, is the call]; each format renders the same content.
  const sections: [string, string[], boolean?][] = [];
  sections.push([t("The question"), [input.question]]);
  if (input.call) sections.push([callHeading, [`${input.call.headline} ${input.call.line}`], true]);
  sections.push([t("What mattered"), weights.map((f) => t("{factor} — {share} of the decision", { factor: f.label, share: pct(f.weight) }))]);
  sections.push([t("How the options compare"), input.signal
    ? ranked.map((r, i) => t("{rank}. {option} — score {score} (likely {low} to {high})", { rank: i + 1, option: label(r.optionId), score: score(r.jev), low: score(r.low), high: score(r.high) }))
    : [notScored]]);
  if (sens) {
    sections.push([t("What would change it"), [flip ? `${flip.description} ${flip.threshold}` : noFlip]]);
    sections.push([t("Best thing to learn next"), [learn!]]);
  }
  if (input.friends && input.friends.total > 0) {
    sections.push([t("What friends said"), [
      ...input.friends.votes.map((v) => `${v.label}: ${votes(v.count)}`),
      ...input.friends.notes.map((n) => `“${n.note}” — ${n.name} (${n.label})`),
    ]]);
  }
  sections.push([t("Decision"), [input.chosenId ? t("Chose: {option}", { option: label(input.chosenId) }) : t("Not decided yet.")]]);
  if (input.nextCheckIn) sections.push([t("Next check-in"), [day(input.nextCheckIn)]]);

  const footer = t("Made with ORION on {date}. Scores are estimates, not facts; the choice is yours.", { date: day(date) });
  const text = [input.title, "", ...sections.flatMap(([h, lines]) => [h.toUpperCase(), ...lines, ""]), footer].join("\n");
  const markdown = [`# ${input.title}`, "", ...sections.flatMap(([h, lines]) => [`## ${h}`, "", ...lines.map((l) => (/^\d+\. /.test(l) ? l : `- ${l}`)), ""]), `_${footer}_`, ""].join("\n");
  const html = `<!doctype html><html lang="${getLocale()}"><head><meta charset="utf-8"><title>${escape(input.title)} — ORION</title>
<style>body{font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;max-width:680px;margin:40px auto;padding:0 20px}
h1{font-weight:500;font-size:28px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#555;margin:28px 0 6px}
ul{padding-left:20px;margin:0}li{margin:2px 0}.call{background:#eef3ff;border-left:3px solid #3a6df0;padding:10px 14px}footer{margin-top:36px;color:#666;font-size:13px}</style>
</head><body><h1>${escape(input.title)}</h1>${sections.map(([h, lines, isCall]) =>
    `<h2>${escape(h)}</h2>${isCall ? `<p class="call">${escape(lines[0])}</p>` : `<ul>${lines.map((l) => `<li>${escape(l)}</li>`).join("")}</ul>`}`).join("")}
<footer>${escape(footer)}</footer></body></html>`;
  const slug = input.title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "decision";

  /** The same report, laid out: the call first, then what mattered, then the comparison. */
  const pdf = () => {
    const doc = new PdfDocument({
      title: input.title,
      subtitle: input.question,
      meta: [
        day(date),
        input.chosenId ? t("Chose {option}", { option: label(input.chosenId) }) : t("Not decided yet"),
        input.options.length === 1 ? t("1 option") : t("{n} options", { n: input.options.length }),
        input.factors.length === 1 ? t("1 factor") : t("{n} factors", { n: input.factors.length }),
      ],
      footer,
    });

    if (input.call) doc.callout(`${input.call.headline} ${input.call.line}`, { label: callHeading });

    doc.heading(t("What mattered"));
    if (weights.length) doc.bars(weights.map((f) => ({ label: f.label, value: f.weight, note: pct(f.weight) })));
    else doc.empty(t("No factors were recorded for this decision."));

    doc.heading(t("How the options compare"));
    if (input.signal) {
      doc.table(
        [
          { header: "#", weight: 0.4, align: "right" },
          { header: t("Option"), weight: 3.2 },
          { header: t("Score"), weight: 0.9, align: "right" },
          { header: t("Likely range"), weight: 1.3, align: "right" },
          { header: t("Confidence"), weight: 1, align: "right" },
        ],
        ranked.map((r, i) => [
          String(i + 1),
          r.optionId === input.chosenId ? t("{option}  (chosen)", { option: label(r.optionId) }) : label(r.optionId),
          score(r.jev),
          t("{low} to {high}", { low: score(r.low), high: score(r.high) }),
          pct(r.confidence),
        ]),
      );
      doc.paragraph(t("A score is ORION's estimate of how well an option does on what you said matters, from −10 to +10. The range is how far it could move if the estimates are off."), { size: 9, color: "#8A94A3" });
    } else {
      doc.empty(notScored);
    }

    // The grid behind the scores, while it still fits across the page.
    if (input.signal && input.factors.length > 0 && input.factors.length <= 6 && input.options.length > 0) {
      doc.heading(t("Where each option gained or lost"));
      doc.table(
        [{ header: t("Option"), weight: 2.2 }, ...weights.map((f) => ({ header: `${f.label} (${pct(f.weight)})`, weight: 1, align: "right" as const }))],
        input.options.map((option) => [option.label, ...weights.map((f) => score(factorValue(option, f.id)))]),
      );
      doc.paragraph(t("Each cell is that option's value on that factor, from −10 to +10, before the factor's share is applied."), { size: 9, color: "#8A94A3" });
    }

    if (sens) {
      doc.heading(t("What would change it"));
      doc.paragraph(flip ? `${flip.description} ${flip.threshold}` : noFlip);
      doc.heading(t("Best thing to learn next"));
      doc.paragraph(learn!);
    }

    if (input.friends && input.friends.total > 0) {
      doc.heading(t("What friends said"));
      doc.bars(input.friends.votes.map((v) => ({
        label: v.label,
        value: input.friends!.total ? v.count / input.friends!.total : 0,
        note: votes(v.count),
      })));
      if (input.friends.notes.length) doc.bullets(input.friends.notes.map((n) => `“${n.note}” — ${n.name} (${n.label})`));
    }

    doc.heading(t("Decision"));
    doc.pairs([
      [t("Chose"), input.chosenId ? label(input.chosenId) : t("Not decided yet")],
      [t("Next check-in"), input.nextCheckIn ? day(input.nextCheckIn) : t("None set")],
    ]);
    return doc.bytes();
  };

  /** The same report as a workbook, for anyone who wants to sort it or do their own arithmetic. */
  const workbook = () => {
    const sheets: Sheet[] = [
      {
        name: t("Summary"),
        title: input.title,
        subtitle: input.question,
        columns: [{ header: t("Field"), format: "label", width: 24 }, { header: t("Value"), format: "long" }],
        rows: [
          [t("Exported"), day(date)],
          [callHeading, input.call ? `${input.call.headline} ${input.call.line}` : t("No call yet")],
          [t("Leader"), input.signal && ranked[0] ? t("{option} (score {score})", { option: label(ranked[0].optionId), score: score(ranked[0].jev) }) : t("Not scored yet")],
          [t("Chose"), input.chosenId ? label(input.chosenId) : t("Not decided yet")],
          [t("What would change it"), sens ? (flip ? `${flip.description} ${flip.threshold}` : noFlip) : "—"],
          [t("Best thing to learn next"), learn ?? "—"],
          [t("Next check-in"), input.nextCheckIn ? day(input.nextCheckIn) : t("None set")],
        ],
        note: footer,
      },
      {
        name: t("Options"),
        title: t("How the options compare"),
        subtitle: input.signal ? t("Ranked by score. The range is how far the score could move if the estimates are off.") : t("Not scored yet, so the scores below are not a comparison."),
        columns: [
          { header: t("Rank"), format: "number" },
          { header: t("Option"), format: "text" },
          { header: t("Score"), format: "score" },
          { header: t("Range low"), format: "score" },
          { header: t("Range high"), format: "score" },
          { header: t("Confidence"), format: "percent" },
          { header: t("Reversibility"), format: "percent" },
          { header: t("Chosen"), format: "label" },
        ],
        rows: ranked.map((r, i) => {
          const option = input.options.find((o) => o.id === r.optionId);
          return [i + 1, label(r.optionId), r.jev, r.low, r.high, r.confidence, option?.reversibility ?? null, r.optionId === input.chosenId ? t("Yes") : ""];
        }),
      },
      {
        name: t("What mattered"),
        title: t("What mattered"),
        subtitle: t("Each factor's share of the decision."),
        columns: [{ header: t("Factor"), format: "text" }, { header: t("Share of the decision"), format: "percent" }, { header: t("Where it came from"), format: "long" }],
        rows: weights.map((f) => [f.label, f.weight, f.source ?? ""]),
      },
      {
        name: t("Scores"),
        title: t("Where each option gained or lost"),
        subtitle: t("Each option's value on each factor, from −10 to +10, before the factor's share is applied."),
        columns: [{ header: t("Option"), format: "text" }, { header: t("Factor"), format: "text" }, { header: t("Value"), format: "score" }, { header: t("Share of the decision"), format: "percent" }],
        rows: input.options.flatMap((option) => weights.map((f) => [option.label, f.label, Number(factorValue(option, f.id).toFixed(2)), f.weight])),
      },
    ];
    if (input.friends && input.friends.total > 0) {
      sheets.push({
        name: t("Friends"),
        title: t("What friends said"),
        subtitle: input.friends.total === 1 ? t("1 answer.") : t("{n} answers.", { n: input.friends.total }),
        columns: [{ header: t("Option"), format: "text" }, { header: t("Votes"), format: "number" }, { header: t("Note"), format: "long" }, { header: t("From"), format: "text" }],
        rows: [
          ...input.friends.votes.map((v) => [v.label, v.count, "", ""]),
          ...input.friends.notes.map((n) => [n.label, null, n.note, n.name]),
        ],
      });
    }
    return buildWorkbook(sheets, { title: `${input.title} — ORION`, created: date.toISOString() });
  };

  return { text, markdown, html, filename: `orion-${slug}`, pdf, workbook };
}

/** An all-day calendar event for a check-in, so the follow-up reaches someone who does not reopen ORION. */
export function checkInEvent(input: { title: string; prompt: string; dueAt: string; url?: string; now?: Date }): string {
  const due = new Date(input.dueAt);
  const ymd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const next = new Date(due.getTime() + 24 * 60 * 60 * 1000);
  const stamp = (input.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  // RFC 5545 text escaping; lines are short enough not to need folding.
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ORION//Check-in//EN", "BEGIN:VEVENT",
    `UID:${ymd(due)}-${Math.abs(hashCode(input.title + input.dueAt))}@orion`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(due)}`, `DTEND;VALUE=DATE:${ymd(next)}`,
    `SUMMARY:${esc(t("ORION check-in: {title}", { title: input.title }).slice(0, 120))}`,
    `DESCRIPTION:${esc(`${input.prompt}${input.url ? ` ${t("Open ORION: {url}", { url: input.url })}` : ""}`)}`,
    "BEGIN:VALARM", "TRIGGER:PT9H", "ACTION:DISPLAY", `DESCRIPTION:${esc(input.prompt)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
