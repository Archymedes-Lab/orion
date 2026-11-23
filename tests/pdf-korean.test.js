// Korean in the hand-written PDF: Hangul is drawn with Adobe's non-embedded Korean CID font
// (HYGoThic-Medium, UniKS-UCS2-H) as UCS-2 hex strings, and that font is only written into files
// that need it, so English reports are unchanged.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { measure, PdfDocument, wrap } from "../src/export/pdf.ts";

const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");

/** Every xref offset must land on the object it claims. */
function assertXref(file) {
  const start = Number(file.slice(file.lastIndexOf("startxref") + 9).trim().split("\n")[0]);
  assert.ok(file.slice(start).startsWith("xref\n"), "startxref points at the xref table");
  const size = Number(/\/Size (\d+)/.exec(file)[1]);
  const offsets = file.slice(start).split("\n").slice(3, size + 2).map((line) => Number(line.slice(0, 10)));
  assert.equal(offsets.length, size - 1, "one xref entry per object");
  offsets.forEach((offset, index) => assert.ok(file.startsWith(`${index + 1} 0 obj`, offset), `object ${index + 1}`));
}

const ucs2 = (text) => Array.from(text, (ch) => ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join("");

function build(title, body) {
  const doc = new PdfDocument({ title, subtitle: body, meta: [body], footer: body });
  doc.heading(body);
  doc.paragraph(body);
  doc.paragraph(body, { font: "bold" });
  doc.bullets([body]);
  doc.pairs([[body, body]]);
  doc.bars([{ label: body, value: 0.5, note: body }]);
  doc.table([{ header: body }, { header: "n", align: "right" }], [[body, "1"]]);
  doc.pageBreak();
  doc.callout(body, { label: body });
  return latin1(doc.bytes());
}

describe("PDF in Korean", () => {
  it("writes the Korean CID font and hex-encoded Hangul", () => {
    const file = build("리스본으로 갈까요?", "연봉이 30% 올라요");
    assertXref(file);
    assert.match(file, /\/Subtype \/Type0 \/BaseFont \/HYGoThic-Medium-UniKS-UCS2-H \/Encoding \/UniKS-UCS2-H/);
    assert.match(file, /\/Subtype \/CIDFontType0 \/BaseFont \/HYGoThic-Medium \/CIDSystemInfo << \/Registry \(Adobe\) \/Ordering \(Korea1\) \/Supplement 1 >>/);
    assert.match(file, /\/DW 1000 \/W \[1 95 500/);
    assert.match(file, /\/Type \/FontDescriptor \/FontName \/HYGoThic-Medium \/Flags \d+ \/FontBBox \[[^\]]+\] \/ItalicAngle 0 \/Ascent \d+ \/Descent -\d+ \/CapHeight \d+ \/StemV \d+/);
    assert.equal((file.match(/\/Subtype \/Type0/g) ?? []).length, 1, "one Korean font, shared by every page");
    assert.ok(/\/K1 \d+ 0 R >> >>/.test(file), "pages list the Korean font in their resources");
    // Hangul goes to the CID font, the digits and the space stay in Helvetica.
    assert.ok(file.includes(`/K1 10.5 Tf <${ucs2("연봉이")}> Tj /F1 10.5 Tf ( 30% ) Tj /K1 10.5 Tf <${ucs2("올라요")}> Tj`));
    // Bold Korean is filled and stroked, and the render mode is put back.
    assert.match(file, /2 Tr [\d.]+ w [\d. ]+RG <[0-9A-F]+> Tj 0 Tr/);
    assert.ok(file.includes(`/Title <FEFF${ucs2("리스본으로 갈까요?")}>`), "the title bar reads in Korean too");
    assert.ok(!file.includes("(????"), "no Hangul fell through to WinAnsi question marks");
  });

  it("leaves English files without the Korean font", () => {
    const file = build("Lisbon or Kigali?", "Pay rises by 30% — “quoted” café €5 …");
    assertXref(file);
    assert.ok(!file.includes("HYGoThic"));
    assert.ok(!file.includes("/K1"));
    assert.ok(!file.includes("Tr"));
    assert.ok(file.includes("/Title (Lisbon or Kigali?)"));
  });

  it("measures Hangul as a full em and keeps wrapped Korean inside the width", () => {
    assert.equal(measure("가나다", "regular", 10), 30);
    assert.equal(measure("가 나", "regular", 10), 20 + 2.78);
    const text = "리스본에서 일자리 제안을 받았지만 가족과 일 대부분은 키갈리에 있어요. 결정은 당신의 몫이에요.";
    const lines = wrap(text, 120, "regular", 10);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(measure(line, "regular", 10) <= 120, `"${line}" fits`);
    assert.equal(lines.join(" "), text, "breaks at the spaces between words");
  });

  it("breaks an over-long Korean word between syllables", () => {
    const word = "가나다라마바사아자차카타파하".repeat(2);
    const lines = wrap(word, 55, "regular", 10);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(measure(line, "regular", 10) <= 55);
    assert.equal(lines.join(""), word);
  });
});
