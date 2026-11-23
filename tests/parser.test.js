import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLocally } from "../src/ai/extractDecision.ts";
import { generateQuestions } from "../src/ai/generateQuestions.ts";

const labels = (input) => parseLocally(input).options.map((o) => o.label);

describe("offline option splitting", () => {
  it("splits a three-way comma list", () => {
    assert.deepEqual(labels("Walk, take the bus or call a taxi?"), ["Walk", "Take the bus", "Call a taxi"]);
  });
  it("keeps a trailing clause inside its option", () => {
    assert.deepEqual(labels("Should I move to Berlin, where rent is high, or stay?"), ["Move to Berlin, where rent is high", "Stay"]);
  });
  it("turns a yes/no question into the action and its refusal", () => {
    assert.deepEqual(labels("Should I go out tonight?"), ["Go out tonight", "Don't go out tonight"]);
    assert.deepEqual(labels("Should I buy this or not?"), ["Buy this", "Don't buy this"]);
  });
  it("reads between/and, and caps at four distinct options", () => {
    assert.deepEqual(labels("I can't decide between the Honda and the Toyota"), ["The Honda", "The Toyota"]);
    assert.deepEqual(labels("Tea or coffee or juice or water or milk?"), ["Tea", "Coffee", "Juice", "Water"]);
    assert.deepEqual(labels("Tea or tea or coffee?"), ["Tea", "Coffee"]);
  });
  it("falls back to do it / don't when no alternative is named", () => {
    assert.deepEqual(labels("Thinking about quitting my job"), ["Do it", "Don't do it"]);
  });
});

describe("offline titles, categories and stakes", () => {
  it("keeps the whole question as the title and never cuts mid-word", () => {
    assert.equal(parseLocally("Should I take the job in Berlin or stay at my current company?").title,
      "Should I take the job in Berlin or stay at my current company");
    const long = parseLocally(`Should I ${"accept the relocation offer ".repeat(8)}or stay?`).title;
    assert.ok(long.length <= 120 && long.endsWith("…") && !/\s…$/.test(long));
    assert.match(long, /(accept|the|relocation|offer)…$/);
  });
  it("matches whole-word prefixes, so 'current' is not rent", () => {
    assert.deepEqual(parseLocally("Should I stay at my current place or go?").category, ["Everyday"]);
    assert.equal(parseLocally("Work now or focus later?").category[0], "Work");
    assert.equal(parseLocally("Accept this offer or keep looking?").category[0], "Career");
  });
  it("checks major stakes before significant ones", () => {
    assert.equal(parseLocally("Should I start my company?").stakes, "major");
    assert.equal(parseLocally("Should I quit my job?").stakes, "significant");
  });
});

describe("follow-up questions", () => {
  it("only ask which of the decision's own factors matters most", () => {
    const e = parseLocally("Should I take the job in Berlin or stay at my current company?");
    const questions = generateQuestions(e, 0);
    assert.equal(questions.length, 3);
    for (const q of questions) {
      for (const f of e.factors) assert.ok(q.question.includes(f.label.toLowerCase()), `${q.question} omits ${f.label}`);
    }
    assert.equal(new Set(questions.map((q) => q.question)).size, 3);
  });
  it("puts model-supplied questions first and respects the stakes budget", () => {
    const e = { ...parseLocally("Coffee here or on the way?"), missingInformation: [{ question: "Which matters most: cost or time?", expectedInformationGain: 0.9 }] };
    assert.deepEqual(generateQuestions(e, 0).map((q) => q.question), ["Which matters most: cost or time?"]);
  });
  it("asks nothing when there is a single factor to choose from", () => {
    assert.deepEqual(generateQuestions({ stakes: "major", factors: [{ label: "Cost" }], missingInformation: [] }, 0), []);
  });
});
