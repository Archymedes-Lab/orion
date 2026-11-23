// The two file exports: a PDF that is a real PDF, and an .xlsx that is a real workbook. Both are written
// by hand, so the structure every reader checks first — the xref table, the ZIP central directory — is
// asserted here rather than left to be discovered by a reader that refuses to open the file.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/export/report.ts";
import { archiveFilename, archivePdf, archiveWorkbook } from "../src/export/archive.ts";
import { buildWorkbook } from "../src/export/xlsx.ts";
import { measure, PdfDocument, wrap } from "../src/export/pdf.ts";

const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");

/** The CRC every ZIP reader recomputes before it trusts an entry. */
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ -1) >>> 0;
}

/** Walks the central directory and returns each entry, checking its CRC and local header on the way. */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  assert.ok(end >= 0, "end of central directory record is missing");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, "central directory signature");
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = latin1(bytes.subarray(offset + 46, offset + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50, `local header for ${name}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const content = bytes.subarray(start, start + size);
    assert.equal(crc32(content), crc, `CRC for ${name}`);
    entries.set(name, Buffer.from(content).toString("utf8"));
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return entries;
}

/** Every xref offset must land on the object it claims, or a reader rebuilds the file or gives up. */
function assertPdf(bytes) {
  const file = latin1(bytes);
  assert.ok(file.startsWith("%PDF-1.4\n"), "PDF header");
  assert.ok(file.trimEnd().endsWith("%%EOF"), "EOF marker");
  const start = Number(file.slice(file.lastIndexOf("startxref") + 9).trim().split("\n")[0]);
  assert.ok(Number.isFinite(start) && start > 0, "startxref points somewhere");
  assert.ok(file.slice(start).startsWith("xref\n"), "startxref points at the xref table");
  const size = Number(/\/Size (\d+)/.exec(file)[1]);
  // "xref", the "0 N" range line, then the free entry, then one line per object.
  const offsets = file.slice(start).split("\n").slice(3, size + 2).map((line) => Number(line.slice(0, 10)));
  assert.equal(offsets.length, size - 1, "one xref entry per object");
  offsets.forEach((offset, index) => {
    assert.ok(file.startsWith(`${index + 1} 0 obj`, offset), `object ${index + 1} is where the xref says`);
  });
  const pages = Number(/\/Type \/Pages \/Count (\d+)/.exec(file)[1]);
  assert.equal(pages, file.split("/Type /Page ").length - 1, "page count matches the page objects");
  return { file, pages };
}

const factor = (id, label, weight) => ({ id, label, weight, source: "You said this first" });
const option = (id, label, values) => ({
  id,
  label,
  description: `What ${label} means`,
  reversibility: 0.5,
  outcomes: [
    { id: `${id}-a`, label: "Goes well", probability: 0.6, probabilityConfidence: 0.7, factors: Object.entries(values).map(([factorId, value]) => ({ factorId, value })) },
    { id: `${id}-b`, label: "Goes badly", probability: 0.4, probabilityConfidence: 0.5, factors: Object.entries(values).map(([factorId, value]) => ({ factorId, value: value - 4 })) },
  ],
});

const input = {
  title: "Move to Lisbon or stay in Kigali",
  question: "A job offer in Lisbon, family in Kigali. Should I take it?",
  factors: [factor("f1", "Being near family", 0.6), factor("f2", "Pay", 0.4)],
  options: [option("o1", "Take the offer", { f1: -6, f2: 7 }), option("o2", "Stay", { f1: 8, f2: 1 })],
  signal: true,
  chosenId: "o2",
  call: { kind: "lean", headline: "Leaning towards staying.", line: "Family is most of this decision." },
  friends: null,
  nextCheckIn: "2026-11-21T00:00:00.000Z",
  date: new Date("2026-10-09T08:30:00.000Z"),
};

describe("laying text out for print", () => {
  it("measures the standard faces, and bold wider than regular", () => {
    assert.ok(measure("Hello", "regular", 10) > 0);
    assert.ok(measure("Hello", "bold", 10) > measure("Hello", "regular", 10));
    assert.equal(measure("", "regular", 10), 0);
  });

  it("keeps every wrapped line inside the width", () => {
    const lines = wrap("A job offer in Lisbon but my family and most of my work is in Kigali.", 120, "regular", 10);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(measure(line, "regular", 10) <= 120, `"${line}" fits`);
  });

  it("breaks a word that is wider than the line rather than running off the page", () => {
    const lines = wrap("supercalifragilisticexpialidocious", 40, "regular", 10);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(measure(line, "regular", 10) <= 40);
    assert.equal(lines.join(""), "supercalifragilisticexpialidocious");
  });

  it("writes character spacing on every run, so a tracked label does not stretch the page", () => {
    const doc = new PdfDocument({ title: "Spacing", footer: "f" });
    doc.heading("Tracked label");
    doc.paragraph("Ordinary body text.");
    const file = latin1(doc.bytes());
    const runs = file.match(/Tf [-\d.]+ Tc/g) ?? [];
    assert.ok(runs.length >= 2, "every text run sets its own spacing");
    assert.ok(runs.some((run) => run.endsWith("0 Tc")), "untracked text resets the spacing to zero");
  });
});

describe("one decision as a file", () => {
  it("builds a PDF a reader can open", () => {
    const { file, pages } = assertPdf(buildReport(input).pdf());
    assert.ok(pages >= 1);
    assert.ok(file.includes("Move to Lisbon or stay in Kigali"), "the title is in the document");
    assert.ok(file.includes("/BaseFont /Helvetica"), "the fonts are declared");
  });

  it("says in the PDF when nothing has been scored, instead of printing zeros", () => {
    const { file } = assertPdf(buildReport({ ...input, signal: false, call: null }).pdf());
    assert.ok(file.includes("Not scored yet"));
  });

  it("builds a workbook with a tab per view of the decision", () => {
    const parts = readZip(buildReport(input).workbook());
    assert.ok(parts.has("[Content_Types].xml"));
    assert.ok(parts.has("xl/workbook.xml"));
    assert.ok(parts.has("xl/styles.xml"));
    const names = [...(parts.get("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"/g))].map((m) => m[1]);
    assert.deepEqual(names, ["Summary", "Options", "What mattered", "Scores"]);
    const options = parts.get("xl/worksheets/sheet2.xml");
    assert.ok(options.includes("<t xml:space=\"preserve\">Stay</t>"), "option labels are written");
    assert.ok(options.includes("autoFilter"), "the table is filterable");
    assert.ok(options.includes("state=\"frozen\""), "the header stays put");
  });

  it("writes shares as numbers Excel can add up, not as text", () => {
    const mattered = readZip(buildReport(input).workbook()).get("xl/worksheets/sheet3.xml");
    assert.ok(/<c r="B5" s="\d+"><v>0\.6<\/v><\/c>/.test(mattered), mattered.slice(mattered.indexOf("<row r=\"5\"")).slice(0, 200));
  });

  it("still carries the text formats the share sheet and the clipboard use", () => {
    const report = buildReport(input);
    assert.ok(report.text.includes("THE QUESTION"));
    assert.ok(report.markdown.startsWith("# Move to Lisbon"));
    assert.ok(report.html.includes("<!doctype html>"));
    assert.equal(report.filename, "orion-move-to-lisbon-or-stay-in-kigali");
  });
});

const archive = {
  app: "orion",
  version: 1,
  exportedAt: "2026-10-09T08:30:00.000Z",
  tables: {
    decisions: [{ id: "d1", title: "Move to Lisbon", raw_input: "Offer in Lisbon", category: '["Career"]', stakes: "major", status: "decided", selected_option_id: "o2", created_at: "2026-09-14T10:00:00.000Z", decided_at: "2026-09-21T19:40:00.000Z", robustness_level: "fragile" }],
    options: [
      { id: "o1", decision_id: "d1", label: "Take the offer", description: "Relocate in January", jev_score: 4.2, reversibility: 0.3, generated: 0, risks: '["Visa delay"]', reversibility_level: "hard" },
      { id: "o2", decision_id: "d1", label: "Stay in Kigali", description: "Keep the role", jev_score: 5.1, reversibility: 0.9, generated: 0, risks: "[]", reversibility_level: "easy" },
    ],
    factors: [
      { id: "f1", decision_id: "d1", label: "Being near family", weight: 0.6, source: "You said this first" },
      { id: "f2", decision_id: "d1", label: "Pay", weight: 0.2, source: "Category: Career" },
    ],
    option_factor_values: [{ option_id: "o1", factor_id: "f1", value: -6, confidence: 0.8 }],
    decision_results: [{ id: "r1", decision_id: "d1", leader_option_id: "o2", confidence: 0.64, stability: "fragile", explanation: "Staying keeps what you weighted highest.", created_at: "2026-09-20T18:00:00.000Z" }],
    decision_shares: [{ id: "d1", share_id: "abc", owner_key: "SECRETOWNERKEY", created_at: "2026-09-18T00:00:00.000Z" }],
    user_preferences: [
      { id: "fact1", key: "context_fact", value: "Two children in school in Kigali.", source: "manual" },
      { id: "affinity:being near family", key: "affinity:being near family", value: "7", source: "answers" },
    ],
  },
};

describe("exporting everything", () => {
  it("names the file after the day the export was taken", () => {
    assert.equal(archiveFilename(archive, "pdf"), "orion-data-2026-10-09.pdf");
    assert.equal(archiveFilename(archive, "xlsx"), "orion-data-2026-10-09.xlsx");
  });

  it("opens as a workbook, with a tab only for the records that exist", () => {
    const parts = readZip(archiveWorkbook(archive));
    const names = [...(parts.get("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"/g))].map((m) => m[1]);
    assert.deepEqual(names.slice(0, 4), ["Overview", "Decisions", "Options", "What mattered"]);
    assert.ok(!names.includes("Risks"), "a kind of record with no rows gets no tab");
    assert.ok(names.includes("About you"));
  });

  it("reads ids back as the names they stand for", () => {
    const parts = readZip(archiveWorkbook(archive));
    const options = parts.get(`xl/worksheets/sheet3.xml`);
    assert.ok(options.includes("Move to Lisbon"), "the decision is named, not referenced by id");
    assert.ok(!options.includes(">d1<"), "no raw ids");
  });

  it("weighs each factor against its siblings rather than printing the stored number", () => {
    // 0.6 and 0.2 are stored; as shares of the decision they are 75% and 25%.
    const mattered = readZip(archiveWorkbook(archive)).get("xl/worksheets/sheet4.xml");
    assert.ok(mattered.includes("<v>0.75</v>"), mattered);
    assert.ok(mattered.includes("<v>0.25</v>"));
  });

  it("leaves sharing keys out of both readable exports", () => {
    assert.ok(!latin1(archivePdf(archive)).includes("SECRETOWNERKEY"));
    for (const part of readZip(archiveWorkbook(archive)).values()) assert.ok(!part.includes("SECRETOWNERKEY"));
  });

  it("builds a PDF with a chapter per decision", () => {
    const { file } = assertPdf(archivePdf(archive));
    assert.ok(file.includes("Your ORION data"));
    assert.ok(file.includes("DECISION BY DECISION"));
    assert.ok(file.includes("Staying keeps what you weighted highest."));
  });

  it("says so in words when there is nothing saved yet", () => {
    const empty = { app: "orion", version: 1, exportedAt: "2026-10-09T08:30:00.000Z", tables: {} };
    const { file } = assertPdf(archivePdf(empty));
    assert.ok(file.includes("No decisions are saved on this device yet"));
    const names = [...(readZip(archiveWorkbook(empty)).get("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"/g))].map((m) => m[1]);
    assert.deepEqual(names, ["Overview", "Decisions"]);
  });
});

describe("a workbook Excel will accept", () => {
  it("trims and de-duplicates tab names Excel would refuse", () => {
    const sheet = (name) => ({ name, columns: [{ header: "A" }], rows: [["x"]] });
    const parts = readZip(buildWorkbook([sheet("Budget/Plan"), sheet("Budget/Plan"), sheet("A very long tab name that Excel will not accept at all")]));
    const names = [...(parts.get("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"/g))].map((m) => m[1]);
    assert.equal(names[0], "Budget Plan");
    assert.equal(names[1], "Budget Plan 2");
    assert.ok(names[2].length <= 31);
    assert.equal(new Set(names).size, names.length);
  });

  it("escapes the characters that would break the XML", () => {
    const parts = readZip(buildWorkbook([{ name: "One", columns: [{ header: "Note" }], rows: [["Tom & Jerry <b> \"quoted\""]] }]));
    const sheet = parts.get("xl/worksheets/sheet1.xml");
    assert.ok(sheet.includes("Tom &amp; Jerry &lt;b&gt; &quot;quoted&quot;"));
  });

  it("declares as many styles as it defines", () => {
    const styles = readZip(buildWorkbook([{ name: "One", columns: [{ header: "A" }], rows: [] }])).get("xl/styles.xml");
    for (const [tag, child] of [["fonts", "font"], ["fills", "fill"], ["borders", "border"], ["cellXfs", "xf"]]) {
      const body = new RegExp(`<${tag} count="(\\d+)">([\\s\\S]*?)</${tag}>`).exec(styles);
      assert.equal(Number(body[1]), (body[2].match(new RegExp(`<${child}[ />]`, "g")) ?? []).length, `${tag} count`);
    }
  });

  it("writes a date as a number Excel can sort, not as text", () => {
    const sheet = readZip(buildWorkbook([{ name: "One", columns: [{ header: "When", format: "date" }], rows: [["2026-10-09T00:00:00.000Z"]] }])).get("xl/worksheets/sheet1.xml");
    // 1899-12-30 is day 0; 2026-10-09 is day 46304.
    assert.ok(sheet.includes("<v>46304</v>"), sheet.slice(sheet.indexOf("<row r=\"4\"")));
  });

  it("keeps a value it cannot read as a date as text rather than losing it", () => {
    const sheet = readZip(buildWorkbook([{ name: "One", columns: [{ header: "When", format: "date" }], rows: [["sometime last spring"]] }])).get("xl/worksheets/sheet1.xml");
    assert.ok(sheet.includes("sometime last spring"));
  });
});
