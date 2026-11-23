// Static analysis: rules about the code itself, checked on the TypeScript AST (not by running it).
//   1. The decision engine is deterministic math: no network, no server code, no environment, no logging.
//   2. The creative and priority engines are stricter still: no clock, no randomness, no language, only each other.
//   3. Every decision route the server answers is allow-listed in both server lists and in the web proxy, and the
//      proxy allows nothing the server doesn't answer.
//   4. Every model task is visible in /health routing.
//   5. Errors the new routes return to people are translatable (msg), never bare English.
//   6. Judge question levels are distinct, so answers can be decoded back to their level.
//   7. No escape hatches (@ts-ignore, `as any`, eslint-disable) in the new modules.
//   8. A Korean translation is the same wherever the same English string appears.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { FACTOR_LEVELS } from "../server/typesafe.ts";
import { NOVELTY_LEVELS } from "../server/creative.ts";
import { PRIORITY_QUESTIONS } from "../src/decision-engine/prioritize.ts";
import { TASK_QUESTIONS } from "../server/tasks.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const parse = (path) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function walk(node, visit) { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); }
const at = (sf, node) => `${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

function imports(sf) {
  const out = [];
  walk(sf, (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push({ from: n.moduleSpecifier.text, typeOnly: !!(n.importClause?.isTypeOnly || n.isTypeOnly), node: n });
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push({ from: n.arguments[0]?.text, typeOnly: false, node: n });
  });
  return out;
}
/** Identifiers used as values (not property names after a dot, not type references). */
function valueIdentifiers(sf) {
  const out = [];
  walk(sf, (n) => {
    if (!ts.isIdentifier(n)) return;
    const p = n.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === n) return;
    if (ts.isPropertyAssignment(p) && p.name === n) return;
    if (ts.isTypeReferenceNode(p) || ts.isQualifiedName(p) || ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return;
    out.push({ name: n.text, node: n });
  });
  return out;
}
const accesses = (sf) => { const out = []; walk(sf, (n) => { if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) out.push({ name: `${n.expression.text}.${n.name.text}`, node: n }); }); return out; };

const ENGINE = readdirSync(new URL("../src/decision-engine/", import.meta.url)).filter((f) => f.endsWith(".ts")).map((f) => `src/decision-engine/${f}`);
const PURE = ["src/decision-engine/creative.ts", "src/decision-engine/prioritize.ts", "src/decision-engine/board.ts"];
const NEW = [...PURE, "server/creative.ts", "server/prioritize.ts", "server/tasks.ts", "server/boards.ts", "web/lib/creative.ts", "web/lib/priorities.ts", "web/lib/board.ts",
  "web/components/NewPaths.tsx", "web/components/Priorities.tsx", "web/app/app/prioritize/view.tsx"];

describe("static: the decision engine", () => {
  it("never reaches the network, the server, the environment or the console", () => {
    const problems = [];
    for (const file of ENGINE) {
      const sf = parse(file);
      for (const i of imports(sf)) if (/(^|\/)server\//.test(i.from) || /^node:|^https?:/.test(i.from)) problems.push(`${at(sf, i.node)} imports ${i.from}`);
      for (const id of valueIdentifiers(sf)) if (["fetch", "XMLHttpRequest", "WebSocket", "process", "require"].includes(id.name)) problems.push(`${at(sf, id.node)} uses ${id.name}`);
      for (const a of accesses(sf)) if (a.name.startsWith("console.")) problems.push(`${at(sf, a.node)} logs`);
    }
    assert.deepEqual(problems, []);
  });
  it("the creative and priority engines are pure: no clock, no randomness, no language, imports only each other", () => {
    const problems = [];
    for (const file of PURE) {
      const sf = parse(file);
      for (const i of imports(sf)) if (!i.typeOnly && !["./creative.ts", "./prioritize.ts", "./board.ts"].includes(i.from)) problems.push(`${at(sf, i.node)} imports ${i.from}`);
      for (const a of accesses(sf)) if (["Math.random", "Date.now", "performance.now", "crypto.randomUUID", "crypto.getRandomValues"].includes(a.name)) problems.push(`${at(sf, a.node)} uses ${a.name}`);
      walk(sf, (n) => { if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date") problems.push(`${at(sf, n)} uses new Date`); });
      // Translation helpers are already shut out by the import rule; a local `t` (a threshold, a time) is fine.
      for (const id of valueIdentifiers(sf)) if (["getLocale", "localStorage", "window", "document"].includes(id.name)) problems.push(`${at(sf, id.node)} uses ${id.name}`);
    }
    assert.deepEqual(problems, []);
  });
});

describe("static: routes", () => {
  const index = read("server/index.ts");
  const handled = [...index.matchAll(/url\.pathname === "\/decision\/([a-z-]+)"/g)].map((m) => m[1]);
  const list = (name) => [...(index.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"\/decision\/([a-z-]+)"/g)].map((m) => m[1]);
  const proxy = read("web/app/api/orion/[...path]/route.ts").match(/decision\\\/\(([^)]*)\)/)[1].split("|");

  it("every decision route is allow-listed on the server and in the web proxy", () => {
    // "explain" is the final else branch, so it never appears as a comparison.
    const routes = [...new Set([...handled, "explain"])].sort();
    assert.ok(routes.includes("creative") && routes.includes("prioritize"));
    assert.deepEqual([...list("API_PATHS")].sort(), routes);
    assert.deepEqual([...list("SIGNED_IN_PATHS")].sort(), routes);
    assert.deepEqual([...proxy].sort(), routes, "the proxy allows exactly what the server answers");
    // Production (Vercel) has its own routing table; a route missing there falls through to the app's index.html.
    const vercel = read("scripts/vercel-output.sh").match(/decision\/\(\?:([^)]*)\)/)[1].split("|");
    assert.deepEqual([...vercel].sort(), routes, "scripts/vercel-output.sh routes every decision route to the API");
  });
  it("every task and board route reaches the server from the web proxy and from Vercel", () => {
    const proxyText = read("web/app/api/orion/[...path]/route.ts"), vercelText = read("scripts/vercel-output.sh");
    const tasks = [...index.matchAll(/"\/tasks\/([a-z]+)"/g)].map((m) => m[1]);
    const boards = read("server/boards.ts").match(/BOARD_ROUTE = \/\^\\\/boards\\\/\(([^)]*)\)/)[1].split("|");
    assert.deepEqual([...new Set(tasks)].sort(), ["score", "split"]);
    assert.deepEqual(proxyText.match(/tasks\\\/\(([^)]*)\)/)[1].split("|").sort(), ["score", "split"]);
    assert.deepEqual(vercelText.match(/tasks\/\(\?:([^)]*)\)/)[1].split("|").sort(), ["score", "split"]);
    assert.deepEqual(proxyText.match(/boards\\\/\(([^)]*)\)/)[1].split("|").sort(), [...boards].sort());
    assert.deepEqual(vercelText.match(/boards\/\(\?:([^)]*)\)/)[1].split("|").sort(), [...boards].sort());
  });
  it("every model task shows in /health routing", () => {
    const union = read("server/models.ts").match(/export type Task = ([^;]+);/)[1].match(/"([a-z]+)"/g).map((s) => s.slice(1, -1));
    const health = index.match(/\(\[([^\]]+)\] as Task\[\]\)/)[1].match(/"([a-z]+)"/g).map((s) => s.slice(1, -1));
    assert.deepEqual([...health].sort(), [...union].sort());
  });
  it("errors from the new routes are translatable", () => {
    const sf = parse("server/index.ts");
    const problems = [];
    walk(sf, (n) => {
      if (!ts.isIfStatement(n) || !/\/(decision\/(creative|prioritize)|tasks\/(score|split))"/.test(n.expression.getText())) return;
      walk(n.thenStatement, (m) => {
        if (ts.isPropertyAssignment(m) && m.name.getText() === "error" && !(ts.isCallExpression(m.initializer) && m.initializer.expression.getText() === "msg")) problems.push(`${at(sf, m)} ${m.initializer.getText()}`);
      });
    });
    assert.deepEqual(problems, []);
  });
});

describe("static: judge questions", () => {
  it("every level set is distinct, so a presented answer maps back to exactly one level", () => {
    for (const levels of [FACTOR_LEVELS, NOVELTY_LEVELS, ...Object.values(PRIORITY_QUESTIONS).map((q) => q.levels), ...Object.values(TASK_QUESTIONS).map((q) => q.levels)]) {
      assert.equal(levels.length, 5);
      assert.equal(new Set(levels).size, levels.length, levels.join(" | "));
    }
  });
  it("every priority question names `option`, the slot the state fills", () => {
    for (const [dim, q] of Object.entries(PRIORITY_QUESTIONS)) assert.match(q.question, /`option`/, dim);
  });
});

describe("static: hygiene of the new modules", () => {
  it("no @ts-ignore, @ts-expect-error, `as any` or eslint-disable", () => {
    const problems = [];
    for (const file of NEW) {
      const text = read(file);
      for (const [pattern, what] of [[/@ts-(ignore|expect-error|nocheck)/, "ts escape"], [/\bas any\b|: any\b/, "any"], [/eslint-disable/, "eslint-disable"]]) if (pattern.test(text)) problems.push(`${file}: ${what}`);
    }
    assert.deepEqual(problems, []);
  });
});

describe("static: Korean dictionaries", () => {
  it("the same English string has the same Korean in every dictionary", async () => {
    const dir = new URL("../src/i18n/ko/", import.meta.url);
    const seen = new Map(), conflicts = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "index.ts")) {
      const mod = await import(new URL(file, dir).href);
      for (const dict of Object.values(mod)) {
        if (!dict || typeof dict !== "object") continue;
        for (const [en, ko] of Object.entries(dict)) {
          if (seen.has(en) && seen.get(en).ko !== ko) conflicts.push(`${JSON.stringify(en)}: ${seen.get(en).file} ≠ ${file}`);
          else seen.set(en, { ko, file });
        }
      }
    }
    assert.deepEqual(conflicts, []);
  });
});
