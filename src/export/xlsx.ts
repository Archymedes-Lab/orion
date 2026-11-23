// A small .xlsx writer: a stored (uncompressed) ZIP of the handful of OOXML parts Excel needs, plus a
// stylesheet, so an export opens as a finished workbook rather than a grid of raw values - a title
// over every sheet, a dark header row that stays frozen while you scroll, filters, banded rows,
// column widths measured from the content, and real numbers, percentages and dates.
//
// Uncompressed entries are a legal ZIP, so nothing here has to implement DEFLATE; exports are small
// enough that the size difference does not matter.

import { t } from "../i18n/index.ts";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(bytes: string): number {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes.charCodeAt(i)) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** UTF-8 as a string of bytes. Written out by hand: TextEncoder is not everywhere this app runs. */
function utf8(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out += String.fromCharCode(code);
    else if (code < 0x800) out += String.fromCharCode(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out += String.fromCharCode(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out += String.fromCharCode(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return out;
}

const u16 = (n: number) => String.fromCharCode(n & 0xff, (n >>> 8) & 0xff);
const u32 = (n: number) => String.fromCharCode(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);

/** Escapes text for XML and drops the control characters Excel refuses to open. */
const xml = (value: string) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface ZipEntry { name: string; data: string }

/** Packs the parts into a ZIP with stored entries. */
function zip(entries: ZipEntry[]): Uint8Array {
  // 1980-01-01 00:00: a fixed timestamp keeps the same export byte-identical between runs.
  const time = 0;
  const date = 33;
  let central = "";
  let local = "";
  for (const entry of entries) {
    const name = utf8(entry.name);
    const crc = crc32(entry.data);
    const header = u16(20) + u16(0x0800) + u16(0) + u16(time) + u16(date) + u32(crc) + u32(entry.data.length) + u32(entry.data.length) + u16(name.length) + u16(0);
    central += "PK\u0001\u0002" + u16(20) + header + u16(0) + u16(0) + u16(0) + u32(0) + u32(local.length) + name;
    local += "PK\u0003\u0004" + header + name + entry.data;
  }
  const end = "PK\u0005\u0006" + u16(0) + u16(0) + u16(entries.length) + u16(entries.length) + u32(central.length) + u32(local.length) + u16(0);
  const out = local + central + end;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/** How a column is written and read: the alignment, the number format and the width all follow from it. */
export type ColumnFormat = "text" | "long" | "number" | "score" | "percent" | "date" | "label";

export interface SheetColumn {
  header: string;
  format?: ColumnFormat;
  /** Overrides the width measured from the content, in characters. */
  width?: number;
}

export type CellValue = string | number | null | undefined;

export interface Sheet {
  /** Tab name. Trimmed to Excel's 31 characters and its forbidden punctuation. */
  name: string;
  /** The big line over the table. Defaults to the tab name. */
  title?: string;
  /** One quiet line under the title, saying what the sheet holds. */
  subtitle?: string;
  columns: SheetColumn[];
  rows: CellValue[][];
  /** A closing line under the table - a caveat, or what an empty sheet means. */
  note?: string;
}

// Style ids, in the order they are written into cellXfs below.
const S = {
  plain: 0, title: 1, subtitle: 2, header: 3, note: 4,
  text: 5, textBand: 6, long: 7, longBand: 8, label: 9, labelBand: 10,
  number: 11, numberBand: 12, score: 13, scoreBand: 14,
  percent: 15, percentBand: 16, date: 17, dateBand: 18,
} as const;

const BODY_STYLE: Record<ColumnFormat, [number, number]> = {
  text: [S.text, S.textBand],
  long: [S.long, S.longBand],
  label: [S.label, S.labelBand],
  number: [S.number, S.numberBand],
  score: [S.score, S.scoreBand],
  percent: [S.percent, S.percentBand],
  date: [S.date, S.dateBand],
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0%"/><numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="167" formatCode="#,##0.##"/></numFmts>
<fonts count="6">
<font><sz val="10"/><color rgb="FF1B2430"/><name val="Segoe UI"/></font>
<font><b/><sz val="16"/><color rgb="FF0B1015"/><name val="Segoe UI"/></font>
<font><sz val="10"/><color rgb="FF636E7E"/><name val="Segoe UI"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
<font><i/><sz val="9"/><color rgb="FF8A94A3"/><name val="Segoe UI"/></font>
<font><b/><sz val="10"/><color rgb="FF0B1015"/><name val="Segoe UI"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0B1015"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF5F7FA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFE4E8EF"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FF1C66FE"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="19">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="167" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** A1, B1 ... AA1. */
function columnName(index: number): string {
  let name = "";
  let n = index;
  do { name = String.fromCharCode(65 + (n % 26)) + name; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return name;
}

/** Excel counts days from 1899-12-30. Rounded to the second, so a widened format shows a real time. */
function excelDate(value: string): number | null {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 1000) / 86400 + 25569;
}

/** Excel's own limits on a tab name, applied quietly rather than failing the export. */
function tabName(name: string, taken: Set<string>): string {
  const fallback = t("Sheet");
  let clean = String(name || fallback).replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || fallback;
  let n = 2;
  while (taken.has(clean.toLowerCase())) clean = `${clean.slice(0, 28)} ${n++}`;
  taken.add(clean.toLowerCase());
  return clean;
}

/** Characters a column has to fit. Hangul and other wide script takes about two Latin characters' room. */
function displayLength(text: string): number {
  let length = 0;
  for (const ch of text) length += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/.test(ch) ? 2 : ch.length;
  return length;
}

/** Widths from the longest value in the column, within bounds that keep the sheet on one screen. */
function columnWidth(column: SheetColumn, rows: CellValue[][], index: number): number {
  if (column.width) return column.width;
  const max = rows.reduce((longest, row) => {
    const text = row[index] == null ? "" : String(row[index]);
    return Math.max(longest, Math.min(displayLength(text), 90));
  }, displayLength(column.header));
  const bounds: Record<ColumnFormat, [number, number]> = {
    text: [12, 38], long: [24, 56], label: [14, 40], number: [9, 14], score: [9, 14], percent: [9, 14], date: [12, 14],
  };
  const [min, cap] = bounds[column.format ?? "text"];
  return Math.min(cap, Math.max(min, Math.round(max * 1.08) + 3));
}

function cell(ref: string, value: CellValue, format: ColumnFormat, style: number): string {
  if (value === null || value === undefined || value === "") return `<c r="${ref}" s="${style}"/>`;
  if (format === "date") {
    const serial = typeof value === "number" ? value : excelDate(String(value));
    if (serial !== null) return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
    return `<c r="${ref}" s="${S.text}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
  }
  if (format === "number" || format === "score" || format === "percent") {
    const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
    // A share worked out as 0.6 / 0.8 is 0.7499999999999999 in binary; twelve digits is more precision
    // than any estimate here carries, and keeps the noise out of the file.
    if (Number.isFinite(n)) return `<c r="${ref}" s="${style}"><v>${Number(n.toPrecision(12))}</v></c>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const columns = sheet.columns;
  const last = columnName(Math.max(0, columns.length - 1));
  const title = sheet.title ?? sheet.name;
  const rows: string[] = [];
  const merges: string[] = [];

  let r = 1;
  rows.push(`<row r="${r}" ht="24" customHeight="1"><c r="A${r}" s="${S.title}" t="inlineStr"><is><t xml:space="preserve">${xml(title)}</t></is></c></row>`);
  if (columns.length > 1) merges.push(`<mergeCell ref="A${r}:${last}${r}"/>`);
  r++;
  if (sheet.subtitle) {
    rows.push(`<row r="${r}" ht="16" customHeight="1"><c r="A${r}" s="${S.subtitle}" t="inlineStr"><is><t xml:space="preserve">${xml(sheet.subtitle)}</t></is></c></row>`);
    if (columns.length > 1) merges.push(`<mergeCell ref="A${r}:${last}${r}"/>`);
    r++;
  }
  rows.push(`<row r="${r}" ht="7" customHeight="1"/>`);
  r++;

  const headerRow = r;
  rows.push(`<row r="${r}" ht="24" customHeight="1">${columns.map((c, i) => `<c r="${columnName(i)}${r}" s="${S.header}" t="inlineStr"><is><t xml:space="preserve">${xml(c.header)}</t></is></c>`).join("")}</row>`);
  r++;

  const firstData = r;
  sheet.rows.forEach((row, index) => {
    const cells = columns.map((column, i) => {
      const format = column.format ?? "text";
      const style = BODY_STYLE[format][index % 2];
      return cell(`${columnName(i)}${r}`, row[i], format, style);
    });
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
    r++;
  });
  const lastData = r - 1;

  if (sheet.note) {
    r++;
    rows.push(`<row r="${r}"><c r="A${r}" s="${S.note}" t="inlineStr"><is><t xml:space="preserve">${xml(sheet.note)}</t></is></c></row>`);
    if (columns.length > 1) merges.push(`<mergeCell ref="A${r}:${last}${r}"/>`);
  }

  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${columnWidth(c, sheet.rows, i)}" customWidth="1"/>`).join("");
  const pane = `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/>`;
  // Elements below follow the order the schema requires: autoFilter before mergeCells.
  const filter = sheet.rows.length ? `<autoFilter ref="A${headerRow}:${last}${Math.max(lastData, headerRow)}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}${Math.max(r, firstData)}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join("")}</sheetData>${filter}${merges.length ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>` : ""}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1"/></worksheet>`;
}

export interface WorkbookMeta {
  title?: string;
  /** ISO timestamp written into the file's properties. */
  created?: string;
}

/** The finished .xlsx. Sheets appear as tabs in the order given; an empty list still opens. */
export function buildWorkbook(sheets: Sheet[], meta: WorkbookMeta = {}): Uint8Array {
  const taken = new Set<string>();
  const named = (sheets.length ? sheets : [{ name: t("Empty"), columns: [{ header: t("Nothing to export") }], rows: [] }])
    .map((sheet) => ({ ...sheet, name: tabName(sheet.name, taken) }));
  const created = meta.created ?? new Date().toISOString();

  const parts: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(meta.title ?? t("ORION export"))}</dc:title><dc:creator>ORION</dc:creator><cp:lastModifiedBy>ORION</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${xml(created)}</dcterms:created></cp:coreProperties>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="12000"/></bookViews><sheets>${named.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES },
    ...named.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheet) })),
  ];

  return zip(parts.map((part) => ({ name: part.name, data: utf8(part.data) })));
}
