// A small PDF writer: enough of PDF 1.4 to put an ORION report on paper without a print dialog and
// without a dependency. The standard Helvetica faces (no embedding, so the file stays tiny), WinAnsi
// text, wrapped paragraphs, tables that repeat their header across a page break, weight bars, and a
// cover band. Text outside WinAnsi (Hangul, above all) is drawn with Adobe's non-embedded Korean CID
// font instead, run by run, and that font only enters the file when some text needs it. Everything is laid out in points from the top of the page; `bytes()` turns the pages
// into objects, an xref table and a trailer.
//
// Printed pages are light where the app is dark: the dusk sky and the frosted glass do not survive a
// laser printer, so the page keeps the type, the one accent blue and the structure instead.

const PAGE = { w: 595.28, h: 841.89 } as const; // A4
const MARGIN = { left: 54, right: 54, top: 54, bottom: 58 } as const;
const CONTENT_W = PAGE.w - MARGIN.left - MARGIN.right;

/** Print palette: the brand's ink and blue, plus the greys a page needs to stay readable. */
const INK = "#0B1015";
const BODY = "#2A3340";
const MUTED = "#636E7E";
const FAINT = "#8A94A3";
const ACCENT = "#1C66FE";
const ACCENT_SOFT = "#EDF2FE";
const LINE = "#DFE4ED";
const BAND = "#F5F7FA";

// Adobe's widths for the standard Helvetica faces, in 1/1000 em, for codes 32-126.
const W_REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/** Accented WinAnsi letters are measured as the letter they are built from; close enough to lay out. */
const BASE = "AAAAAAWCEEEEIIIIDNOOOOO+OUUUUYPoaaaaaamceeeeiiiionooooo+ouuuuyby";

/** The punctuation the app actually produces, by WinAnsi code: [regular, bold]. */
const PUNCT: Record<number, [number, number]> = {
  0x80: [556, 556], 0x85: [1000, 1000], 0x91: [222, 278], 0x92: [222, 278], 0x93: [333, 500],
  0x94: [333, 500], 0x95: [350, 350], 0x96: [556, 556], 0x97: [1000, 1000], 0x99: [1000, 1000],
  0xa0: [278, 278], 0xa9: [737, 737], 0xae: [737, 737], 0xb0: [400, 400],
};

export type Font = "regular" | "bold" | "italic";

/** Characters the app writes that WinAnsi spells with a different code. */
const WINANSI: Record<string, number> = {
  "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94,
  "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "−": 0x2d, " ": 0x20,
};

/** One byte per character, in the encoding the fonts are declared with. Unknown glyphs become "?". */
function winAnsi(text: string): string {
  let out = "";
  for (const ch of String(text ?? "")) {
    const mapped = WINANSI[ch];
    if (mapped !== undefined) { out += String.fromCharCode(mapped); continue; }
    const code = ch.codePointAt(0) ?? 63;
    out += code >= 32 && code <= 255 ? String.fromCharCode(code) : code === 9 ? " " : "?";
  }
  return out;
}

/** True when WinAnsi cannot spell `ch`: such characters are drawn with the Korean CID font. */
function isWide(ch: string): boolean {
  if (WINANSI[ch] !== undefined) return false;
  const code = ch.codePointAt(0) ?? 63;
  return code > 255;
}

/** True when `text` needs the CID font somewhere; English text never does. */
function hasWide(text: string): boolean {
  for (const ch of text) if (isWide(ch)) return true;
  return false;
}

interface Run { cjk: boolean; text: string }

/**
 * Splits a line into Helvetica runs and CID-font runs. Only what WinAnsi cannot spell goes to the
 * Korean font: spaces, digits and punctuation stay in Helvetica, whose narrower space and comma read
 * better between Hangul words than the CID font's half-em ones.
 */
function runs(text: string): Run[] {
  if (!hasWide(text)) return [{ cjk: false, text }];
  const out: Run[] = [];
  for (const ch of text) {
    const cjk = isWide(ch);
    const last = out[out.length - 1];
    if (last && last.cjk === cjk) last.text += ch;
    else out.push({ cjk, text: ch });
  }
  return out;
}

/** CID-font widths, matching the W array: half an em for ASCII (which `runs` keeps out of it), a full em for Hangul and the rest. */
function cjkWidth(text: string): number {
  let total = 0;
  for (const ch of text) total += (ch.codePointAt(0) ?? 0) < 0x7f ? 500 : 1000;
  return total;
}

/** UCS-2 big-endian hex, the encoding UniKS-UCS2-H reads. Characters beyond the BMP become "?". */
function ucs2(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch === "\t" ? 32 : ch.codePointAt(0) ?? 63;
    out += (code > 0xffff ? 63 : code).toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

function charWidth(code: number, font: Font): number {
  const table = font === "bold" ? W_BOLD : W_REGULAR;
  if (code >= 32 && code <= 126) return table[code - 32];
  const punct = PUNCT[code];
  if (punct) return punct[font === "bold" ? 1 : 0];
  if (code >= 0xc0) return table[BASE.charCodeAt(code - 0xc0) - 32] ?? 556;
  return 556;
}

/** Width of `text` in points, including the letter-spacing a tracked label adds. */
export function measure(text: string, font: Font, size: number, tracking = 0): number {
  if (hasWide(String(text ?? ""))) {
    let total = 0;
    let count = 0;
    for (const run of runs(String(text))) {
      count += Array.from(run.text).length;
      total += run.cjk ? cjkWidth(run.text) : measureWinAnsi(run.text, font);
    }
    return (total / 1000) * size + tracking * Math.max(0, count - 1);
  }
  const encoded = winAnsi(text);
  let total = 0;
  for (let i = 0; i < encoded.length; i++) total += charWidth(encoded.charCodeAt(i), font);
  return (total / 1000) * size + tracking * Math.max(0, encoded.length - 1);
}

function measureWinAnsi(text: string, font: Font): number {
  const encoded = winAnsi(text);
  let total = 0;
  for (let i = 0; i < encoded.length; i++) total += charWidth(encoded.charCodeAt(i), font);
  return total;
}

/** Greedy word wrap. A word wider than the line is broken, so a pasted link cannot run off the page. */
export function wrap(text: string, maxWidth: number, font: Font, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, font, size) <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
      // Broken by code point, so a Hangul syllable (or an emoji's surrogate pair) is never split.
      let rest = Array.from(word);
      while (measure(rest.join(""), font, size) > maxWidth && rest.length > 1) {
        let cut = rest.length;
        while (cut > 1 && measure(rest.slice(0, cut).join(""), font, size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut).join(""));
        rest = rest.slice(cut);
      }
      line = rest.join("");
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

const hex = (color: string, stroke = false) => {
  const n = parseInt(color.slice(1), 16);
  return `${(((n >> 16) & 255) / 255).toFixed(3)} ${(((n >> 8) & 255) / 255).toFixed(3)} ${((n & 255) / 255).toFixed(3)} ${stroke ? "RG" : "rg"}`;
};
const pdfText = (s: string) => winAnsi(s).replace(/[\\()]/g, (c) => `\\${c}`);
const num = (n: number) => (Math.round(n * 100) / 100).toString();
const FONT_REF: Record<Font, string> = { regular: "/F1", bold: "/F2", italic: "/F3" };
/** The Korean CID font. One face serves every weight: bold is stroked as well as filled. */
const CJK_REF = "/K1";
/** A PDF text string for the Info dictionary: WinAnsi when it can be, UTF-16 with a BOM when not. */
const infoText = (s: string) => (hasWide(s) ? `<FEFF${ucs2(s)}>` : `(${pdfText(s)})`);

export interface TableColumn {
  header: string;
  /** Relative share of the table width. Defaults to 1. */
  weight?: number;
  align?: "left" | "right";
}

export interface PdfOptions {
  /** Shown big on the cover band, and in the viewer's title bar. */
  title: string;
  /** One line under the title: the question, or what the file holds. */
  subtitle?: string;
  /** Small items on the cover band - a date, a count, a status. */
  meta?: string[];
  /** Repeated at the foot of every page, left of the page number. */
  footer?: string;
}

/**
 * Builds one PDF. Call the content methods in reading order; pages break themselves.
 * `bytes()` closes the document and may only be called once.
 */
export class PdfDocument {
  private pages: string[][] = [];
  private ops: string[] = [];
  private y: number = MARGIN.top;
  /** Set once any text needs the Korean font, so English files never carry it. */
  private cjk = false;
  private readonly opts: PdfOptions;

  constructor(opts: PdfOptions) {
    this.opts = opts;
    this.cover();
  }

  // ---- primitives ------------------------------------------------------------------

  private rect(x: number, top: number, w: number, h: number, color: string): void {
    this.ops.push(`${hex(color)} ${num(x)} ${num(PAGE.h - top - h)} ${num(w)} ${num(h)} re f`);
  }

  private line(x: number, top: number, w: number, color = LINE, thickness = 0.6): void {
    this.ops.push(`${hex(color, true)} ${num(thickness)} w ${num(x)} ${num(PAGE.h - top)} m ${num(x + w)} ${num(PAGE.h - top)} l S`);
  }

  /**
   * Draws one line of text, its baseline placed for a box whose top edge is `top`.
   * Character spacing lives in the graphics state, not the text object, so it is written every time:
   * left unset it leaks out of a tracked label and stretches the rest of the document.
   */
  private draw(text: string, x: number, top: number, font: Font, size: number, color: string, tracking = 0): void {
    if (!text) return;
    const baseline = PAGE.h - top - size * 0.8;
    const parts = runs(text);
    if (parts.length === 1 && !parts[0].cjk) {
      this.ops.push(`BT ${FONT_REF[font]} ${num(size)} Tf ${num(tracking)} Tc ${hex(color)} ${num(x)} ${num(baseline)} Td (${pdfText(text)}) Tj ET`);
      return;
    }
    // Mixed or Korean text: one text object, switching font per run; each Tj advances the pen.
    this.cjk = true;
    let op = `BT ${num(tracking)} Tc ${hex(color)} ${num(x)} ${num(baseline)} Td`;
    for (const run of parts) {
      if (!run.cjk) { op += ` ${FONT_REF[font]} ${num(size)} Tf (${pdfText(run.text)}) Tj`; continue; }
      op += ` ${CJK_REF} ${num(size)} Tf`;
      // There is no bold Korean face to name, so bold is drawn filled and stroked (render mode 2).
      if (font === "bold") op += ` 2 Tr ${num(size * 0.03)} w ${hex(color, true)} <${ucs2(run.text)}> Tj 0 Tr`;
      else op += ` <${ucs2(run.text)}> Tj`;
    }
    this.ops.push(`${op} ET`);
  }

  private drawRight(text: string, right: number, top: number, font: Font, size: number, color: string): void {
    this.draw(text, right - measure(text, font, size), top, font, size, color);
  }

  // ---- page handling ---------------------------------------------------------------

  /** Room left on this page for content, before the footer. */
  private get remaining(): number {
    return PAGE.h - MARGIN.bottom - this.y;
  }

  /** Starts a new page when `height` would not fit on this one. */
  private ensure(height: number): void {
    if (height <= this.remaining) return;
    this.pageBreak();
  }

  /** The dark band that opens the document: wordmark, title, one line of context, then the facts. */
  private cover(): void {
    const lines = wrap(this.opts.title, CONTENT_W, "bold", 23);
    const subtitle = this.opts.subtitle ? wrap(this.opts.subtitle, CONTENT_W, "regular", 11).slice(0, 2) : [];
    const height = 72 + lines.length * 28 + subtitle.length * 15 + 26;
    this.rect(0, 0, PAGE.w, height, INK);
    this.rect(0, height - 3, PAGE.w, 3, ACCENT);
    this.draw("ORION", MARGIN.left, 34, "bold", 11, "#7FAAFF", 3.4);
    let top = 62;
    for (const line of lines) { this.draw(line, MARGIN.left, top, "bold", 23, "#FFFFFF"); top += 28; }
    for (const line of subtitle) { this.draw(line, MARGIN.left, top + 2, "regular", 11, "#AFBACB"); top += 15; }
    const meta = (this.opts.meta ?? []).filter(Boolean).join("   ·   ");
    if (meta) this.draw(meta, MARGIN.left, height - 26, "regular", 9, "#8A97AB");
    this.y = height + 32;
  }

  /** Every page after the first says where it came from, quietly. */
  private runningHead(): void {
    this.draw("ORION", MARGIN.left, this.y, "bold", 8, FAINT, 2.2);
    this.drawRight(this.opts.title, PAGE.w - MARGIN.right, this.y, "regular", 8, FAINT);
    this.y += 13;
    this.line(MARGIN.left, this.y, CONTENT_W);
    this.y += 22;
  }

  // ---- content ---------------------------------------------------------------------

  /** A tracked uppercase label over a hairline: the printed form of the app's Eyebrow. */
  heading(text: string): void {
    this.ensure(64);
    if (this.y > MARGIN.top + 40) this.y += 16;
    this.draw(text.toUpperCase(), MARGIN.left, this.y, "bold", 8.5, ACCENT, 1.6);
    this.y += 14;
    this.line(MARGIN.left, this.y, CONTENT_W);
    this.y += 12;
  }

  /** A sub-label inside a section - one decision's title inside a list of them, say. */
  subheading(text: string): void {
    this.ensure(40);
    this.y += 4;
    for (const line of wrap(text, CONTENT_W, "bold", 12)) {
      this.ensure(17);
      this.draw(line, MARGIN.left, this.y, "bold", 12, INK);
      this.y += 17;
    }
    this.y += 2;
  }

  paragraph(text: string, opts: { font?: Font; size?: number; color?: string; indent?: number } = {}): void {
    const { font = "regular", size = 10.5, color = BODY, indent = 0 } = opts;
    for (const line of wrap(text, CONTENT_W - indent, font, size)) {
      this.ensure(size * 1.45);
      this.draw(line, MARGIN.left + indent, this.y, font, size, color);
      this.y += size * 1.45;
    }
    this.y += 4;
  }

  /** A square bullet per item, with continuation lines under the text rather than the bullet. */
  bullets(items: string[], opts: { numbered?: boolean } = {}): void {
    const size = 10.5;
    const gutter = opts.numbered ? 20 : 14;
    items.forEach((item, index) => {
      wrap(item, CONTENT_W - gutter, "regular", size).forEach((line, i) => {
        this.ensure(size * 1.45);
        if (i === 0) {
          if (opts.numbered) this.draw(`${index + 1}.`, MARGIN.left, this.y, "bold", size, ACCENT);
          else this.rect(MARGIN.left + 1, this.y + 4.5, 3.2, 3.2, ACCENT);
        }
        this.draw(line, MARGIN.left + gutter, this.y, "regular", size, BODY);
        this.y += size * 1.45;
      });
    });
    this.y += 5;
  }

  /** Label on the left, value on the right: the shape a fact sheet wants. */
  pairs(rows: [string, string][]): void {
    const labelW = 150;
    for (const [label, value] of rows) {
      const lines = wrap(value || "—", CONTENT_W - labelW, "regular", 10.5);
      this.ensure(lines.length * 15 + 4);
      this.draw(label, MARGIN.left, this.y, "bold", 9.5, MUTED);
      lines.forEach((line, i) => this.draw(line, MARGIN.left + labelW, this.y + i * 15, "regular", 10.5, INK));
      this.y += lines.length * 15 + 3;
    }
    this.y += 4;
  }

  /** The one thing on the page allowed to be blue: ORION's call. */
  callout(text: string, opts: { label?: string } = {}): void {
    const lines = wrap(text, CONTENT_W - 32, "regular", 11);
    const height = lines.length * 16 + (opts.label ? 16 : 0) + 22;
    this.ensure(height + 10);
    this.rect(MARGIN.left, this.y, CONTENT_W, height, ACCENT_SOFT);
    this.rect(MARGIN.left, this.y, 3, height, ACCENT);
    let top = this.y + 11;
    if (opts.label) { this.draw(opts.label.toUpperCase(), MARGIN.left + 18, top, "bold", 8, ACCENT, 1.4); top += 16; }
    for (const line of lines) { this.draw(line, MARGIN.left + 18, top, "regular", 11, INK); top += 16; }
    this.y += height + 12;
  }

  /** Weights and scores as bars, because a column of percentages is not a comparison. */
  bars(items: { label: string; value: number; note?: string }[]): void {
    const labelW = 168;
    const trackW = CONTENT_W - labelW - 86 - 16;
    for (const item of items) {
      this.ensure(22);
      const value = Math.max(0, Math.min(1, Number.isFinite(item.value) ? item.value : 0));
      this.draw(wrap(item.label, labelW - 10, "regular", 10)[0], MARGIN.left, this.y + 2, "regular", 10, INK);
      this.rect(MARGIN.left + labelW, this.y + 4.5, trackW, 7, LINE);
      if (value > 0) this.rect(MARGIN.left + labelW, this.y + 4.5, Math.max(1.5, trackW * value), 7, ACCENT);
      if (item.note) this.drawRight(item.note, PAGE.w - MARGIN.right, this.y + 2, "bold", 9.5, MUTED);
      this.y += 19;
    }
    this.y += 5;
  }

  /**
   * A table with a dark header row, banded body rows and wrapped cells. The header repeats whenever
   * the rows run onto a new page, so page two is never a grid of unlabelled values.
   */
  table(columns: TableColumn[], rows: string[][]): void {
    const totalWeight = columns.reduce((sum, c) => sum + (c.weight ?? 1), 0);
    const widths = columns.map((c) => (CONTENT_W * (c.weight ?? 1)) / totalWeight);
    const padding = 7;
    const size = 9.2;
    // A header that needs two lines gets them: a clipped column name is worse than a taller band.
    const headings = columns.map((c, i) => wrap(c.header, widths[i] - padding * 2, "bold", 8.2).slice(0, 2));
    const headerHeight = Math.max(...headings.map((lines) => lines.length)) * 11 + 10;
    const header = () => {
      this.rect(MARGIN.left, this.y, CONTENT_W, headerHeight, INK);
      let x = MARGIN.left;
      headings.forEach((lines, i) => {
        lines.forEach((line, l) => {
          const top = this.y + (headerHeight - lines.length * 11) / 2 + l * 11;
          if (columns[i].align === "right") this.drawRight(line, x + widths[i] - padding, top, "bold", 8.2, "#FFFFFF");
          else this.draw(line, x + padding, top, "bold", 8.2, "#FFFFFF");
        });
        x += widths[i];
      });
      this.y += headerHeight;
    };
    this.ensure(headerHeight + 51);
    header();
    rows.forEach((row, index) => {
      const cells = columns.map((c, i) => wrap(row[i] ?? "", widths[i] - padding * 2, "regular", size));
      const height = Math.max(...cells.map((lines) => lines.length)) * (size * 1.4) + 9;
      if (height > this.remaining) { this.pageBreak(); header(); }
      if (index % 2 === 1) this.rect(MARGIN.left, this.y, CONTENT_W, height, BAND);
      let x = MARGIN.left;
      cells.forEach((lines, i) => {
        lines.forEach((line, l) => {
          const top = this.y + 5 + l * (size * 1.4);
          if (columns[i].align === "right") this.drawRight(line, x + widths[i] - padding, top, "regular", size, INK);
          else this.draw(line, x + padding, top, "regular", size, INK);
        });
        x += widths[i];
      });
      this.y += height;
      this.line(MARGIN.left, this.y, CONTENT_W, LINE, 0.5);
    });
    this.y += 14;
  }

  /** Says, in words, that a section holds nothing - never an empty heading. */
  empty(text: string): void {
    this.paragraph(text, { font: "italic", color: FAINT, size: 10 });
  }

  spacer(height = 10): void {
    this.y += height;
  }

  /** Starts a new page unless `height` points are still free: keeps a chapter off the last two lines. */
  keepTogether(height: number): void {
    this.ensure(height);
  }

  pageBreak(): void {
    this.pages.push(this.ops);
    this.ops = [];
    this.y = MARGIN.top;
    this.runningHead();
  }

  // ---- output ----------------------------------------------------------------------

  /** Footers need the page count, so they are drawn once the document is closed. */
  private footers(): void {
    const total = this.pages.length;
    const held = this.ops;
    this.pages.forEach((ops, index) => {
      this.ops = ops;
      const top = PAGE.h - MARGIN.bottom + 16;
      this.line(MARGIN.left, top - 12, CONTENT_W);
      if (this.opts.footer) this.draw(this.opts.footer, MARGIN.left, top, "regular", 8, FAINT);
      this.drawRight(`${index + 1} / ${total}`, PAGE.w - MARGIN.right, top, "bold", 8, FAINT);
    });
    this.ops = held;
  }

  /** The finished file. Closes the document: do not add content afterwards. */
  bytes(): Uint8Array {
    this.pages.push(this.ops);
    this.ops = [];
    this.footers();

    const objects: string[] = ["", ""]; // 1 = catalog, 2 = page tree
    const add = (body: string) => { objects.push(body); return objects.length; };
    const fonts = [
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>"),
    ];
    let korean = "";
    if (this.cjk) {
      // Adobe-Korea1, not embedded: every reader with Asian font support has HYGoThic-Medium or a stand-in.
      // UniKS-UCS2-H maps ASCII to the proportional CIDs 1-95, given half an em here; the rest is a full em.
      const descriptor = add("<< /Type /FontDescriptor /FontName /HYGoThic-Medium /Flags 4 /FontBBox [-6 -145 1003 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>");
      const descendant = add(`<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 1 >> /FontDescriptor ${descriptor} 0 R /DW 1000 /W [1 95 500 8094 8190 500] >>`);
      const type0 = add(`<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium-UniKS-UCS2-H /Encoding /UniKS-UCS2-H /DescendantFonts [${descendant} 0 R] >>`);
      korean = ` ${CJK_REF} ${type0} 0 R`;
    }
    const resources = `<< /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R${korean} >> >>`;
    const pageIds = this.pages.map((ops) => {
      const stream = ops.join("\n");
      const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE.w)} ${num(PAGE.h)}] /Resources ${resources} /Contents ${contents} 0 R >>`);
    });
    const info = add(`<< /Title ${infoText(this.opts.title)} /Author (ORION) /Creator (ORION) /Producer (ORION) >>`);
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

    let out = "%PDF-1.4\n%âãÏÓ\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
