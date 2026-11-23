// How good is ORION at business decisions? Runs real company decisions through the configured models (Bun loads
// .env), grades every answer against the rules in server/business.ts, and prints a scorecard.
//
//   bun scripts/business-eval.ts                    playbook on (what production does)
//   bun scripts/business-eval.ts --compare          also runs the same cases without the playbook, side by side
//   bun scripts/business-eval.ts --export out.jsonl  writes every answer that passed all its checks as an OpenAI
//                                                    chat fine-tuning set (system, user, assistant)
//   --only biz-saas-price   run one case        --repeat 2   run each case several times
//
// Fine-tuning loop: export → upload to OpenAI fine-tuning → set ORION_BUSINESS_MODEL=ft:… → rerun this script and
// compare. Check the licence of whichever model wrote the transcripts before training on them.
import { writeFileSync } from "node:fs";
import { parseWithAI, scoreWithAI } from "../server/decision-ai.ts";
import { companyBrief, type BusinessProfile } from "../server/business.ts";
import { ModelRouter } from "../server/router.ts";
import { weightsFromImportance } from "../src/ai/model.ts";

interface Case {
  id: string;
  question: string;
  profile: BusinessProfile;
  /** Stakes a good reading could give. */
  stakes: ("tiny" | "normal" | "significant" | "major")[];
  /** The status quo should appear among the options. */
  statusQuo?: boolean;
  /** An option that spends cash up front, which a short runway should mark down on cash. */
  spends?: RegExp;
}

const CASES: Case[] = [
  { id: "biz-hire-runway", question: "Should we hire a full-time senior engineer or keep using our two contractors?",
    profile: { industry: "B2B SaaS for clinics", stage: "early", team: "2–10", runwayMonths: 6, risk: "cautious", goal: "survive" },
    stakes: ["significant", "major"], statusQuo: true, spends: /hire|full-time|senior/i },
  { id: "biz-saas-price", question: "Should we raise our prices by 20%? Most of our 300 customers are on monthly plans.",
    profile: { industry: "Project management software", stage: "growing", team: "11–50", runwayMonths: 20, risk: "balanced", goal: "profit" },
    stakes: ["significant", "normal"], statusQuo: true },
  { id: "biz-build-buy", question: "Build our own scheduling engine or license one from a vendor?",
    profile: { industry: "Field service software", stage: "growing", team: "11–50", runwayMonths: 14, risk: "balanced", goal: "grow" },
    stakes: ["significant"], spends: /build/i },
  { id: "biz-big-client", question: "A retailer wants a custom version of our product for a contract worth about 40% of our revenue. Take it, negotiate, or pass?",
    profile: { industry: "Inventory analytics", stage: "early", team: "2–10", runwayMonths: 10, risk: "balanced", goal: "grow" },
    stakes: ["significant", "major"] },
  { id: "biz-second-location", question: "Open a second café across town or renovate and expand the one we have?",
    profile: { name: "Corner Café", industry: "Café", stage: "established", team: "11–50", risk: "cautious", goal: "profit" },
    stakes: ["significant", "major"], spends: /open|second/i },
  { id: "biz-seed", question: "Should we raise a seed round now or keep bootstrapping for another year?",
    profile: { industry: "Developer tools", stage: "early", team: "2–10", runwayMonths: 8, risk: "bold", goal: "grow" },
    stakes: ["major", "significant"], statusQuo: true },
  { id: "biz-market", question: "Should we expand into Germany next quarter or keep focusing on the UK?",
    profile: { industry: "HR software", stage: "growing", team: "51–250", runwayMonths: 24, risk: "balanced", goal: "grow" },
    stakes: ["significant", "major"], statusQuo: true, spends: /germany|expand/i },
  { id: "biz-cost-cut", question: "We need to cut costs. Pause all hiring, cut marketing spend, or reduce the team by 15%?",
    profile: { industry: "E-commerce", stage: "growing", team: "51–250", runwayMonths: 5, risk: "cautious", goal: "survive" },
    stakes: ["major"] },
  { id: "biz-vendor", question: "Which payroll provider should we use: Provider A at a lower price or Provider B with better support?",
    profile: { industry: "Construction", stage: "established", team: "51–250", risk: "cautious", goal: "profit" },
    stakes: ["normal", "significant"] },
  { id: "biz-free-tier", question: "Should we launch a free tier to drive growth or keep our 14-day trial?",
    profile: { industry: "Email marketing SaaS", stage: "growing", team: "11–50", runwayMonths: 11, risk: "balanced", goal: "grow" },
    stakes: ["significant", "normal"], statusQuo: true },
  { id: "biz-office", question: "Sign a 5-year office lease or stay fully remote?",
    profile: { industry: "Design agency", stage: "growing", team: "11–50", runwayMonths: 9, risk: "cautious", goal: "profit" },
    stakes: ["significant", "major"], statusQuo: true, spends: /lease|office/i },
  { id: "biz-pivot", question: "Our consumer app is stalling. Pivot to selling it to businesses or keep improving the consumer product?",
    profile: { industry: "Fitness app", stage: "early", team: "2–10", runwayMonths: 7, risk: "bold", goal: "survive" },
    stakes: ["major", "significant"], statusQuo: true },
  { id: "biz-no-profile", question: "Should our startup switch our cloud provider to save money?",
    profile: {}, stakes: ["normal", "significant"], statusQuo: true },
];

const flag = (name: string) => process.argv.includes(name);
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const exportPath = arg("--export");
const only = arg("--only");
const repeat = Math.max(1, Number(arg("--repeat") ?? 1));
const compare = flag("--compare");

const CASH = /cash|runway|cost|burn|spend|price|financ|fund|money/i;
const DEMAND = /revenue|demand|market|growth|conversion|churn|sales|adoption|customer/i;
const STATUS_QUO = /keep|stay|current|status quo|don'?t|do not|not now|wait|continue|as is|no change|existing|remain|bootstrap|focus on (?:the )?(?:core|uk)|trial/i;

/** Numbers of two or more digits the model wrote that appear nowhere in what it was told. */
function invented(text: string, given: string): string[] {
  return (text.match(/\d[\d,.]*\d|\d{2,}/g) ?? []).filter((n) => !given.includes(n));
}

interface Check { name: string; pass: boolean; note?: string }
interface Run { id: string; mode: "playbook" | "baseline"; checks: Check[]; error?: string; seconds: number; model?: string }

async function runCase(c: Case, mode: Run["mode"], router: ModelRouter, transcripts: { task: string; system: string; input: string; output: string }[]): Promise<Run> {
  const started = Date.now();
  const recorded: typeof transcripts = [];
  const record = (entry: { task: string; system: string; input: string; output: string }) => { recorded.push(entry); };
  const playbook = mode === "playbook";
  if (!playbook) process.env.ORION_BUSINESS_PLAYBOOK = "off";
  // A fair baseline: the generic prompt still gets the company, as text in the question.
  const input = playbook ? c.question : `${c.question}\n\nAbout the company: ${companyBrief(c.profile)}`;
  const options = { env: process.env, router, record };
  const checks: Check[] = [];
  try {
    const parsed = await parseWithAI(input, options, playbook ? c.profile : undefined);
    const given = `${c.question} ${JSON.stringify(c.profile)}`;
    checks.push({ name: "filed as Business", pass: parsed.category.includes("Business"), note: parsed.category.join(", ") });
    checks.push({ name: "4–7 factors", pass: parsed.factors.length >= 4 && parsed.factors.length <= 7, note: String(parsed.factors.length) });
    checks.push({ name: "stakes", pass: c.stakes.includes(parsed.stakes), note: parsed.stakes });
    if (c.statusQuo) checks.push({ name: "status quo offered", pass: parsed.options.some((o) => STATUS_QUO.test(o.label)), note: parsed.options.map((o) => o.label).join(" | ") });
    const made = invented([parsed.title, ...parsed.options.map((o) => o.label), ...parsed.factors.map((f) => `${f.label} ${f.reason}`)].join(" "), given);
    checks.push({ name: "no invented numbers", pass: made.length === 0, note: made.join(", ") });
    const cash = parsed.factors.find((f) => CASH.test(f.label));
    const short = c.profile.runwayMonths != null && c.profile.runwayMonths <= 9;
    if (short) {
      const sorted = parsed.factors.map((f) => f.importance).sort((a, b) => b - a);
      const median = sorted[Math.floor((sorted.length - 1) / 2)];
      checks.push({ name: "short runway: cash weighs heavily", pass: Boolean(cash && cash.importance >= median), note: cash ? `${cash.label} ${cash.importance}` : "no cash factor" });
    }

    const factors = weightsFromImportance(parsed.factors);
    const scored = await scoreWithAI({
      context: input, stakes: parsed.stakes, business: playbook ? c.profile : undefined,
      options: parsed.options.map((o) => ({ id: o.id, label: o.label })), factors: factors.map((f) => ({ id: f.id, label: f.label })),
    }, options);
    const demand = scored.scores.filter((s) => DEMAND.test(factors.find((f) => f.id === s.factorId)?.label ?? ""));
    if (demand.length) {
      const mean = demand.reduce((sum, s) => sum + s.probabilityConfidence, 0) / demand.length;
      checks.push({ name: "humble on demand forecasts", pass: mean <= 0.7, note: mean.toFixed(2) });
    }
    const spender = c.spends && parsed.options.find((o) => c.spends!.test(o.label));
    const keeper = parsed.options.find((o) => o !== spender && STATUS_QUO.test(o.label)) ?? parsed.options.find((o) => o !== spender);
    if (short && spender && keeper && cash) {
      const value = (optionId: string) => scored.scores.find((s) => s.optionId === optionId && s.factorId === cash.id)?.value ?? 0;
      checks.push({ name: "short runway: spending marked down on cash", pass: value(spender.id) < value(keeper.id), note: `${value(spender.id)} vs ${value(keeper.id)}` });
    }
    const passed = checks.every((ch) => ch.pass);
    if (passed && playbook) transcripts.push(...recorded);
    return { id: c.id, mode, checks, seconds: (Date.now() - started) / 1000, model: scored.ai.model };
  } catch (error) {
    return { id: c.id, mode, checks, error: error instanceof Error ? error.message : String(error), seconds: (Date.now() - started) / 1000 };
  } finally {
    delete process.env.ORION_BUSINESS_PLAYBOOK;
  }
}

const router = new ModelRouter();
const transcripts: { task: string; system: string; input: string; output: string }[] = [];
const cases = CASES.filter((c) => !only || c.id === only);
const runs: Run[] = [];
// Sequential: the playbook switch is process-wide, and free models rate-limit bursts anyway.
for (let r = 0; r < repeat; r++) {
  for (const c of cases) {
    for (const mode of compare ? (["playbook", "baseline"] as const) : (["playbook"] as const)) {
      const run = await runCase(c, mode, router, transcripts);
      runs.push(run);
      const ok = run.checks.filter((ch) => ch.pass).length;
      console.log(`${run.error ? "ERROR" : ok === run.checks.length ? "PASS " : "FAIL "} ${c.id.padEnd(22)} ${mode.padEnd(8)} ${ok}/${run.checks.length} ${run.seconds.toFixed(0)}s ${run.model ?? ""} ${run.error ?? ""}`);
      for (const ch of run.checks.filter((x) => !x.pass)) console.log(`        ✗ ${ch.name}: ${ch.note ?? ""}`);
    }
  }
}

for (const mode of ["playbook", "baseline"] as const) {
  const mine = runs.filter((r) => r.mode === mode);
  if (!mine.length) continue;
  const checks = mine.flatMap((r) => r.checks);
  const clean = mine.filter((r) => !r.error && r.checks.every((ch) => ch.pass)).length;
  console.log(`\n${mode}: ${checks.filter((c) => c.pass).length}/${checks.length} checks, ${clean}/${mine.length} cases fully passing, ${mine.filter((r) => r.error).length} errors`);
  const byName = new Map<string, { pass: number; total: number }>();
  for (const ch of checks) { const s = byName.get(ch.name) ?? { pass: 0, total: 0 }; s.total++; if (ch.pass) s.pass++; byName.set(ch.name, s); }
  for (const [name, s] of byName) console.log(`  ${name.padEnd(42)} ${s.pass}/${s.total}`);
}

if (exportPath) {
  const lines = transcripts.map((t) => JSON.stringify({ messages: [
    { role: "system", content: t.system }, { role: "user", content: t.input }, { role: "assistant", content: t.output },
  ] }));
  writeFileSync(exportPath, lines.join("\n") + (lines.length ? "\n" : ""));
  console.log(`\nWrote ${lines.length} training examples to ${exportPath}. OpenAI asks for at least 10; aim for a few hundred across --repeat runs.`);
}
