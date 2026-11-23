// "Export everything" as something a person can actually read: a PDF with a chapter per decision, and a
// workbook with one tab per kind of record. Both are built from the same `DataExport` the JSON backup
// uses, and both are readings of it — ids become names, stored JSON becomes sentences, and nothing is
// shown that the app would not show on screen. The JSON export stays the thing that can be restored.
import type { DataExport } from "../db/decisions.ts";
import { PdfDocument } from "./pdf.ts";
import { buildWorkbook, type CellValue, type Sheet } from "./xlsx.ts";
import { dateLocale, score } from "./report.ts";
import { msg, t } from "../i18n/index.ts";
import { categoryLabel, term, words } from "../account/labels.ts";

type Row = Record<string, unknown>;

const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
const number = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && value !== null && value !== "" ? n : null;
};
const day = (value: unknown): string => {
  const raw = text(value);
  if (!raw) return "";
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(dateLocale(), { year: "numeric", month: "long", day: "numeric" }) : raw;
};
const shortDay = (value: unknown): string => {
  const raw = text(value);
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(dateLocale(), { year: "numeric", month: "short", day: "numeric" }) : raw;
};
// `GO_NO_GO` and `very_hard` are names in the model, not words on a page: `term` reads them out in the current language.
const yesNo = (value: unknown): string => (value === 1 || value === true || value === "1" ? t("Yes") : t("No"));
/** Columns that hold a JSON array are read back as one line, or left alone if they are not JSON. */
const list = (value: unknown): string => {
  const raw = text(value);
  if (!raw) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("; ");
  } catch { /* not JSON: it is already a sentence */ }
  return raw;
};
/** A decision's categories, stored as a JSON array of names, in the current language. */
const categories = (value: unknown): string => {
  const raw = text(value);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => (typeof item === "string" ? categoryLabel(item) : JSON.stringify(item))).join("; ");
  } catch { /* not JSON */ }
  return list(value);
};
const decisions = (count: number) => (count === 1 ? t("1 decision") : t("{n} decisions", { n: count }));
const untitled = () => t("Untitled decision");

/** Everything the two renderers need: the raw tables, plus the lookups that turn ids into names. */
function index(data: DataExport) {
  const table = (name: string): Row[] => (Array.isArray(data.tables?.[name]) ? (data.tables[name] as Row[]) : []);
  const decisions = [...table("decisions")].sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)));
  const options = table("options");
  const factors = table("factors");

  const decisionTitle = new Map(decisions.map((d) => [text(d.id), text(d.title) || untitled()]));
  const optionLabel = new Map(options.map((o) => [text(o.id), text(o.label)]));
  const optionDecision = new Map(options.map((o) => [text(o.id), text(o.decision_id)]));
  const factorLabel = new Map(factors.map((f) => [text(f.id), text(f.label)]));

  const group = (rows: Row[], key: string): Map<string, Row[]> => {
    const map = new Map<string, Row[]>();
    for (const row of rows) {
      const id = text(row[key]);
      const bucket = map.get(id);
      if (bucket) bucket.push(row);
      else map.set(id, [row]);
    }
    return map;
  };

  /** Factor weights are stored raw; a share of the decision is the weight against its siblings. */
  const shares = new Map<string, number>();
  for (const [, group_] of group(factors, "decision_id")) {
    const total = group_.reduce((sum, f) => sum + Math.max(0, number(f.weight) ?? 0), 0);
    for (const f of group_) shares.set(text(f.id), total > 0 ? Math.max(0, number(f.weight) ?? 0) / total : 0);
  }

  return {
    table,
    decisions,
    options,
    factors,
    titleOf: (id: unknown) => decisionTitle.get(text(id)) ?? "",
    labelOf: (id: unknown) => optionLabel.get(text(id)) ?? "",
    factorOf: (id: unknown) => factorLabel.get(text(id)) ?? "",
    decisionOfOption: (id: unknown) => optionDecision.get(text(id)) ?? "",
    shareOf: (id: unknown) => shares.get(text(id)) ?? null,
    group,
  };
}


const PREAMBLE = msg("Everything saved on this device. Scores are ORION's estimates, not facts.");

// ---------------------------------------------------------------------------------------------
// The workbook
// ---------------------------------------------------------------------------------------------

/** Every saved record as a workbook: a tab per kind, each one filtered, frozen and sized to its content. */
export function archiveWorkbook(data: DataExport): Uint8Array {
  const db = index(data);
  const exported = text(data.exportedAt) || new Date().toISOString();
  const decided = db.decisions.filter((d) => text(d.status) === "decided").length;
  const facts = db.table("user_preferences").filter((p) => text(p.key) === "context_fact");
  const affinities = db.table("user_preferences").filter((p) => text(p.key).startsWith("affinity:"));
  const dates = db.decisions.map((d) => text(d.created_at)).filter(Boolean).sort();

  const sheets: Sheet[] = [
    {
      name: t("Overview"),
      title: t("Your ORION data"),
      subtitle: `${t(PREAMBLE)} ${t("Exported {date}.", { date: day(exported) })}`,
      columns: [{ header: t("What"), format: "label", width: 30 }, { header: t("Value"), format: "long" }],
      rows: [
        [t("Decisions saved"), decisions(db.decisions.length)],
        [t("Decided"), decisions(decided)],
        [t("Still open"), decisions(db.decisions.length - decided)],
        [t("Options considered"), String(db.options.length)],
        [t("Factors weighed"), String(db.factors.length)],
        [t("Check-ins"), String(db.table("decision_checkins").length)],
        [t("Outcomes recorded"), String(db.table("decision_outcomes").length)],
        [t("Learned preferences"), String(affinities.length)],
        [t("Context lines"), String(facts.length)],
        [t("First decision"), dates.length ? day(dates[0]) : "—"],
        [t("Latest decision"), dates.length ? day(dates[dates.length - 1]) : "—"],
      ] as CellValue[][],
      note: t("Sharing keys are left out of this file. The JSON export is the complete copy, and the only one ORION can import back."),
    },
    {
      name: t("Decisions"),
      title: t("Decisions"),
      subtitle: t("Newest first."),
      columns: [
        { header: t("Decision"), format: "text" },
        { header: t("What you asked"), format: "long" },
        { header: t("Category"), format: "label" },
        { header: t("Stakes"), format: "label" },
        { header: t("Status"), format: "label" },
        { header: t("Chose"), format: "text" },
        { header: t("Started"), format: "date" },
        { header: t("Decided"), format: "date" },
        { header: t("How solid"), format: "label" },
      ],
      rows: db.decisions.map((d) => [
        text(d.title), text(d.raw_input), categories(d.category), term(d.stakes), term(d.status),
        db.labelOf(d.selected_option_id), text(d.created_at), text(d.decided_at), term(d.robustness_level),
      ]),
      note: db.decisions.length ? undefined : t("No decisions are saved on this device yet."),
    },
  ];

  const add = (sheet: Sheet) => { if (sheet.rows.length) sheets.push(sheet); };

  add({
    name: t("Options"),
    title: t("Options"),
    subtitle: t("Every option ORION weighed, with the one that was chosen marked."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Option"), format: "text" },
      { header: t("What it means"), format: "long" },
      { header: t("Score"), format: "score" },
      { header: t("Reversibility"), format: "label" },
      { header: t("Suggested by ORION"), format: "label" },
      { header: t("Why"), format: "long" },
      { header: t("Risks"), format: "long" },
    ],
    rows: db.options.map((o) => [
      db.titleOf(o.decision_id), text(o.label), text(o.description), number(o.jev_score),
      term(o.reversibility_level) || (number(o.reversibility) !== null ? t("{n}% reversible", { n: Math.round((number(o.reversibility) ?? 0) * 100) }) : ""),
      yesNo(o.generated), text(o.rationale), list(o.risks),
    ]),
  });

  add({
    name: t("What mattered"),
    title: t("What mattered"),
    subtitle: t("Each factor's share of its decision."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Factor"), format: "text" },
      { header: t("Share of the decision"), format: "percent" },
      { header: t("Where it came from"), format: "long" },
    ],
    rows: db.factors.map((f) => [db.titleOf(f.decision_id), text(f.label), db.shareOf(f.id), text(f.source) || term(f.provenance)]),
  });

  add({
    name: t("Scores"),
    title: t("Where each option gained or lost"),
    subtitle: t("Each option's value on each factor, from −10 to +10, before the factor's share is applied."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Option"), format: "text" },
      { header: t("Factor"), format: "text" },
      { header: t("Value"), format: "score" },
      { header: t("Confidence"), format: "percent" },
    ],
    rows: db.table("option_factor_values").map((v) => [
      db.titleOf(db.decisionOfOption(v.option_id)), db.labelOf(v.option_id), db.factorOf(v.factor_id),
      number(v.value), number(v.confidence),
    ]),
  });

  add({
    name: t("Possible outcomes"),
    title: t("Possible outcomes"),
    subtitle: t("How each option could play out, and how likely ORION thought each way was."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Option"), format: "text" },
      { header: t("Outcome"), format: "long" },
      { header: t("Likelihood"), format: "percent" },
      { header: t("Confidence"), format: "percent" },
    ],
    rows: db.table("outcomes").map((o) => [
      db.titleOf(db.decisionOfOption(o.option_id)), db.labelOf(o.option_id), text(o.label),
      number(o.probability), number(o.confidence),
    ]),
  });

  add({
    name: t("ORION's calls"),
    title: t("ORION's calls"),
    subtitle: t("What ORION concluded, and why."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Leader"), format: "text" },
      { header: t("Confidence"), format: "percent" },
      { header: t("How solid"), format: "label" },
      { header: t("In words"), format: "long" },
      { header: t("What would change it"), format: "long" },
      { header: t("When"), format: "date" },
    ],
    rows: db.table("decision_results").map((r) => [
      db.titleOf(r.decision_id), db.labelOf(r.leader_option_id), number(r.confidence),
      term(r.stability) || term(r.robustness_level), text(r.explanation), list(r.what_would_change), text(r.created_at),
    ]),
  });

  add({
    name: t("Your choices"),
    title: t("Your choices"),
    subtitle: t("What you chose, and how it sat against the comparison."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Chose"), format: "text" },
      { header: t("ORION's leader"), format: "text" },
      { header: t("Agreement"), format: "label" },
      { header: t("Gap"), format: "score" },
      { header: t("What it implies"), format: "long" },
      { header: t("Your reason"), format: "long" },
      { header: t("When"), format: "date" },
    ],
    rows: db.table("decision_choices").map((c) => [
      db.titleOf(c.id), db.labelOf(c.chosen_option_id), db.labelOf(c.leader_option_id), term(c.level),
      number(c.gap), c.implied_factor ? t("{factor} matters more than ORION assumed", { factor: db.factorOf(c.implied_factor) }) : "",
      text(c.reason), text(c.created_at),
    ]),
  });

  add({
    name: t("How it turned out"),
    title: t("How it turned out"),
    subtitle: t("What you recorded after the fact."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Rating"), format: "label" },
      { header: t("Expected"), format: "long" },
      { header: t("What happened"), format: "long" },
      { header: t("Notes"), format: "long" },
      { header: t("When"), format: "date" },
    ],
    rows: db.table("decision_outcomes").map((o) => [
      db.titleOf(o.decision_id), term(o.rating), text(o.expected_outcome), text(o.actual_outcome), text(o.notes),
      text(o.updated_at) || text(o.created_at),
    ]),
  });

  add({
    name: t("Check-ins"),
    title: t("Check-ins"),
    subtitle: t("The follow-ups ORION scheduled, and what you said when they came round."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Asks"), format: "long" },
      { header: t("Due"), format: "date" },
      { header: t("Status"), format: "label" },
      { header: t("Rating"), format: "label" },
      { header: t("Notes"), format: "long" },
    ],
    rows: [
      ...db.table("decision_checkins").map((c) => [db.titleOf(c.decision_id), text(c.prompt), text(c.due_at), term(c.status), term(c.rating), text(c.notes)]),
      ...db.table("decision_followups").map((f) => [db.titleOf(f.decision_id), text(f.prompt), text(f.due_at), term(f.status), term(f.rating), text(f.checkin_notes)]),
    ] as CellValue[][],
  });

  add({
    name: t("Questions"),
    title: t("Questions ORION asked"),
    subtitle: t("And what you answered."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Question"), format: "long" },
      { header: t("Answer"), format: "long" },
      { header: t("How much it helped"), format: "percent" },
      { header: t("Answered"), format: "date" },
    ],
    rows: db.table("questions").map((q) => [db.titleOf(q.decision_id), text(q.question), text(q.answer), number(q.information_gain), text(q.answered_at)]),
  });

  add({
    name: t("Risks"),
    title: t("Risks"),
    subtitle: t("What could go wrong, and what to watch for."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Option"), format: "text" },
      { header: t("Risk"), format: "long" },
      { header: t("Likelihood"), format: "label" },
      { header: t("Impact"), format: "label" },
      { header: t("What to do about it"), format: "long" },
      { header: t("Early warning"), format: "long" },
    ],
    rows: db.table("risks").map((r) => [
      db.titleOf(r.decision_id), db.labelOf(r.option_id), text(r.description), term(r.likelihood), term(r.impact),
      text(r.mitigation), text(r.warning_signal),
    ]),
  });

  add({
    name: t("Constraints"),
    title: t("Constraints"),
    subtitle: t("What an option had to satisfy."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Constraint"), format: "text" },
      { header: t("What it means"), format: "long" },
      { header: t("Kind"), format: "label" },
      { header: t("Severity"), format: "label" },
      { header: t("Value"), format: "text" },
    ],
    rows: db.table("constraints").map((c) => [
      db.titleOf(c.decision_id), text(c.name), text(c.description), term(c.type), term(c.severity),
      [text(c.operator), text(c.value) || text(c.numeric_value), text(c.unit)].filter(Boolean).join(" "),
    ]),
  });

  add({
    name: t("Evidence"),
    title: t("Evidence"),
    subtitle: t("What the analysis was built on."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Title"), format: "text" },
      { header: t("Says"), format: "long" },
      { header: t("Kind"), format: "label" },
      { header: t("Source"), format: "text" },
      { header: t("How reliable"), format: "percent" },
      { header: t("How relevant"), format: "percent" },
    ],
    rows: db.table("evidence").map((e) => [
      db.titleOf(e.decision_id), text(e.title), text(e.content), term(e.type), text(e.source),
      number(e.reliability), number(e.relevance),
    ]),
  });

  add({
    name: t("Assumptions"),
    title: t("Assumptions"),
    subtitle: t("What was taken as true. Anything you confirmed is marked."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Assumption"), format: "long" },
      { header: t("Confidence"), format: "percent" },
      { header: t("You confirmed it"), format: "label" },
      { header: t("Where it came from"), format: "text" },
    ],
    rows: db.table("assumptions").map((a) => [db.titleOf(a.decision_id), text(a.statement), number(a.confidence), yesNo(a.user_validated), text(a.source) || term(a.provenance)]),
  });

  add({
    name: t("Unknowns"),
    title: t("Unknowns"),
    subtitle: t("What was not known at the time."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Question"), format: "long" },
      { header: t("Importance"), format: "label" },
      { header: t("Settled"), format: "label" },
      { header: t("Answer"), format: "long" },
    ],
    rows: db.table("unknowns").map((u) => [db.titleOf(u.decision_id), text(u.question), term(u.importance), yesNo(u.resolved), text(u.resolution)]),
  });

  add({
    name: t("Criteria"),
    title: t("Criteria"),
    subtitle: t("What each option was measured against."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Criterion"), format: "text" },
      { header: t("What it means"), format: "long" },
      { header: t("Weight"), format: "percent" },
      { header: t("Direction"), format: "label" },
    ],
    rows: db.table("criteria").map((c) => [db.titleOf(c.decision_id), text(c.name), text(c.description), number(c.weight), term(c.direction)]),
  });

  add({
    name: t("Scenarios"),
    title: t("Scenarios"),
    subtitle: t("What ORION found when the estimates were moved."),
    columns: [
      { header: t("Decision"), format: "text" },
      { header: t("Scenario"), format: "text" },
      { header: t("What changes"), format: "long" },
      { header: t("Leader then"), format: "text" },
      { header: t("In words"), format: "long" },
    ],
    rows: db.table("decision_scenarios").map((s) => [db.titleOf(s.decision_id), text(s.name), list(s.changes), db.labelOf(s.leader_option_id), text(s.explanation)]),
  });

  add({
    name: t("About you"),
    title: t("What ORION has learned about you"),
    subtitle: t("Learned only from your own answers, and shown on the You screen."),
    columns: [
      { header: t("Kind"), format: "label" },
      { header: t("What"), format: "long" },
      { header: t("Times it came up"), format: "number" },
      { header: t("Where it came from"), format: "label" },
    ],
    rows: [
      ...facts.map((f) => [t("Context you wrote"), text(f.value), null, term(f.source) || t("You")]),
      ...affinities.map((a) => [t("Factor you keep picking"), words(text(a.key).replace(/^affinity:/, "")), number(a.value), t("Your answers")]),
    ] as CellValue[][],
  });

  return buildWorkbook(sheets, { title: t("ORION — your data"), created: exported });
}

// ---------------------------------------------------------------------------------------------
// The PDF
// ---------------------------------------------------------------------------------------------

/** Every saved decision as a readable document: a summary, the list, then a chapter each. */
export function archivePdf(data: DataExport): Uint8Array {
  const db = index(data);
  const exported = text(data.exportedAt) || new Date().toISOString();
  const decided = db.decisions.filter((d) => text(d.status) === "decided").length;
  const facts = db.table("user_preferences").filter((p) => text(p.key) === "context_fact");
  const affinities = db.table("user_preferences").filter((p) => text(p.key).startsWith("affinity:"))
    .sort((a, b) => (number(b.value) ?? 0) - (number(a.value) ?? 0));

  const doc = new PdfDocument({
    title: t("Your ORION data"),
    subtitle: t(PREAMBLE),
    meta: [day(exported), decisions(db.decisions.length), t("{n} decided", { n: decided }), db.options.length === 1 ? t("1 option") : t("{n} options", { n: db.options.length })],
    footer: t("Exported from ORION on {date}.", { date: day(exported) }),
  });

  doc.heading(t("At a glance"));
  doc.pairs([
    [t("Decisions saved"), decisions(db.decisions.length)],
    [t("Decided"), t("{decided} of {total}", { decided, total: db.decisions.length })],
    [t("Options considered"), String(db.options.length)],
    [t("Factors weighed"), String(db.factors.length)],
    [t("Check-ins"), String(db.table("decision_checkins").length)],
    [t("Learned preferences"), String(affinities.length)],
  ]);

  if (!db.decisions.length) {
    doc.heading(t("Your decisions"));
    doc.empty(t("No decisions are saved on this device yet. Work one through on Home and it will appear here."));
    return doc.bytes();
  }

  doc.heading(t("Your decisions"));
  doc.table(
    [
      { header: t("Decision"), weight: 3 },
      { header: t("Category"), weight: 1.2 },
      { header: t("Status"), weight: 1 },
      { header: t("Chose"), weight: 1.8 },
      { header: t("Started"), weight: 1.2, align: "right" },
    ],
    db.decisions.map((d) => [
      text(d.title) || untitled(), categories(d.category), term(d.status),
      db.labelOf(d.selected_option_id) || "—", shortDay(d.created_at),
    ]),
  );

  const options = db.group(db.options, "decision_id");
  const factors = db.group(db.factors, "decision_id");
  const results = db.group(db.table("decision_results"), "decision_id");
  const outcomes = db.group(db.table("decision_outcomes"), "decision_id");
  const checkins = db.group(db.table("decision_checkins"), "decision_id");
  const risks = db.group(db.table("risks"), "decision_id");
  const assumptions = db.group(db.table("assumptions"), "decision_id");
  const questions = db.group(db.table("questions"), "decision_id");
  const choices = new Map(db.table("decision_choices").map((c) => [text(c.id), c]));

  /** A bold sub-label and the block it introduces travel together, never split by a page break. */
  const label = (caption: string) => {
    doc.keepTogether(96);
    doc.paragraph(caption, { font: "bold", size: 10 });
  };

  doc.pageBreak();
  doc.heading(t("Decision by decision"));

  db.decisions.forEach((decision, position) => {
    const id = text(decision.id);
    if (position > 0) doc.spacer(10);
    doc.keepTogether(200);
    doc.subheading(text(decision.title) || untitled());
    doc.pairs([
      [t("What you asked"), text(decision.raw_input)],
      [t("Category"), categories(decision.category) || t("Everyday")],
      [t("Stakes"), term(decision.stakes) || t("Normal")],
      [t("Status"), decision.decided_at ? t("{status} on {date}", { status: term(decision.status), date: day(decision.decided_at) }) : term(decision.status)],
      [t("Chose"), db.labelOf(decision.selected_option_id) || t("Not decided yet")],
      [t("Started"), day(decision.created_at)],
    ]);

    const result = results.get(id)?.[0];
    if (result && text(result.explanation)) {
      doc.callout(text(result.explanation), { label: t("ORION's call") });
    }

    const mine = factors.get(id) ?? [];
    if (mine.length) {
      label(t("What mattered"));
      doc.bars(
        [...mine].sort((a, b) => (db.shareOf(b.id) ?? 0) - (db.shareOf(a.id) ?? 0)).map((f) => {
          const share = db.shareOf(f.id) ?? 0;
          return { label: text(f.label), value: share, note: `${Math.round(share * 100)}%` };
        }),
      );
    }

    const theirs = options.get(id) ?? [];
    if (theirs.length) {
      label(t("The options"));
      doc.table(
        [
          { header: t("Option"), weight: 2 },
          { header: t("What it means"), weight: 3 },
          { header: t("Score"), weight: 0.8, align: "right" },
          { header: t("Reversibility"), weight: 1.2 },
        ],
        [...theirs]
          .sort((a, b) => (number(b.jev_score) ?? -Infinity) - (number(a.jev_score) ?? -Infinity))
          .map((o) => [
            text(o.id) === text(decision.selected_option_id) ? t("{option}  (chosen)", { option: text(o.label) }) : text(o.label),
            text(o.description) || text(o.rationale),
            number(o.jev_score) === null ? "—" : score(number(o.jev_score) as number),
            term(o.reversibility_level) || (number(o.reversibility) !== null ? `${Math.round((number(o.reversibility) ?? 0) * 100)}%` : ""),
          ]),
      );
    }

    const choice = choices.get(id);
    if (choice && text(choice.reason)) doc.pairs([[t("Why you chose it"), text(choice.reason)]]);

    const answered = (questions.get(id) ?? []).filter((q) => text(q.answer));
    if (answered.length) {
      label(t("What you told ORION"));
      doc.bullets(answered.map((q) => `${text(q.question)} — ${text(q.answer)}`));
    }

    const theseRisks = risks.get(id) ?? [];
    if (theseRisks.length) {
      label(t("Risks"));
      doc.bullets(theseRisks.map((r) => {
        const likelihood = term(r.likelihood).toLowerCase();
        const impact = term(r.impact).toLowerCase();
        const risk = likelihood && impact ? t("{risk} ({likelihood} likelihood, {impact} impact)", { risk: text(r.description), likelihood, impact })
          : likelihood || impact ? t("{risk} ({level} impact)", { risk: text(r.description), level: likelihood || impact })
          : text(r.description);
        return `${risk}${text(r.mitigation) ? ` — ${text(r.mitigation)}` : ""}`;
      }));
    }

    const theseAssumptions = assumptions.get(id) ?? [];
    if (theseAssumptions.length) {
      label(t("Taken as true"));
      doc.bullets(theseAssumptions.map((a) => text(a.statement)));
    }

    const schedule = checkins.get(id) ?? [];
    if (schedule.length) {
      label(t("Check-ins"));
      doc.bullets(schedule.map((c) => {
        const when = day(c.due_at);
        const said = text(c.rating) ? ` — ${term(c.rating)}${text(c.notes) ? `: ${text(c.notes)}` : ""}` : ` — ${term(c.status) || t("Pending")}`;
        return `${when}: ${text(c.prompt) || t("How did it go?")}${said}`;
      }));
    }

    const outcome = outcomes.get(id)?.[0];
    if (outcome) {
      label(t("How it turned out"));
      doc.pairs([
        [t("Rating"), term(outcome.rating) || "—"],
        [t("What happened"), text(outcome.actual_outcome) || text(outcome.notes) || "—"],
      ]);
    }
  });

  if (facts.length || affinities.length) {
    doc.pageBreak();
    doc.heading(t("What ORION has learned about you"));
    doc.paragraph(t("Learned only from your own answers. The same list appears on the You screen, where you can remove any of it."));
    if (affinities.length) {
      const most = Math.max(...affinities.map((a) => number(a.value) ?? 0), 1);
      doc.bars(affinities.map((a) => ({
        label: words(text(a.key).replace(/^affinity:/, "")),
        value: (number(a.value) ?? 0) / most,
        note: (number(a.value) ?? 0) === 1 ? t("1 time") : t("{n} times", { n: number(a.value) ?? 0 }),
      })));
    }
    if (facts.length) {
      label(t("Context you wrote"));
      doc.bullets(facts.map((f) => text(f.value)));
    }
  }

  doc.spacer(12);
  doc.paragraph(t("Sharing keys are left out of this document. The JSON export is the complete copy, and the only one ORION can import back."), { size: 9, color: "#8A94A3" });
  return doc.bytes();
}

/** `orion-data-2026-10-09.pdf` — the date the export was taken, not the date it is opened. */
export function archiveFilename(data: DataExport, extension: "pdf" | "xlsx" | "json"): string {
  const stamp = (text(data.exportedAt) || new Date().toISOString()).slice(0, 10);
  return `orion-data-${stamp}.${extension}`;
}
