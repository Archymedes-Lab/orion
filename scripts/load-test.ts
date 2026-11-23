// Launch-day rehearsal: many first-time visitors at once, each from their own address, through the web app's proxy.
// Each visitor opens /app, checks who they are, and then either decides as a guest or signs up and decides.
//
//   bun scripts/load-test.ts http://localhost:3000 [visitors=60] [spreadSeconds=20] [--no-models]
//
// --no-models stops after signup and the session check, so the limits and the account store can be tested at a
// larger scale without spending model calls. Run it against a local stack (ORION_ACCOUNT_STORE=memory): it creates
// real accounts in whatever store the API uses.
const [base = "http://localhost:3000", visitorsArg = "60", spreadArg = "20"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const models = !process.argv.includes("--no-models");
const visitors = Number(visitorsArg), spreadMs = Number(spreadArg) * 1000;

const QUESTIONS = [
  "Should I take the job offer in Seoul or stay at my current company?",
  "Rent a flat downtown or buy a house in the suburbs?",
  "Learn Rust or Go next for my backend career?",
  "Cook at home tonight or order takeaway?",
  "Should we hire a second engineer now or wait until next quarter?",
  "Take a gap year before university or start right away?",
  "Buy a used car or keep taking the bus?",
  "Move in together this year or wait?",
];

type Step = "page" | "me" | "signup" | "parse" | "score";
const results: Record<Step, { ms: number[]; status: Record<string, number> }> = {
  page: { ms: [], status: {} }, me: { ms: [], status: {} }, signup: { ms: [], status: {} }, parse: { ms: [], status: {} }, score: { ms: [], status: {} },
};

const errors = new Set<string>();
async function timed(step: Step, run: () => Promise<Response>) {
  const began = performance.now();
  let res: Response | null = null;
  try { res = await run(); } catch (error) { if (!errors.has(String(error))) { errors.add(String(error)); console.error(`${step}: ${String(error)}`); } }
  const ms = performance.now() - began;
  const key = res ? String(res.status) : "network";
  results[step].ms.push(ms);
  results[step].status[key] = (results[step].status[key] ?? 0) + 1;
  return res;
}

async function visitor(i: number) {
  // A documentation-range address per visitor, as the platform would give the web app.
  const ip = `198.18.${Math.floor(i / 250)}.${(i % 250) + 1}`;
  let cookie = "";
  const headers = () => ({ "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) });
  const keep = (res: Response | null) => { const set = res?.headers.get("set-cookie"); if (set) cookie = set.split(";")[0]; return res; };
  const post = (path: string, body: unknown) => fetch(`${base}/api/orion/${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });

  await timed("page", () => fetch(`${base}/app`, { headers: { "x-forwarded-for": ip } }).then(async (r) => { await r.text(); return r; }));
  await timed("me", () => fetch(`${base}/api/orion/auth/me`, { headers: headers() }));
  // Half sign up first; the other half try ORION as guests.
  if (i % 2 === 0) {
    keep(await timed("signup", () => post("auth/signup", { username: `load${i}x${Date.now() % 100000}`, email: `load${i}.${Date.now()}@example.com`, password: "correct horse battery staple", acceptTerms: true })));
  }
  if (!models) return;
  const parsed = await timed("parse", () => post("decision/parse", { input: QUESTIONS[i % QUESTIONS.length] }));
  if (!parsed?.ok) return;
  const json = await parsed.json() as { title?: string; options?: { id: string; label: string }[]; factors?: { id: string; label: string }[] };
  if (!json.options?.length || !json.factors?.length) return;
  await timed("score", () => post("decision/score-factors", {
    context: QUESTIONS[i % QUESTIONS.length], stakes: "normal",
    options: json.options!.slice(0, 4).map((o) => ({ id: o.id, label: o.label })), factors: json.factors!.slice(0, 8).map((f) => ({ id: f.id, label: f.label.slice(0, 40) })),
  }));
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const began = Date.now();
await Promise.all(Array.from({ length: visitors }, (_, i) => new Promise<void>((done) => setTimeout(() => visitor(i).finally(done), (i / visitors) * spreadMs))));
console.log(`${visitors} visitors over ${spreadMs / 1000}s against ${base}${models ? "" : " (no model calls)"}; finished in ${((Date.now() - began) / 1000).toFixed(1)}s`);
for (const [step, r] of Object.entries(results)) {
  if (!r.ms.length) continue;
  console.log(`${step.padEnd(7)} n=${String(r.ms.length).padStart(4)}  p50 ${pct(r.ms, 0.5).toFixed(0).padStart(6)} ms  p95 ${pct(r.ms, 0.95).toFixed(0).padStart(6)} ms  max ${Math.max(...r.ms).toFixed(0).padStart(6)} ms  status ${JSON.stringify(r.status)}`);
}
