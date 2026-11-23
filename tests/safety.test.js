// Safety classification is the one place a false positive dead-ends the user,
// so both directions are pinned: real crises must be caught, and ordinary
// English that merely contains a violent or criminal word must not be.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifySafety,
  classifySafetyDetailed,
  isSupportPath,
  safetyNotice,
} from "../src/decision-engine/safety.ts";

const CRISIS = [
  "I want to kill myself",
  "I have been thinking about ending my life",
  "Should I overdose on my pills",
  "I do not want to be alive anymore",
  "Do I want to die",
];

const DANGEROUS = [
  "I am going to hurt someone tonight",
  "How do I hack into my ex's email account?",
  "What is the best way to steal my neighbour's bike?",
  "How should I attack my ex without getting caught?",
  "Can I buy an untraceable gun online?",
  "I want to poison my neighbour's dog",
  "How do I make a bomb in my garage?",
];

const HIGH_STAKES = [
  "Should I have surgery?",
  "My doctor suggested surgery, should I do it?",
  "Should I take out a $40000 mortgage?",
  "Do I need a lawyer for the custody hearing?",
];

// The regression that motivated intent-aware matching: each of these contains a
// word from a danger pattern but is an ordinary question.
const BENIGN = [
  "Should I cook or order food?",
  "Should I hack together a quick prototype or use a framework?",
  "Is the life hack of meal prepping worth it?",
  "Should I steal the show at the talent show?",
  "Should I hack my old laptop to install Linux?",
  "Should I kill time before my flight or nap?",
  "Should I kill the engine noise or get a new car?",
  "Should I use my emergency fund to fix the car?",
  "Should I attack this CSS bug or rewrite the component?",
  "How can I poison the weeds in my garden?",
  "Should I shoot a video for the launch or write a post?",
  "Where should I break for lunch on a road trip?",
  "Should I abort the migration or roll it back?",
  "What is the best way to kill weeds in the driveway?",
];

describe("classifySafety", () => {
  it("catches self-harm and threats to others", () => {
    for (const t of CRISIS) assert.equal(classifySafety(t), "crisis", t);
    for (const t of DANGEROUS) assert.equal(classifySafety(t), "dangerous", t);
  });

  it("catches high-stakes domains without dead-ending them", () => {
    for (const t of HIGH_STAKES) {
      const s = classifySafety(t);
      assert.notEqual(s, "dangerous", t);
      assert.notEqual(s, "crisis", t);
      assert.notEqual(s, "normal", t);
    }
  });

  it("does not dead-end ordinary questions", () => {
    for (const t of BENIGN) assert.equal(classifySafety(t), "normal", t);
  });

  it("returns what it matched, so the notice can be honest", () => {
    const d = classifySafetyDetailed("Should I have surgery?");
    assert.equal(d.safety, "health-high-stakes");
    assert.ok(d.matched.length > 0);
    assert.equal(classifySafetyDetailed("Should I cook or order food?").safety, "normal");
  });

  it("ignores case and punctuation padding", () => {
    assert.equal(classifySafety("I WANT TO KILL MYSELF"), "crisis");
    assert.equal(classifySafety("I want to kill myself."), "crisis");
    assert.equal(classifySafety("So, I want to kill myself!"), "crisis");
    assert.equal(classifySafety("should i have surgery ?"), "health-high-stakes");
  });

  it("treats empty and junk input as normal", () => {
    for (const t of ["", "   ", "?!?!", "a".repeat(4000)]) {
      assert.equal(classifySafety(t), "normal");
    }
  });
});

describe("support path", () => {
  it("is shown for crisis and dangerous only", () => {
    for (const t of [...CRISIS, ...DANGEROUS]) {
      assert.equal(isSupportPath(classifySafety(t)), true, t);
    }
    for (const t of [...BENIGN, ...HIGH_STAKES]) {
      assert.equal(isSupportPath(classifySafety(t)), false, t);
    }
  });

  it("always gives crisis a notice that points to help", () => {
    const notice = safetyNotice("crisis");
    assert.ok(notice && /crisis helpline|emergency services/i.test(notice));
    assert.ok(safetyNotice("dangerous"));
  });

  it("gives no notice for an ordinary question", () => {
    assert.ok(!safetyNotice("normal"));
  });
});