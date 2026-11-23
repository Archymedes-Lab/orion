import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLocally } from "../src/ai/extractDecision.ts";
import { DecisionExtractionSchema } from "../src/ai/schemas.ts";
import { EXAMPLES, BUSINESS_EXAMPLES, shuffleExamples } from "../src/components/examples.ts";
import { useSession, isGenericFallback } from "../src/store/session.ts";
import { db } from "../src/db/database.ts";

beforeEach(async () => {
  useSession.setState({ privateMode: false });
  useSession.getState().reset();
  await db.init();
  for (const table of ["decisions", "decision_metadata", "options", "factors", "option_factor_values", "questions", "user_preferences", "decision_outcomes", "decision_choices"]) {
    await db.clearTable(table);
  }
});

const checkPool = (pool, name) => {
  const questions = pool.map((e) => e.question);
  assert.equal(new Set(questions).size, questions.length, `${name}: questions unique`);
  for (const e of pool) {
    assert.ok(e.question.trim().length > 0, `${name}: question non-empty`);
    assert.ok(e.options.length >= 2 && e.options.length <= 4, `${name}: 2-4 preview options: ${e.question}`);
    assert.equal(new Set(e.options.map((o) => o.toLowerCase())).size, e.options.length, `${name}: preview options unique: ${e.question}`);
    assert.ok(e.areas.length >= 1, `${name}: at least one area: ${e.question}`);
  }
  const first3 = pool.slice(0, 3);
  assert.ok(first3.some((e) => e.named) && first3.some((e) => !e.named), `${name}: first paint mixes both kinds`);
};

describe("example pools say both ways in", () => {
  it("personal pool mixes named and situation-only questions", () => {
    assert.equal(EXAMPLES.length, 15);
    assert.equal(EXAMPLES.filter((e) => e.named).length, 9);
    assert.equal(EXAMPLES.filter((e) => !e.named).length, 6);
    checkPool(EXAMPLES, "personal");
  });
  it("business pool mixes named and situation-only questions", () => {
    assert.equal(BUSINESS_EXAMPLES.length, 10);
    assert.equal(BUSINESS_EXAMPLES.filter((e) => e.named).length, 6);
    assert.equal(BUSINESS_EXAMPLES.filter((e) => !e.named).length, 4);
    checkPool(BUSINESS_EXAMPLES, "business");
  });
  it("shuffle keeps every example once and always leads with both kinds", () => {
    for (const pool of [EXAMPLES, BUSINESS_EXAMPLES]) {
      for (let i = 0; i < 200; i++) {
        const out = shuffleExamples(pool);
        assert.equal(out.length, pool.length);
        assert.deepEqual([...out].sort((a, b) => a.question.localeCompare(b.question)).map((e) => e.question),
          [...pool].sort((a, b) => a.question.localeCompare(b.question)).map((e) => e.question));
        const lead = out.slice(0, 3);
        assert.ok(lead.some((e) => e.named) && lead.some((e) => !e.named), "lead mixes both kinds");
      }
    }
  });
});

describe("offline parser marks its own suggestions", () => {
  it("never mixes named and suggested options, and stays in bounds", () => {
    const inputs = [
      "Cook at home or order food tonight?",
      "Stay in my job or take the offer?",
      "Tea or coffee or juice or water or milk?",
      "Tea or tea or coffee?",
      "Should I go out tonight?",
      "Should I buy this or not?",
      "Should I move to Berlin, where rent is high, or stay?",
      "My rent is going up 20% next month.",
      "I have a free Saturday and no plans.",
      "I have 500k but my mom needs money and I also need to pay school fees",
      "I can't keep up with work and my family needs more of my time.",
    ];
    for (const q of inputs) {
      const e = parseLocally(q);
      assert.ok(e.options.length >= 2 && e.options.length <= 4, q);
      assert.equal(new Set(e.options.map((o) => o.label.toLowerCase())).size, e.options.length, `unique: ${q}`);
      for (const o of e.options) assert.ok(o.label.length >= 1 && o.label.length <= 80, `label bounds: ${q}`);
      const gens = e.options.map((o) => Boolean(o.generated));
      assert.ok(gens.every((g) => g === gens[0]), `generated is all-or-nothing: ${q}`);
    }
  });
  it("fuzz: random word salad never breaks the option invariants", () => {
    const toks = ["or", "and", "but", "rent", "job", "money", "should I", "Berlin, where rent is high"];
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 2000; i++) {
      const n = 1 + Math.floor(rnd() * 6);
      const q = Array.from({ length: n }, () => toks[Math.floor(rnd() * toks.length)]).join(" ");
      const e = parseLocally(q);
      assert.ok(e.options.length >= 2 && e.options.length <= 4, q);
      assert.equal(new Set(e.options.map((o) => o.label.toLowerCase())).size, e.options.length, `unique: ${q}`);
      const gens = e.options.map((o) => Boolean(o.generated));
      assert.ok(gens.every((g) => g === gens[0]), `all-or-nothing: ${q}`);
    }
  });
  it("the validated schema keeps the generated flag", () => {
    const e = parseLocally("I have 500k but my mom needs money and I also need to pay school fees");
    assert.ok(e.options.some((o) => o.generated), "offline parser marks its suggestions");
    const parsed = DecisionExtractionSchema.parse({
      ...e, options: e.options.map((o) => ({ id: o.id, label: o.label, description: o.description, generated: o.generated })),
    });
    assert.deepEqual(parsed.options.map((o) => Boolean(o.generated)), e.options.map((o) => Boolean(o.generated)));
  });
});

describe("loading preview and result copy agree on who named the options", () => {
  it("named question: preview lists them and says Comparing", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    const s = useSession.getState();
    assert.deepEqual(s.preview, { options: s.extraction.options.map((o) => o.label), suggested: false });
    assert.equal(s.extraction.options.some((o) => o.generated), false);
    assert.equal(isGenericFallback(s.options), false);
  });
  it("vague question: no preview of a generic pair; the editor asks instead", async () => {
    await useSession.getState().submit("My rent is going up 20% next month.");
    const s = useSession.getState();
    assert.equal(s.preview, null);
    assert.equal(isGenericFallback(s.options), true);
  });
  it("suggested options: preview flags them so the loading line can say so", async () => {
    await useSession.getState().submit("I have 500k but my mom needs money and I also need to pay school fees");
    const s = useSession.getState();
    assert.ok(s.extraction.options.some((o) => o.generated));
    assert.equal(s.preview?.suggested, true);
    assert.deepEqual(s.preview?.options, s.extraction.options.map((o) => o.label));
    assert.equal(isGenericFallback(s.options), false);
  });
  it("correcting the options shows them while it re-scores", async () => {
    await useSession.getState().submit("What should I do about dinner?");
    const run = useSession.getState().refine(["Cook at home", "Order food"], ["Cost", "Time"]);
    assert.deepEqual(useSession.getState().preview, { options: ["Cook at home", "Order food"], suggested: false });
    assert.equal(await run, true);
    assert.equal(isGenericFallback(useSession.getState().options), false);
  });
});
