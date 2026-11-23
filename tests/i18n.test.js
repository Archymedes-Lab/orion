// Every string the interface can show has Korean. The scan reads t("…"), tIn(locale, "…") and msg("…") literals in
// the Expo app, the server and the web app, and checks each against the Korean dictionary.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ko } from "../src/i18n/ko/index.ts";
import { PRIVACY_EN, TERMS_EN } from "../src/copy/legal.ts";
import { listPhrase, t, withLocale } from "../src/i18n/index.ts";

const ROOTS = ["src", "server", "web/app", "web/components", "web/lib"];
const SKIP = /node_modules|\.next|src\/i18n\//;

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP.test(path)) continue;
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

// A string literal in any of the three quote styles; template literals only when they have no ${…}.
const LITERAL = String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\x60(?:[^\x60\\$]|\\.)*\x60)`;
const CALL = new RegExp(String.raw`(?<![\w.$])(?:t|msg)\(\s*${LITERAL}|(?<![\w.$])tIn\(\s*[^,()]+,\s*${LITERAL}`, "g");

function unquote(raw) {
  if (raw.startsWith('"')) return JSON.parse(raw);
  const body = raw.slice(1, -1);
  return JSON.parse(`"${body.replace(/\\'/g, "'").replace(/\\`/g, "`").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`);
}

const used = new Map();
for (const root of ROOTS) {
  let list = [];
  try { list = files(root); } catch { continue; }
  for (const file of list) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CALL)) {
      const text = unquote(match[1] ?? match[2]);
      if (!used.has(text)) used.set(text, file);
    }
  }
}
for (const copy of [PRIVACY_EN, TERMS_EN]) {
  for (const text of [copy.title, copy.updated, copy.intro, ...copy.sections.flat()]) used.set(text, "src/copy/legal.ts");
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const hangul = /[가-힣]/;

describe("Korean interface", () => {
  test("finds the wrapped strings", () => {
    expect(used.size).toBeGreaterThan(50);
  });

  test("every shown string has Korean", () => {
    const missing = [...used].filter(([text]) => !(text in ko)).map(([text, file]) => `${file}: ${text}`);
    expect(missing).toEqual([]);
  });

  test("Korean keeps every placeholder and is written in Hangul", () => {
    const wrong = [...used.keys()].filter((text) => text in ko).filter((text) => {
      const k = ko[text];
      return placeholders(k).join() !== placeholders(text).join() || (/[a-z]{3}/i.test(text.replace(/\{\w+\}|ORION|Jev/g, "")) && !hangul.test(k));
    });
    expect(wrong).toEqual([]);
  });

  test("no Korean entry is left over from text that no longer exists", () => {
    expect(Object.keys(ko).filter((key) => !used.has(key))).toEqual([]);
  });

  test("t fills placeholders in either language and lists read naturally", () => {
    expect(t("{n} options", { n: 3 })).toBe("{n} options".replace("{n}", "3"));
    expect(withLocale("ko", () => listPhrase(["a", "b", "c"]))).toBe("a, b 및 c");
    expect(listPhrase(["a", "b"], "or")).toBe("a or b");
  });
});
