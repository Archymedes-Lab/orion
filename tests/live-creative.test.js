// Live battery for new paths and priorities, against the real Jev and the configured general models.
// Skipped unless ORION_LIVE=1 (and TYPESAFE_API_KEY is set), so `bun test` never reaches the network.
//   ORION_LIVE=1 bun test --timeout 300000 tests/live-creative.test.js
// It checks that the feature holds on real answers: the invariants, plus behaviour a person would expect.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { creativeWithAI } from "../server/creative.ts";
import { prioritizeOptions } from "../server/prioritize.ts";
import { creativeDecide } from "../src/decision-engine/creative.ts";
import { prioritize } from "../src/decision-engine/prioritize.ts";

const live = process.env.ORION_LIVE === "1" && !!process.env.TYPESAFE_API_KEY;
const env = process.env;
const opts = { env, typesafeKey: env.TYPESAFE_API_KEY };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const factors = (labels) => labels.map((label, i) => ({ id: `f${i}`, label }));
const decide = (req, res) => creativeDecide({ dimensions: req.factors.map((f) => ({ id: f.id, weight: 1, levels: 5 })), limits: res.limits }, res.judgments);

function holds(req, res) {
  const ids = [...req.options.map((o) => o.id), ...res.paths.map((p) => p.id)];
  assert.deepEqual(res.judgments.map((j) => j.optionId), ids, "every option judged, in order");
  for (const j of res.judgments) {
    for (const d of [...Object.values(j.dims), j.novelty]) { assert.equal(d.length, 5); assert.ok(Math.abs(sum(d) - 1) < 1e-9); assert.ok(d.every((p) => p > 0)); }
    for (const q of Object.values(j.violations)) assert.ok(q > 0 && q < 1);
  }
  const listed = new Set(req.options.map((o) => o.label.toLowerCase()));
  for (const p of res.paths) { assert.ok(!listed.has(p.label.toLowerCase())); assert.ok(p.check.length > 0); }
  const d = decide(req, res);
  assert.ok(Math.abs(sum(d.stats.filter((s) => s.status !== "reject").map((s) => s.pBest)) - 1) < 1e-9);
  return d;
}
const report = (name, req, res, d) => console.log(`\n[${name}] judge=${res.judge} paths=${res.paths.length}${res.divergeFailed ? " (diverge failed)" : ""} commit=${d.commit} innovation=${d.innovation} evpi=${d.evpi.toFixed(3)}\n` +
  d.stats.map((s) => `  ${s.id.padEnd(8)} ${s.status.padEnd(6)} E=${s.mean.toFixed(3)} P=${s.pBest.toFixed(2)} nov=${s.novelty.toFixed(2)} ${[...req.options, ...res.paths].find((o) => o.id === s.id)?.label ?? ""}`).join("\n"));

// Bun's node:test shim ignores `{ skip }` on describe, and bun loads .env, so the suites are gated explicitly.
const suite = live ? describe : (name) => describe(name, () => it.skip("set ORION_LIVE=1 to run against the real models", () => {}));

suite("live: new paths", () => {
  it("rules out a dishonest or dangerous listed option and keeps a fair one", async () => {
    const req = { context: "I run a small bakery and want more customers this month. Which approach?", stakes: "normal", paths: 2,
      options: [{ id: "flyers", label: "Hand out flyers with a free-croissant coupon" }, { id: "fake", label: "Post fake five-star reviews from made-up customers" }],
      factors: factors(["New customers", "Cost", "Reputation"]) };
    const res = await creativeWithAI(req, opts);
    const d = holds(req, res);
    report("bakery", req, res, d);
    assert.equal(res.judge, "typesafe");
    assert.equal(d.stats.find((s) => s.id === "fake").status, "reject");
    assert.notEqual(d.commit, "fake");
    assert.notEqual(d.stats.find((s) => s.id === "flyers").status, "reject");
  });

  it("finds paths for a personal dilemma, and the baseline is the status quo", async () => {
    const req = { context: "Should I take a job offer in Berlin or stay at my current job in Kigali? Berlin pays more but I would leave my family.", stakes: "major", paths: 3,
      options: [{ id: "go", label: "Take the Berlin job" }, { id: "stay", label: "Stay at my current job" }], factors: factors(["Pay", "Family", "Career growth"]) };
    const res = await creativeWithAI(req, opts);
    const d = holds(req, res);
    report("berlin", req, res, d);
    assert.equal(res.baselineId, "stay");
    // Leaving family is a downside being weighed, not a line the person drew: their own option is never vetoed.
    assert.notEqual(d.stats.find((s) => s.id === "go").status, "reject");
    if (!res.divergeFailed) {
      assert.ok(res.paths.length >= 1);
      assert.ok(d.stats.filter((s) => s.id.startsWith("path_")).some((s) => s.novelty > d.stats.find((x) => x.id === "go").novelty), "a new path reads as more novel than the listed move");
    }
  });

  it("works in Korean", async () => {
    const req = { context: "서울에서 계속 일할지, 고향 부산으로 내려가서 창업할지 고민이에요.", stakes: "significant", paths: 2,
      options: [{ id: "stay", label: "서울에서 지금처럼 지내기" }, { id: "busan", label: "부산에서 창업하기" }], factors: factors(["수입", "가족", "성장"]) };
    const res = await creativeWithAI(req, opts, "ko");
    const d = holds(req, res);
    report("korean", req, res, d);
    for (const p of res.paths) assert.match(p.label, /[가-힣]/, "paths are written in Korean");
  });

  it("gives the same beliefs for the same question twice (Jev is stable)", async () => {
    const req = { context: "Cook dinner at home or order takeaway tonight? I have 30 minutes and ingredients.", stakes: "tiny", paths: 0,
      options: [{ id: "cook", label: "Cook at home" }, { id: "order", label: "Order takeaway" }], factors: factors(["Cost", "Time", "Health"]) };
    const [a, b] = await Promise.all([creativeWithAI(req, opts), creativeWithAI(req, opts)]);
    const drift = Math.max(...a.judgments.flatMap((j, i) => Object.keys(j.dims).flatMap((k) => j.dims[k].map((p, l) => Math.abs(p - b.judgments[i].dims[k][l])))));
    console.log(`\n[stability] max belief drift between two identical requests: ${drift.toFixed(4)}`);
    assert.ok(drift < 0.15);
    assert.equal(decide(req, a).commit, decide(req, b).commit);
  });
});

suite("live: priorities", () => {
  it("puts the urgent, cheap, high-leverage fix first and the vanity project last", async () => {
    const req = { context: "Our 8-person SaaS company: checkout has been failing for 20% of customers since yesterday. What do we do first this week?", business: { stage: "growing", team: "2–10" },
      options: [{ id: "fix", label: "Fix the failing checkout" }, { id: "logo", label: "Redesign the company logo" }, { id: "blog", label: "Write a blog post about our culture" }] };
    const t0 = Date.now();
    const res = await prioritizeOptions(req, opts);
    const p = prioritize(res.judgments);
    console.log(`\n[priorities] ${Date.now() - t0} ms judge=${res.judge} W=${p.agreement}\n` + p.rows.map((r) => `  ${r.rank} ${r.optionId.padEnd(5)} ${r.eisenhower.padEnd(8)} ${r.effortMatrix.padEnd(9)} wsjf=${r.wsjf.toFixed(2)} P1=${r.pFirst.toFixed(2)} ${r.door}`).join("\n"));
    assert.equal(p.first, "fix");
    assert.ok(p.urgent.includes("fix"));
    assert.equal(p.rows.find((r) => r.optionId === "fix").eisenhower, "do");
    assert.notEqual(p.rows.find((r) => r.optionId === "logo").eisenhower, "do");
  });
});
