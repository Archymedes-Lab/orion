// The "brain": is it a decision, how much ceremony does it deserve, and what is ORION's call.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decisionMode, questionBudgetForMode, readIntent } from "../src/decision-engine/mode.ts";
import { makeTheCall, seededIndex } from "../src/decision-engine/call.ts";
import { followUpPlan } from "../src/decision-engine/followUp.ts";
import { ALL_TEMPLATES, templateOptions } from "../src/decision-engine/templates.ts";
import { shouldWelcome } from "../src/account/gate.ts";

const option = (id, values, confidence = 0.9) => ({
  id, label: id.toUpperCase(), reversibility: 0.8,
  outcomes: [{ id: `${id}-o`, label: id, probability: 1, probabilityConfidence: confidence, factors: Object.entries(values).map(([factorId, value]) => ({ factorId, value })) }],
});
const factors = [{ id: "x", label: "Craving", weight: 0.7 }, { id: "y", label: "Cost", weight: 0.3 }];

describe("reading the input", () => {
  it("recognises decisions, including vague ones", () => {
    for (const t of ["Should I cook or order food?", "pizza or tacos", "What should I do about my job?", "not sure what to do about dinner",
      "Is it worth upgrading my laptop", "Thinking about moving to Lisbon", "which movie tonight"]) {
      assert.equal(readIntent(t).kind, "decision", t);
    }
  });
  it("does not compare greetings, facts, or a single word", () => {
    assert.equal(readIntent("hi").kind, "greeting");
    assert.equal(readIntent("Hello ORION!").kind, "greeting");
    assert.equal(readIntent("What is the capital of France?").kind, "fact-question");
    assert.equal(readIntent("How many legs does a spider have").kind, "fact-question");
    assert.equal(readIntent("pizza").kind, "too-short");
    for (const t of ["hi", "pizza", "What is the capital of France?"]) assert.ok(readIntent(t).message.length > 0);
  });
});

describe("decision mode", () => {
  it("treats fun, light choices as playful", () => {
    for (const t of ["Pizza or tacos tonight?", "Which movie should we watch?", "Red shirt or blue shirt?", "Cats or dogs lol", "🍕 or 🌮?"]) {
      assert.equal(decisionMode({ text: t, stakes: "tiny", safety: "normal" }), "playful", t);
    }
  });
  it("never treats a weighty subject as a game", () => {
    assert.equal(decisionMode({ text: "Pizza party or save for my mortgage?", stakes: "tiny", safety: "normal" }), "everyday");
    assert.equal(decisionMode({ text: "Wear the suit to the job interview?", stakes: "normal", safety: "normal" }), "everyday");
  });
  it("makes stakes and safety domains serious whatever the wording", () => {
    assert.equal(decisionMode({ text: "Pizza or tacos?", stakes: "significant", safety: "normal" }), "serious");
    assert.equal(decisionMode({ text: "Take the loan?", stakes: "normal", safety: "financial-high-stakes" }), "serious");
    assert.equal(decisionMode({ text: "Gym before work or tonight?", stakes: "normal", safety: "normal" }), "everyday");
  });
  it("sizes the interview to the mode", () => {
    assert.equal(questionBudgetForMode("playful", "normal"), 0);
    assert.equal(questionBudgetForMode("everyday", "tiny"), 1);
    assert.equal(questionBudgetForMode("everyday", "normal"), 1);
    assert.equal(questionBudgetForMode("serious", "normal"), 2);
  });
});

describe("ORION's call", () => {
  it("is decisive when the lead is clear", () => {
    const call = makeTheCall({ options: [option("a", { x: 8, y: 2 }), option("b", { x: -6, y: 0 })], factors, mode: "everyday", signal: true, seed: "s", drivers: [{ label: "Craving", impact: 5 }] });
    assert.equal(call.kind, "clear");
    assert.equal(call.optionId, "a");
    assert.equal(call.headline, "Go with A.");
    assert.match(call.line, /craving/);
  });
  it("still picks, honestly labelled, when it is close", () => {
    const call = makeTheCall({ options: [option("a", { x: 1, y: 0 }), option("b", { x: 0.8, y: 0 })], factors, mode: "playful", signal: true, seed: "s" });
    assert.equal(call.kind, "lean");
    assert.equal(call.optionId, "a");
  });
  it("flips a coin for a fun or everyday tie, and says so", () => {
    const opts = [option("a", { x: 0, y: 0 }), option("b", { x: 0, y: 0 })];
    const call = makeTheCall({ options: opts, factors, mode: "playful", signal: false, seed: "dec:0" });
    assert.equal(call.kind, "coin");
    assert.match(call.line, /coin|toss-up/i);
    // The same seed lands the same way; different flips can land differently.
    assert.equal(makeTheCall({ options: opts, factors, mode: "playful", signal: false, seed: "dec:0" }).optionId, call.optionId);
    const landed = new Set(Array.from({ length: 20 }, (_, i) => makeTheCall({ options: opts, factors, mode: "everyday", signal: false, seed: `dec:${i}` }).optionId));
    assert.equal(landed.size, 2);
  });
  it("never settles a serious decision with a coin", () => {
    const opts = [option("a", { x: 0, y: 0 }), option("b", { x: 0, y: 0 })];
    assert.equal(makeTheCall({ options: opts, factors, mode: "serious", signal: false, seed: "s" }), null);
    assert.equal(makeTheCall({ options: opts, factors, mode: "serious", signal: true, seed: "s" }), null);
  });
  it("hashes deterministically within range", () => {
    for (let i = 0; i < 50; i++) { const n = seededIndex(`k${i}`, 3); assert.ok(n >= 0 && n < 3); }
    assert.equal(seededIndex("same", 4), seededIndex("same", 4));
  });
});

describe("follow-up plan", () => {
  it("leaves fun choices alone and checks back on the rest", () => {
    assert.deepEqual(followUpPlan({ mode: "playful", stakes: "tiny", decided: true }), []);
    assert.deepEqual(followUpPlan({ mode: "everyday", stakes: "normal", decided: true }).map((s) => s.days), [2]);
    assert.deepEqual(followUpPlan({ mode: "serious", stakes: "significant", decided: true }).map((s) => s.days), [7, 30, 180, 365]);
    assert.deepEqual(followUpPlan({ mode: "serious", stakes: "major", decided: true }).map((s) => s.days), [7, 30, 90, 180, 365]);
    assert.equal(followUpPlan({ mode: "serious", stakes: "major", decided: true, reversibility: 0.2 })[0].days, 3, "hard to undo: check early");
  });
  it("nudges an unfinished decision", () => {
    const [step] = followUpPlan({ mode: "everyday", stakes: "normal", decided: false });
    assert.equal(step.kind, "open");
    assert.equal(step.days, 1);
  });
});

describe("templates", () => {
  it("are complete and valid", () => {
    const ids = new Set();
    for (const t of ALL_TEMPLATES) {
      assert.ok(!ids.has(t.id)); ids.add(t.id);
      assert.ok(t.options.length >= 2 && t.options.length <= 4, t.id);
      assert.ok(t.factors.length >= 1 && t.factors.length <= 8, t.id);
      assert.ok(t.factors.every((f) => f.label.length <= 40 && f.importance > 0 && f.importance <= 1), t.id);
      assert.ok(t.question(["A", "B"]).length > 3);
    }
  });
  it("need two different option names", () => {
    assert.equal(templateOptions(["Pizza", " pizza ", ""]), null);
    assert.deepEqual(templateOptions(["Pizza", "Tacos", "", "Sushi", "Ramen", "Pho"]), ["Pizza", "Tacos", "Sushi", "Ramen"]);
  });
});

describe("welcome gate", () => {
  it("shows once, signed out, and never in front of a friend's link or the legal pages", () => {
    assert.equal(shouldWelcome({ pathname: "/", ready: true, signedIn: false, guest: false }), true);
    assert.equal(shouldWelcome({ pathname: "/", ready: false, signedIn: false, guest: false }), false);
    assert.equal(shouldWelcome({ pathname: "/", ready: true, signedIn: true, guest: false }), false);
    assert.equal(shouldWelcome({ pathname: "/", ready: true, signedIn: false, guest: true }), false);
    for (const p of ["/account", "/terms", "/privacy", "/s/abcdefghijklmnop"]) assert.equal(shouldWelcome({ pathname: p, ready: true, signedIn: false, guest: false }), false, p);
  });
});
