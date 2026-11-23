// Which free models can do ORION's work today? Lists OpenRouter's current free text models (or takes ids as
// arguments) and runs each on the three model tasks: reading a question, scoring, and writing new paths.
//   bun scripts/free-models.ts                      # every free text model OpenRouter lists now
//   bun scripts/free-models.ts nvidia/nemotron-3.5-super-vl:free poolside/laguna-xs-2.1:free
// Needs OPENROUTER_API_KEY. Free tiers are rate-limited and noisy: run it twice before trusting one result.
import { parseWithAI, scoreWithAI } from "../server/decision-ai.ts";
import { divergeWithAI } from "../server/creative.ts";
import { ModelRouter } from "../server/router.ts";

const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("Set OPENROUTER_API_KEY."); process.exit(1); }

async function listFree(): Promise<string[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  const { data } = (await res.json()) as { data: { id: string; created: number; architecture?: { input_modalities?: string[]; output_modalities?: string[] } }[] };
  return data
    .filter((m) => m.id.endsWith(":free") || m.id === "openrouter/free")
    .filter((m) => (m.architecture?.output_modalities ?? ["text"]).includes("text") && !/safety|guard/i.test(m.id))
    .sort((a, b) => b.created - a.created)
    .map((m) => m.id);
}

const question = "Should I take a job offer in Berlin or stay at my current job in Kigali? Berlin pays more but I would leave my family.";
const scoring = { context: question, stakes: "major" as const, options: [{ id: "a", label: "Take the Berlin job" }, { id: "b", label: "Stay in Kigali" }], factors: [{ id: "p", label: "Pay" }, { id: "f", label: "Family" }, { id: "g", label: "Career growth" }] };

async function bench(model: string) {
  const options = () => ({ env: { OPENROUTER_API_KEY: key, ORION_COMPAT_MODELS: model }, timeoutMs: 60_000, router: new ModelRouter({ budgetMs: 65_000 }) });
  const tasks = [
    ["parse", () => parseWithAI(question, options())],
    ["score", () => scoreWithAI(scoring, options())],
    ["paths", () => divergeWithAI({ ...scoring, paths: 3 }, options())],
  ] as const;
  const cells: string[] = [];
  for (const [name, run] of tasks) {
    const start = Date.now();
    try { await run(); cells.push(`${name} ${((Date.now() - start) / 1000).toFixed(1)}s`); }
    catch { cells.push(`${name} ✗`); }
  }
  return `${model.padEnd(48)} ${cells.map((c) => c.padEnd(12)).join(" ")}`;
}

const models = process.argv.length > 2 ? process.argv.slice(2) : await listFree();
console.log(`Testing ${models.length} models, four at a time…`);
for (let i = 0; i < models.length; i += 4) console.log((await Promise.all(models.slice(i, i + 4).map(bench))).join("\n"));
