import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreAndTriage, useSession, withPersonalContext } from "../src/store/session.ts";
import { db } from "../src/db/database.ts";
import { getAffinities } from "../src/db/preferences.ts";
import { scoreAll } from "../src/decision-engine/uncertainty.ts";

beforeEach(async () => {
  useSession.setState({ privateMode: false });
  useSession.getState().reset();
  await db.init();
  for (const table of ["decisions", "decision_metadata", "options", "factors", "option_factor_values", "questions", "user_preferences", "decision_outcomes", "decision_choices"]) {
    await db.clearTable(table);
  }
});

const estimates = (s) => s.options.flatMap((o, i) => s.factors.map((f) => ({
  optionId: o.id, factorId: f.id, value: i === 0 ? 6 : -2, probabilityConfidence: 0.5,
})));

describe("offline decision lifecycle", () => {
  it("retains a deliberately neutral manual comparison as a scored tie", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    assert.equal(s.setManualScores(estimates(s).map((v) => ({ ...v, value: 0 }))), true);
    assert.equal(useSession.getState().scoringSource, "manual");
    await useSession.getState().commit(null);
    useSession.getState().reset();
    await useSession.getState().loadDecision(s.decisionId);
    assert.equal(useSession.getState().scoringSource, "manual");
    assert.ok(scoreAll(useSession.getState().options, s.factors).every((o) => o.jev === 0));
  });
  it("uses user estimates, persists a choice, and reopens the same comparison", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    let s = useSession.getState();
    assert.equal(s.offline, true);
    assert.ok(scoreAll(s.options, s.factors).every((o) => o.jev === 0));
    assert.equal(s.setManualScores(estimates(s)), true);
    s = useSession.getState();
    const before = scoreAll(s.options, s.factors);
    assert.deepEqual(before.map((o) => o.jev), [6, -2]);
    const id = s.decisionId;
    const selected = s.options[0].id;
    await s.commit(selected);
    assert.equal(useSession.getState().saved, true);
    useSession.getState().reset();
    assert.equal(await useSession.getState().loadDecision(id), true);
    s = useSession.getState();
    assert.equal(s.committedOptionId, selected);
    assert.deepEqual(scoreAll(s.options, s.factors), before);
  });

  it("updates repeated saves without duplicating the model or answers", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    assert.ok(s.questions.length > 0);
    s.answer(s.questions[0].question, s.factors[0].id);
    await useSession.getState().commit(s.options[0].id);
    const original = await db.get("decisions", s.decisionId);
    await useSession.getState().commit(s.options[1].id);
    await useSession.getState().commit(null);
    assert.equal((await db.list("decisions")).length, 1);
    assert.equal((await db.list("options")).length, s.options.length);
    assert.equal((await db.list("factors")).length, s.factors.length);
    assert.equal((await db.list("option_factor_values")).length, s.options.length * s.factors.length);
    assert.equal((await db.list("questions")).length, 1);
    const latest = await db.get("decisions", s.decisionId);
    assert.equal(latest.created_at, original.created_at);
    assert.equal(latest.status, "open");
    assert.equal(latest.selected_option_id, null);
  });

  it("rejects incomplete, duplicate, unknown, and invalid impact estimates", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    const valid = estimates(s);
    for (const bad of [
      valid.slice(1),
      [valid[0], ...valid.slice(0, -1)],
      valid.map((v) => ({ ...v, optionId: "unknown" })),
      valid.map((v) => ({ ...v, value: NaN })),
      valid.map((v) => ({ ...v, value: 11 })),
      valid.map((v) => ({ ...v, probabilityConfidence: 2 })),
    ]) assert.equal(s.setManualScores(bad), false);
    assert.ok(scoreAll(useSession.getState().options, s.factors).every((o) => o.jev === 0));
  });

  it("accepts user-entered outcomes and lets them change the ranking", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    let s = useSession.getState();
    const flat = estimates(s);
    assert.equal(s.setManualScores(flat), true);
    assert.deepEqual(scoreAll(useSession.getState().options, s.factors).map((o) => o.jev), [6, -2]);

    // Same expected impacts, but option 0 has a bad case that is likely enough
    // to outweigh its good one. Option 1 keeps both branches on its estimate.
    const risky = s.options[0].id;
    const scenarios = s.options.flatMap((o) => {
      const expected = Object.fromEntries(
        s.factors.map((f) => [f.id, flat.find((v) => v.optionId === o.id && v.factorId === f.id).value])
      );
      const bad = Object.fromEntries(s.factors.map((f) => [f.id, -10]));
      return o.id === risky
        ? [
            { optionId: o.id, label: `${o.label} — as expected`, probability: 0.4, probabilityConfidence: 0.5, values: expected },
            { optionId: o.id, label: `${o.label} — if it goes badly`, probability: 0.6, probabilityConfidence: 0.5, values: bad },
          ]
        : [{ optionId: o.id, label: `${o.label} — as expected`, probability: 1, probabilityConfidence: 0.5, values: expected }];
    });
    assert.equal(s.setManualScores(flat, scenarios), true);
    s = useSession.getState();
    assert.equal(s.options[0].outcomes.length, 2);
    assert.equal(s.options[1].outcomes.length, 1);
    const scored = scoreAll(s.options, s.factors);
    // Option 0: 0.4×6 + 0.6×(−10) = −3.6, so it no longer leads on JEV.
    assert.equal(scored[0].jev, -3.6);
    assert.equal(scored[1].jev, -2);
  });

  it("rejects an incomplete or out-of-range scenario set outright", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    const flat = estimates(s);
    const good = (o) => ({
      optionId: o.id,
      label: `${o.label} case`,
      probability: 0.5,
      probabilityConfidence: 0.5,
      values: Object.fromEntries(s.factors.map((f) => [f.id, 1])),
    });
    const [a, b] = s.options;
    assert.equal(s.setManualScores(flat, []), false, "empty set");
    assert.equal(s.setManualScores(flat, [good(a)]), false, "one option missing");
    assert.equal(s.setManualScores(flat, [{ ...good(a), values: { ...good(a).values, nope: 3 } }, good(b)]), false, "unknown factor");
    assert.equal(s.setManualScores(flat, [{ ...good(a), values: Object.fromEntries(s.factors.map((f) => [f.id, 99])) }, good(b)]), false, "out of range");
    assert.equal(s.setManualScores(flat, [{ ...good(a), values: Object.fromEntries(s.factors.map((f) => [f.id, NaN])) }, good(b)]), false, "not a number");
    assert.equal(s.setManualScores(flat, [{ ...good(a), optionId: "ghost" }, good(b)]), false, "unknown option");
    assert.equal(s.setManualScores(flat, [{ ...good(a), label: "  " }, good(b)]), false, "blank label");
    assert.equal(s.setManualScores(flat, [{ ...good(a), probabilityConfidence: 4 }, good(b)]), false, "bad confidence");
    assert.equal(s.setManualScores(flat, [{ ...good(a), probability: -1 }, good(b)]), false, "bad probability");
    assert.equal(s.setManualScores(flat, [{ ...good(a), values: {} }, good(b)]), false, "no factors");
    assert.equal(s.setManualScores(flat, [good(a), good(b)]), true, "complete set");
    assert.ok(useSession.getState().options.every((o) => o.outcomes.length === 1));
  });

  it("records what it predicted so a later review can be compared", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    let s = useSession.getState();
    s.setManualScores(estimates(s));
    const expected = scoreAll(useSession.getState().options, s.factors)[0].jev;

    await useSession.getState().commit(useSession.getState().options[0].id);
    const rows = await db.list("decision_outcomes");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].rating, null);
    assert.equal(Number(rows[0].expected_outcome), expected);

    // Re-saving the same decision must not stack up prediction rows.
    useSession.getState().reset();
    await useSession.getState().loadDecision(s.decisionId);
    await useSession.getState().commit(useSession.getState().options[0].id);
    assert.equal((await db.list("decision_outcomes")).length, 1);
  });

  it("records no prediction when the user has not decided", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    await useSession.getState().commit(null);
    assert.equal((await db.list("decision_outcomes")).length, 0);
  });

  it("keeps predictions out of history in private mode", async () => {
    useSession.getState().togglePrivate();
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    s.setManualScores(estimates(s));
    await useSession.getState().commit(s.options[0].id);
    assert.equal(useSession.getState().saved, true);
    assert.equal((await db.list("decision_outcomes")).length, 0);
  });

  it("saves the prediction inside the decision's transaction", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    s.setManualScores(estimates(s));

    // Rollback is table-scoped, so a prediction written outside the
    // transaction would survive a failed decision.
    const original = db.transaction.bind(db);
    let tables = [];
    db.transaction = async (t, work) => {
      tables = t;
      return original(t, work);
    };
    try {
      await useSession.getState().commit(useSession.getState().options[0].id);
    } finally {
      db.transaction = original;
    }
    assert.ok(
      tables.includes("decision_outcomes"),
      "decision_outcomes must be transactional so it rolls back with the decision"
    );
  });

  it("rolls back cleanly when saving fails part way", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    s.setManualScores(estimates(s));
    const chosen = useSession.getState().options[0].id;

    const original = db.insert.bind(db);
    db.insert = async (table, row) => {
      if (table === "decision_metadata") throw new Error("disk full");
      return original(table, row);
    };
    try {
      await useSession.getState().commit(chosen);
    } finally {
      db.insert = original;
    }
    assert.equal(useSession.getState().saved, false);
    assert.ok(useSession.getState().error);
    assert.equal((await db.list("decision_outcomes")).length, 0);
    assert.equal((await db.list("decisions")).length, 0);
    assert.equal((await db.list("options")).length, 0);
  });

  it("keeps private answers and choices out of history and learned preferences", async () => {
    useSession.getState().togglePrivate();
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    s.answer(s.questions[0].question, s.factors[0].id);
    s.setManualScores(estimates(s));
    await useSession.getState().commit(s.options[0].id);
    assert.equal(useSession.getState().saved, true);
    assert.equal((await db.list("decisions")).length, 0);
    assert.deepEqual(await getAffinities(), {});
  });

  it("routes crisis input to support without options, scoring, or saved decisions", async () => {
    await useSession.getState().submit("I want to kill myself");
    const s = useSession.getState();
    assert.equal(s.status, "ready");
    assert.equal(s.safety, "crisis");
    assert.deepEqual(s.options, []);
    assert.deepEqual(s.questions, []);
    await s.commit(null);
    assert.equal((await db.list("decisions")).length, 0);
  });

  it("does not restore a result after the user resets an in-flight submission", async () => {
    const pending = useSession.getState().submit("Should I cook or order food?");
    useSession.getState().reset();
    await pending;
    assert.equal(useSession.getState().status, "idle");
    assert.equal(useSession.getState().decisionId, null);
  });

  it("rolls back a failure midway through saving the model", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    const insert = db.insert;
    let calls = 0;
    db.insert = async function(table, row) {
      if (++calls === 4) throw new Error("Write interrupted");
      return insert.call(this, table, row);
    };
    try { await s.commit(s.options[0].id); } finally { db.insert = insert; }
    for (const table of ["decisions", "options", "factors", "option_factor_values", "decision_metadata"]) {
      assert.deepEqual(await db.list(table), []);
    }
    assert.equal(useSession.getState().saved, false);
    assert.match(useSession.getState().error, /Write interrupted/);
    await useSession.getState().commit(s.options[0].id);
    assert.equal(useSession.getState().saved, true);
  });

  it("shows a save failure and allows retry without claiming success", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    const insert = db.insert;
    db.insert = async () => { throw new Error("Disk full"); };
    try { await s.commit(s.options[0].id); } finally { db.insert = insert; }
    assert.equal(useSession.getState().saved, false);
    assert.equal(useSession.getState().committedOptionId, null);
    assert.equal(useSession.getState().saving, false);
    assert.match(useSession.getState().error, /Disk full/);
    await useSession.getState().commit(s.options[0].id);
    assert.equal(useSession.getState().saved, true);
  });
});

describe("question lifecycle helpers", () => {
  it("adds personal context to the scoring request and stays within the server limit", () => {
    assert.equal(withPersonalContext("Bus or taxi?", []), "Bus or taxi?");
    assert.equal(withPersonalContext("Bus or taxi?", ["I prefer walking", "  "]), "Bus or taxi?\n\nAbout the person deciding: I prefer walking");
    assert.equal(withPersonalContext("Bus or taxi?", ["x".repeat(5000)]).length, 4000);
  });
  it("puts the question back for rewording and reports the working stage", async () => {
    const run = useSession.getState().submit("Should I cook or order food?");
    assert.equal(useSession.getState().status, "loading");
    assert.equal(useSession.getState().stage, "reading");
    await run;
    assert.equal(useSession.getState().status, "ready");
    useSession.getState().editQuestion();
    const s = useSession.getState();
    assert.equal(s.status, "idle");
    assert.equal(s.draft, "Should I cook or order food?");
    assert.equal(s.decisionId, null);
    useSession.getState().reset();
    assert.equal(useSession.getState().draft, "");
  });
  it("drops the result of a question that was cancelled while loading", async () => {
    const run = useSession.getState().submit("Should I cook or order food?");
    useSession.getState().editQuestion();
    await run;
    assert.equal(useSession.getState().status, "idle");
    assert.equal(useSession.getState().extraction, null);
  });
});

describe("correcting what ORION understood", () => {
  it("re-runs with the person's options and factors, keeping the importance of factors they kept", async () => {
    await useSession.getState().submit("What should I do about dinner?");
    const before = useSession.getState();
    assert.deepEqual(before.options.map((o) => o.label), ["Do it", "Don't do it"], "a vague question gets the generic pair offline");
    const kept = before.extraction.factors[0];
    assert.equal(await useSession.getState().refine(["Cook at home", " cook at home ", "Order a pizza", "Eat out"], [kept.label, "Mood"]), true);
    const s = useSession.getState();
    assert.equal(s.status, "ready");
    assert.deepEqual(s.options.map((o) => o.label), ["Cook at home", "Order a pizza", "Eat out"]);
    assert.deepEqual(s.factors.map((f) => f.label), [kept.label, "Mood"]);
    assert.equal(s.extraction.factors[0].importance, kept.importance);
    assert.equal(s.rawInput, "What should I do about dinner?");
    assert.notEqual(s.decisionId, before.decisionId);
    assert.ok(Math.abs(s.factors.reduce((sum, f) => sum + f.weight, 0) - 1) < 1e-9);
  });
  it("needs two different options and a factor, and replaces a saved first reading", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    const first = useSession.getState();
    assert.equal(await first.refine(["Only one"], ["Cost"]), false);
    assert.equal(await first.refine(["Same", "same"], ["Cost"]), false);
    assert.equal(await first.refine(["A", "B"], []), false);
    assert.equal(useSession.getState().decisionId, first.decisionId, "a refused correction changes nothing");
    await useSession.getState().commit(null);
    assert.ok(await db.get("decisions", first.decisionId));
    assert.equal(await useSession.getState().refine(["Cook", "Order", "Skip dinner"], ["Cost", "Time"]), true);
    assert.equal(await db.get("decisions", first.decisionId), null);
  });
});

describe("choosing against the comparison", () => {
  // Option 0 wins on the first factor only; option 1 wins on the rest, and the first factor carries the least weight.
  async function setUp() {
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    const light = [...s.factors].sort((a, b) => a.weight - b.weight)[0];
    assert.equal(s.setManualScores(s.options.flatMap((o, i) => s.factors.map((f) => ({
      optionId: o.id, factorId: f.id, value: f.id === light.id ? (i === 0 ? 9 : -6) : (i === 0 ? -3 : 5), probabilityConfidence: 0.85,
    })))), true);
    return { light, heart: s.options[0].id, head: s.options[1].id };
  }
  it("saves how the choice sits against the comparison, and nothing judgemental when it follows it", async () => {
    const { head, heart } = await setUp();
    await useSession.getState().commit(head);
    const id = useSession.getState().decisionId;
    assert.equal((await db.get("decision_choices", id)).level, "aligned");
    await useSession.getState().commit(heart);
    const row = await db.get("decision_choices", id);
    assert.equal(row.level, "strongly_against");
    assert.equal(row.initial_level, "strongly_against");
    assert.equal(row.leader_option_id, head);
    assert.ok(row.gap > 2);
    assert.equal(row.reason, null);
  });
  it("takes 'it matters more than I said' at its word: reweights, remembers, and the choice becomes the leader", async () => {
    const { heart, light } = await setUp();
    await useSession.getState().commit(heart);
    const before = useSession.getState().factors.find((f) => f.id === light.id).weight;
    await useSession.getState().explainChoice("priority");
    const s = useSession.getState();
    assert.equal(s.choiceReason, "priority");
    assert.ok(s.factors.find((f) => f.id === light.id).weight > before);
    const scored = scoreAll(s.options, s.factors).sort((a, b) => b.jev - a.jev);
    assert.equal(scored[0].optionId, heart);
    const row = await db.get("decision_choices", s.decisionId);
    assert.deepEqual([row.level, row.initial_level, row.reason], ["aligned", "strongly_against", "priority"]);
    assert.equal((await getAffinities())[light.label.toLowerCase()], 1);
    // Reopened later, the reason and the corrected weights are still there.
    useSession.getState().reset();
    await useSession.getState().loadDecision(s.decisionId);
    assert.equal(useSession.getState().choiceReason, "priority");
    assert.ok(Math.abs(useSession.getState().factors.find((f) => f.id === light.id).weight - s.factors.find((f) => f.id === light.id).weight) < 1e-9);
  });
  it("records a deliberate choice without changing the comparison, and forgets the reason if the choice changes", async () => {
    const { heart, head } = await setUp();
    await useSession.getState().commit(heart);
    const weights = useSession.getState().factors.map((f) => f.weight);
    await useSession.getState().explainChoice("deliberate");
    assert.deepEqual(useSession.getState().factors.map((f) => f.weight), weights);
    assert.equal((await db.get("decision_choices", useSession.getState().decisionId)).reason, "deliberate");
    await useSession.getState().commit(head);
    assert.equal(useSession.getState().choiceReason, null);
    assert.equal((await db.get("decision_choices", useSession.getState().decisionId)).reason, null);
  });
  it("keeps the reason in the session only, in private mode", async () => {
    useSession.setState({ privateMode: true });
    const { heart } = await setUp();
    await useSession.getState().commit(heart);
    await useSession.getState().explainChoice("deliberate");
    assert.equal(useSession.getState().choiceReason, "deliberate");
    assert.deepEqual(await db.list("decision_choices"), []);
  });
});

// Feeling faster: what ORION understood is on screen before the scores are, and the two slow calls do not queue.
describe("showing progress while comparing", () => {
  it("puts what ORION understood on screen while the comparison is still being made", async () => {
    const seen = [];
    const stop = useSession.subscribe((state) => {
      seen.push({ status: state.status, stage: state.stage, options: state.extraction?.options.length ?? 0 });
    });
    await useSession.getState().submit("Should I cook or order food?");
    stop();
    assert.ok(seen.some((s) => s.status === "loading" && s.stage === "scoring" && s.options >= 2), "the options are shown while scoring");
    assert.equal(useSession.getState().status, "ready");
  });

  it("starts triage beside scoring, reports the scores first, and waits for both", async () => {
    const order = [];
    let finishScore;
    let finishTriage;
    const score = new Promise((resolve) => { finishScore = resolve; });
    const triage = new Promise((resolve) => { finishTriage = resolve; });
    const done = scoreAndTriage({
      score: () => { order.push("score"); return score; },
      triage: () => { order.push("triage"); return triage; },
      fallback: [],
    }, () => order.push("scored"));
    assert.deepEqual(order, ["triage", "score"], "both calls are in flight before either answers");
    finishScore("batch");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(order, ["triage", "score", "scored"]);
    finishTriage(["q1"]);
    assert.deepEqual(await done, { batch: "batch", kept: ["q1"] });
  });

  it("keeps the scores when triage fails, however it fails", async () => {
    const rejected = await scoreAndTriage({ score: async () => "batch", triage: () => Promise.reject(new Error("down")), fallback: ["kept anyway"] });
    assert.deepEqual(rejected, { batch: "batch", kept: ["kept anyway"] });
    const threw = await scoreAndTriage({ score: async () => "batch", triage: () => { throw new Error("down"); }, fallback: [] });
    assert.deepEqual(threw, { batch: "batch", kept: [] });
  });
});
