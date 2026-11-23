// /decision/creative and /decision/prioritize through the real HTTP handler, with a fake Jev and a fake OpenAI.
// Checks the request shapes (orbits, one request per option), the decoding back to label order, the fallbacks, the
// support path and the contract the web app relies on. No network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../server/index.ts";
import { APPROACHES, BASE_LIMITS, NOVELTY_LEVELS, buildQuestions, grounded, guessBaseline } from "../server/creative.ts";
import { FACTOR_LEVELS } from "../server/typesafe.ts";
import { creativeDecide } from "../src/decision-engine/creative.ts";
import { PRIORITY_DIMENSIONS, PRIORITY_QUESTIONS, prioritize } from "../src/decision-engine/prioritize.ts";
import { invoke, openaiResponse } from "./helpers/ai.js";

const request = {
  context: "Should I take the Berlin job offer or stay at my job in Kigali? Berlin pays more but I would leave my family. I have a budget of no more than  €5,000 for the move.",
  stakes: "major",
  options: [{ id: "go", label: "Take the Berlin job" }, { id: "stay", label: "Stay at my current job" }],
  factors: [{ id: "pay", label: "Pay" }, { id: "family", label: "Family" }],
};
const diverged = {
  paths: [
    { label: "Trial three months remote first", description: "Work for the Berlin team from Kigali for a quarter.", niche: "staged", check: "Ask the employer whether a remote trial is allowed." },
    { label: "Take the Berlin job", description: "A duplicate of a listed option: must be dropped.", niche: "direct", check: "None." },
    { label: "Tell the landlord a fake reason to break the lease", description: "Mislead them to leave early.", niche: "made_up", check: "Ask a lawyer." },
  ],
  limits: [
    { label: "Not without the family", violation: "mean leaving the family behind for good", quote: "I would leave my family" },
    { label: "Budget of €5,000", violation: "cost more than the €5,000 they have", quote: "a budget of no more than €5,000" },
  ],
  statusQuo: "Stay at my current job",
};

/** Peak level per option and question, so a test can say what the judge "believes". */
function truthFor(option, qid) {
  if (qid.startsWith("novelty")) return option.startsWith("Trial") ? 4 : 0;
  if (option.startsWith("Stay")) return 1;
  if (option.startsWith("Trial")) return 4;
  return 2;
}
const LEVEL_SETS = [FACTOR_LEVELS, NOVELTY_LEVELS, ...Object.values(PRIORITY_QUESTIONS).map((q) => q.levels)];

/**
 * A fake System One: answers every question, with a position bias on Scores (it favours whatever is shown first),
 * keyed the way the real API keys them — Scores by presented position, Choices by label.
 */
function fakeJev(log, { fail = false } = {}) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    log.push(body);
    if (fail) return new Response("boom", { status: 500 });
    const option = body.state.option;
    const answers = {};
    for (const [qid, q] of Object.entries(body.questions)) {
      if (q.type === "noul") {
        const lie = /fake|mislead/i.test(option);
        answers[qid] = { type: "noul", noul: qid.includes("law") && lie ? 0.97 : qid.includes("own_2") ? 0.5 : 0.03 };
      } else if (q.type === "score") {
        const levels = LEVEL_SETS.find((set) => set.length === q.criteria.length && q.criteria.every((c) => set.includes(c)));
        const peak = truthFor(option, qid);
        const probabilities = {};
        q.criteria.forEach((label, position) => {
          const canonical = levels.indexOf(label);
          probabilities[String(position)] = (canonical === peak ? 0.8 : 0.05) * (position === 0 ? 1.5 : 1);
        });
        const total = Object.values(probabilities).reduce((a, b) => a + b, 0);
        for (const k of Object.keys(probabilities)) probabilities[k] /= total;
        answers[qid] = { type: "score", score: 0, legend: {}, probabilities, confidence: 0.8 };
      } else {
        const labels = Object.keys(q.criteria);
        const want = option.startsWith("Trial") ? "staged" : "direct";
        answers[qid] = { type: "choice", choice: want, probabilities: Object.fromEntries(labels.map((l) => [l, l === want ? 0.85 : 0.15 / (labels.length - 1)])), confidence: 0.8 };
      }
    }
    return Response.json({ model: "jev-test", answers, usage: { input_tokens: 1, output_tokens: 1 } });
  };
}

/** Routes the fake fetch: Jev for typesafe.ai, OpenAI by task (the response format names it). */
function fakeFetch({ jev, openai = {} }) {
  return async (url, init) => {
    if (String(url).includes("typesafe")) return jev(url, init);
    const body = JSON.parse(init.body);
    const task = body.text?.format?.name?.replace("orion_", "");
    openai.calls?.push({ task, body });
    if (openai.fail) return new Response("down", { status: 503 });
    return openaiResponse(openai[task] ?? {});
  };
}

const serve = (env, fetchImpl) => handler({ env, fetchImpl });
const call = (h, path, body, headers = {}) => invoke(h, path, body, headers);

describe("question building", () => {
  it("asks each Score in both directions, one Noul per limit and the niche once per rotation", () => {
    const { qs, orbits } = buildQuestions(request.factors, BASE_LIMITS, APPROACHES);
    const nNiche = Object.keys(APPROACHES).length + 1;
    assert.equal(Object.keys(qs).length, 2 * request.factors.length + BASE_LIMITS.length + 2 + nNiche);
    assert.deepEqual(qs["f0@1"].criteria, [...FACTOR_LEVELS].reverse());
    assert.ok(qs["f0@0"].instructions.includes('"Pay"'));
    assert.equal(orbits.niche.length, nNiche);
    assert.ok(Object.keys(qs["niche@0"].criteria).includes("other"));
  });
  it("finds the status quo among the options by its wording", () => {
    assert.equal(guessBaseline(request.options), "stay");
    assert.equal(guessBaseline([{ id: "a", label: "지금처럼 지내기" }, { id: "b", label: "이사하기" }]), "a");
    assert.equal(guessBaseline([{ id: "a", label: "Cook" }, { id: "b", label: "Order" }]), null);
  });
});

describe("grounding the person's own limits", () => {
  it("keeps a limit only when its quote is really in the question", () => {
    const q = "Berlin pays more, but I won’t move without my kids. Budget: €5,000.";
    assert.equal(grounded("I won't move without my kids", q), true, "curly vs straight quotes and case don't matter");
    assert.equal(grounded("budget:  €5,000", q), true);
    assert.equal(grounded("I must stay near my parents", q), false, "an invented limit is dropped");
    assert.equal(grounded("", q), false);
    assert.equal(grounded("I", q), false, "too short to mean anything");
  });
  it("drops an ungrounded limit from the response", async () => {
    const invented = { ...diverged, limits: [{ label: "Stay near parents", violation: "take them far from their parents", quote: "I must stay near my parents" }] };
    const h = serve({ TYPESAFE_API_KEY: "k", OPENAI_API_KEY: "o" }, fakeFetch({ jev: fakeJev([]), openai: { diverge: invented } }));
    const res = await call(h, "/decision/creative", request);
    assert.deepEqual(res.body.limits.map((l) => l.id), ["harm", "law", "stretch"]);
  });
});

describe("/decision/creative", () => {
  it("writes new paths, has Jev judge every option once, and returns beliefs the engine can decide on", async () => {
    const log = [], openai = { calls: [], diverge: diverged };
    const h = serve({ TYPESAFE_API_KEY: "k", OPENAI_API_KEY: "o" }, fakeFetch({ jev: fakeJev(log), openai }));
    const res = await call(h, "/decision/creative", request);
    assert.equal(res.status, 200);
    const body = res.body;
    assert.equal(body.judge, "typesafe");
    assert.equal(body.divergeFailed, false);
    assert.deepEqual(body.paths.map((p) => p.label), ["Trial three months remote first", "Tell the landlord a fake reason to break the lease"], "the duplicate is dropped");
    assert.equal(body.paths[1].niche, "other", "an unknown approach type becomes other");
    assert.equal(body.baselineId, "stay");
    // Both quotes are in the question (the second only after normalising its double space).
    assert.deepEqual(body.limits.map((l) => l.id), ["harm", "law", "stretch", "own_1", "own_2"]);
    assert.deepEqual(body.limits.map((l) => !!l.checkOnly), [false, false, false, true, true], "the person's limits only ever ask for a check");
    // One Jev request per option, listed and new, each with that option in the state and every question.
    assert.equal(log.length, 4);
    assert.deepEqual(log.map((b) => b.state.option.split(":")[0]).sort(), ["Stay at my current job", "Take the Berlin job", "Tell the landlord a fake reason to break the lease", "Trial three months remote first"]);
    assert.ok(log.every((b) => Object.keys(b.questions).length === Object.keys(log[0].questions).length));
    assert.deepEqual(log[0].state.precedents, request.options.map((o) => o.label));
    for (const j of body.judgments) {
      for (const dist of [...Object.values(j.dims), j.novelty, Object.values(j.niche)]) {
        assert.ok(Math.abs(dist.reduce((a, b) => a + b, 0) - 1) < 1e-9);
        assert.ok(dist.every((p) => p > 0 && p < 1), "beliefs stay in the open simplex");
      }
    }
    // The reversal orbit cancels the judge's first-position bias: the peak comes back where the judge put it.
    const trial = body.judgments.find((j) => j.optionId === "path_1");
    assert.equal(trial.dims.pay.indexOf(Math.max(...trial.dims.pay)), 4);
    assert.ok(trial.niche.staged > 0.5);

    const d = creativeDecide({ dimensions: request.factors.map((f) => ({ id: f.id, weight: 1, levels: 5 })), limits: body.limits }, body.judgments);
    const stat = (id) => d.stats.find((s) => s.id === id);
    assert.equal(stat("path_2").status, "reject", "the deceptive path is ruled out");
    assert.equal(stat("path_1").status, "verify", "an unknown own limit means check first, not a veto");
    assert.deepEqual(stat("path_1").checks, ["own_2"]);
    assert.equal(d.commit, "path_1");
    assert.equal(stat("stay").baseline, true);
  });

  it("falls back to a general model when Jev fails, and says so", async () => {
    const log = [];
    const judged = { options: ["go", "stay", "path_1", "path_2"].map((optionId) => ({
      optionId, novelty: optionId.startsWith("path") ? 3 : 0, niche: "direct",
      factors: request.factors.map((f) => ({ factorId: f.id, level: 2, confidence: 0.5 })),
      limits: ["harm", "law", "stretch", "own_1", "own_2"].map((limitId) => ({ limitId, probability: 0.1 })),
    })) };
    const h = serve({ TYPESAFE_API_KEY: "k", OPENAI_API_KEY: "o" }, fakeFetch({ jev: fakeJev(log, { fail: true }), openai: { diverge: diverged, score: judged } }));
    const res = await call(h, "/decision/creative", request);
    assert.equal(res.status, 200);
    assert.equal(res.body.judge, "ai");
    assert.equal(res.body.judgments.length, 4);
  });

  it("still judges the listed options when no new path can be written", async () => {
    const h = serve({ TYPESAFE_API_KEY: "k" }, fakeFetch({ jev: fakeJev([]) }));
    const res = await call(h, "/decision/creative", request);
    assert.equal(res.status, 200);
    assert.equal(res.body.divergeFailed, true);
    assert.deepEqual(res.body.paths, []);
    assert.deepEqual(res.body.judgments.map((j) => j.optionId), ["go", "stay"]);
  });

  it("judges the listed options without new paths when writing them runs past the budget", async () => {
    const { creativeWithAI } = await import("../server/creative.ts");
    const slow = fakeFetch({ jev: fakeJev([]), openai: { diverge: diverged } });
    const fetchImpl = async (url, init) => (String(url).includes("typesafe") ? slow(url, init) : new Promise((resolve) => setTimeout(() => resolve(slow(url, init)), 400)));
    const started = Date.now();
    const res = await creativeWithAI({ ...request, paths: 3 }, { env: { OPENAI_API_KEY: "o" }, fetchImpl, typesafeKey: "k", divergeBudgetMs: 50 });
    assert.ok(Date.now() - started < 380, "did not wait for the slow model");
    assert.equal(res.divergeFailed, true);
    assert.deepEqual(res.judgments.map((j) => j.optionId), ["go", "stay"]);
  });

  it("asks for no paths when told not to", async () => {
    const openai = { calls: [], diverge: diverged };
    const h = serve({ TYPESAFE_API_KEY: "k", OPENAI_API_KEY: "o" }, fakeFetch({ jev: fakeJev([]), openai }));
    const res = await call(h, "/decision/creative", { ...request, paths: 0 });
    assert.equal(res.body.divergeFailed, false);
    assert.equal(openai.calls.filter((c) => c.task === "diverge").length, 0);
  });

  it("answers 503 when no judge is available at all", async () => {
    const res = await call(serve({}, async () => { throw new Error("no network in tests"); }), "/decision/creative", request);
    assert.equal(res.status, 503);
  });

  it("never models a crisis", async () => {
    const log = [];
    const res = await call(serve({ TYPESAFE_API_KEY: "k" }, fakeFetch({ jev: fakeJev(log) })), "/decision/creative", { ...request, context: "I want to kill myself, should I do it tonight or tomorrow?" });
    assert.equal(res.status, 422);
    assert.equal(log.length, 0, "no model saw it");
  });

  it("refuses malformed requests", async () => {
    const h = serve({ TYPESAFE_API_KEY: "k" }, fakeFetch({ jev: fakeJev([]) }));
    for (const bad of [{ ...request, options: [] }, { ...request, factors: [] }, { ...request, paths: 9 }, { ...request, context: "" }, { ...request, options: Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, label: `O${i}` })) }]) {
      assert.equal((await call(h, "/decision/creative", bad)).status, 400);
    }
  });

  it("writes the paths in Korean when the person reads Korean", async () => {
    const openai = { calls: [], diverge: diverged };
    const h = serve({ TYPESAFE_API_KEY: "k", OPENAI_API_KEY: "o" }, fakeFetch({ jev: fakeJev([]), openai }));
    await call(h, "/decision/creative", request, { "x-orion-lang": "ko" });
    const prompt = JSON.stringify(openai.calls.find((c) => c.task === "diverge").body);
    assert.match(prompt, /LANGUAGE: KOREAN/);
  });

  it("adds the business playbook for a company decision", async () => {
    const openai = { calls: [], diverge: diverged };
    const h = serve({ TYPESAFE_API_KEY: "k", OPENAI_API_KEY: "o" }, fakeFetch({ jev: fakeJev([]), openai }));
    await call(h, "/decision/creative", { ...request, context: "Should our startup raise prices or hire a salesperson?", business: { stage: "early" } });
    assert.match(JSON.stringify(openai.calls.find((c) => c.task === "diverge").body), /BUSINESS NEW PATHS/);
  });
});

describe("/decision/prioritize", () => {
  const prio = { context: "Our startup has 7 months of runway. What do we do first?", business: { stage: "early" },
    options: [{ id: "fix", label: "Trial onboarding fix" }, { id: "rewrite", label: "Rewrite the backend" }, { id: "price", label: "Stay on current pricing" }] };

  it("asks the seven dimensions both ways, once per option, and the matrices follow", async () => {
    const log = [];
    const res = await call(serve({ TYPESAFE_API_KEY: "k" }, fakeFetch({ jev: fakeJev(log) })), "/decision/prioritize", prio);
    assert.equal(res.status, 200);
    assert.equal(res.body.judge, "typesafe");
    assert.equal(log.length, 3);
    assert.equal(Object.keys(log[0].questions).length, 2 * PRIORITY_DIMENSIONS.length);
    assert.ok(log[0].state.company, "the company brief travels in the state");
    const p = prioritize(res.body.judgments);
    assert.equal(p.rows.length, 3);
    assert.equal(p.first, "fix", "the option the judge rates highest on everything comes first");
  });

  it("falls back to a general model, and refuses a crisis", async () => {
    const rated = { options: prio.options.map((o) => ({ optionId: o.id, ratings: PRIORITY_DIMENSIONS.map((dimension) => ({ dimension, level: 2, confidence: 0.5 })) })) };
    const ok = await call(serve({ OPENAI_API_KEY: "o" }, fakeFetch({ jev: fakeJev([]), openai: { score: rated } })), "/decision/prioritize", prio);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.judge, "ai");
    const crisis = await call(serve({ TYPESAFE_API_KEY: "k" }, fakeFetch({ jev: fakeJev([]) })), "/decision/prioritize", { ...prio, context: "I want to end my life" });
    assert.equal(crisis.status, 422);
  });
});
