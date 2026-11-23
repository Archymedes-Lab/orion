import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { aftermath, feltAt, feltBy, horizonDays, paceFor, paceOf, takeaways, withSigns } from "../src/decision-engine/aftermath.ts";
import { DecisionExtractionSchema } from "../src/ai/schemas.ts";
import { followUpPlan } from "../src/decision-engine/followUp.ts";
import { handler } from "../server/index.ts";

const factors = [
  { id: "inc", label: "Income", weight: 0.4 },
  { id: "fr", label: "Friends", weight: 0.3 },
  { id: "cost", label: "Moving cost", weight: 0.2 },
  { id: "gr", label: "Career growth", weight: 0.3 },
];
const option = (id, label, values, confidence = 0.7) => ({
  id, label, reversibility: 0.3,
  outcomes: [{ id: `${id}-o`, label: "base", probability: 1, probabilityConfidence: confidence, factors: Object.entries(values).map(([factorId, value]) => ({ factorId, value })) }],
});
const options = [
  option("berlin", "Take the Berlin job", { inc: 6, fr: -5, cost: -6, gr: 7 }),
  option("stay", "Stay", { inc: 0, fr: 3, cost: 0, gr: -2 }),
];
const base = { options, factors, optionId: "berlin", mode: "serious", stakes: "major", safety: "normal", signal: true };

describe("aftermath", () => {
  it("pictures every check-in and then years beyond, with odds that sum to one", () => {
    const picture = aftermath(base);
    const plan = followUpPlan({ mode: "serious", stakes: "major", decided: true, reversibility: 0.3 });
    assert.deepEqual(picture.steps.map((s) => s.days), [3, 30, 90, 180, 365, 1095, 1825]);
    assert.deepEqual(picture.steps.filter((s) => s.checkIn).map((s) => s.days), plan.map((s) => s.days));
    assert.deepEqual(picture.steps.map((s) => s.when).slice(-3), ["One year", "Three years", "Five years"]);
    assert.deepEqual(picture.steps.map((s) => s.horizon), ["near", "near", "near", "near", "far", "far", "far"]);
    for (const step of picture.steps) {
      const { well, mixed, hard } = step.odds;
      assert.ok(Math.abs(well + mixed + hard - 1) < 1e-9);
      assert.ok(step.featured.length >= 1 && step.featured.length <= 2);
      assert.match(step.sign, /\?$/);
    }
  });

  it("feels costs at once and growth slowly, so a move starts hard and improves", () => {
    assert.equal(paceOf("Moving cost"), "fading");
    assert.equal(paceOf("Commute"), "fast");
    assert.equal(paceOf("Career growth"), "slow");
    assert.equal(feltBy("fast", 0, 3), 1);
    assert.ok(feltBy("slow", 0, 3) < feltBy("slow", 2, 3));
    const [first, , last] = aftermath(base).steps;
    assert.equal(first.featured[0].factorId, "cost");
    assert.ok(first.value < last.value);
    assert.ok(first.odds.hard > last.odds.hard);
    assert.ok(last.odds.well > first.odds.well);
  });

  it("widens with doubt: unsure estimates leave more room for both turns", () => {
    const sure = aftermath(base).steps.at(-1).odds;
    const unsure = aftermath({ ...base, options: [option("berlin", "Take the Berlin job", { inc: 6, fr: -5, cost: -6, gr: 7 }, 0.1), options[1]] }).steps.at(-1).odds;
    assert.ok(unsure.hard >= sure.hard && unsure.well <= sure.well);
  });

  it("looks a season ahead for everyday choices and only days ahead for tiny ones", () => {
    const picture = aftermath({ ...base, mode: "everyday", stakes: "normal" });
    assert.deepEqual(picture.steps.map((s) => s.days), [0, 2, 30, 180]);
    assert.equal(picture.steps[0].when, "Right away");
    assert.deepEqual(picture.steps.map((s) => s.checkIn), [false, true, false, false]);
    assert.deepEqual(horizonDays({ mode: "everyday", stakes: "tiny" }), [0, 2]);
    assert.deepEqual(horizonDays({ mode: "serious", stakes: "significant", reversibility: 0.8 }), [7, 30, 90, 180, 365, 1095]);
  });

  it("plays effects out in real time: strain fades, novelty settles, growth builds, money compounds", () => {
    assert.equal(feltAt("fading", 3), 1);
    assert.ok(feltAt("fading", 365) < 0.35, "the strain of a move is mostly gone a year on");
    assert.ok(feltAt("adapting", 365) < 0.65 && feltAt("adapting", 365) > 0.5, "people adapt to pleasures, not all the way");
    assert.ok(feltAt("slow", 30) < 0.4 && feltAt("slow", 1095) > 0.99);
    assert.ok(feltAt("compounding", 1825) > 1.25, "compounding passes its first estimate after a few years");
    assert.equal(paceOf("Income"), "compounding");
    assert.equal(paceOf("Excitement"), "adapting");
  });

  it("is less sure years out, and keeps the cost in view once it has faded from the news", () => {
    const steps = aftermath(base).steps;
    const width = (s) => s.range[1] - s.range[0];
    for (let i = 1; i < steps.length; i++) assert.ok(width(steps[i]) > width(steps[i - 1]), `${steps[i].when} is wider than ${steps[i - 1].when}`);
    const far = steps.filter((s) => s.horizon === "far");
    for (const s of far) assert.ok(s.featured.some((f) => f.factorId === "fr"), `${s.when} names the cost to friends`);
    assert.match(far.at(-1).likely, /income (?:well past|compounding beyond) the first estimate/);
    assert.match(steps[2].likely, /moving cost starting to ease/);
  });

  it("pulls an unsure estimate towards no difference years out, but leaves the near term as estimated", () => {
    const unsure = aftermath({ ...base, options: [option("berlin", "Take the Berlin job", { inc: 6, fr: -5, cost: -6, gr: 7 }, 0.2), options[1]] }).steps;
    const sure = aftermath(base).steps;
    assert.ok(Math.abs(unsure[0].value - sure[0].value) < 0.05, "the first days are the same");
    assert.ok(unsure.at(-1).value < sure.at(-1).value - 0.5, "a guess fades further out");
    assert.ok(unsure.at(-1).odds.well <= sure.at(-1).odds.well);
  });

  it("lets an easy-to-undo choice cut the bad tail once there has been time to back out", () => {
    const at = (reversibility) => aftermath({ ...base, options: [{ ...options[0], reversibility }, options[1]] }).steps;
    const stuck = at(0), easy = at(1);
    const early = stuck.findIndex((s) => s.days > 30);
    for (let i = 0; i < early; i++) assert.deepEqual(easy[i].odds, stuck[i].odds, `${stuck[i].when}: no exit yet`);
    assert.ok(easy.at(-1).odds.hard < stuck.at(-1).odds.hard);
    assert.ok(easy.at(-1).odds.hard > 0, "backing out is never certain");
    assert.equal(easy.at(-1).odds.well, stuck.at(-1).odds.well, "the cut goes to mixed, not to well");
  });

  it("uses the pace the AI gave a factor, and the label's keywords when it gave none", () => {
    assert.equal(paceFor({ label: "Kids" }), "steady", "no keyword: the default");
    assert.equal(paceFor({ label: "Kids", pace: "slow" }), "slow");
    const rent = [{ id: "rent", label: "Rent", weight: 1, pace: "fast" }];
    const picture = (f) => aftermath({ ...base, factors: f, options: [option("a", "A", { rent: -4 }), option("b", "B", { rent: 0 })], optionId: "a" }).steps;
    const fast = picture(rent), unknown = picture([{ ...rent[0], pace: undefined }]);
    assert.ok(fast[0].contributions[0].felt > 0.99, "a fast cost is felt in full at once");
    assert.ok(unknown[0].contributions[0].felt < 1, "without the AI's pace, Rent falls to the default and builds");
  });

  it("drops an invalid pace from the AI instead of failing the parse", () => {
    const parsed = DecisionExtractionSchema.safeParse({
      title: "t", category: ["Money"], stakes: "normal", missingInformation: [],
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      factors: [{ id: "f", label: "Rent", importance: 1, reason: "r", pace: "sideways" }],
    });
    assert.ok(parsed.success);
    assert.equal(parsed.data.factors[0].pace, undefined);
  });

  it("levels off far out instead of widening for ever", () => {
    const steps = aftermath(base).steps;
    const width = (s) => s.range[1] - s.range[0];
    const year = steps.findIndex((s) => s.days === 365);
    assert.ok(width(steps.at(-1)) - width(steps.at(-2)) < width(steps[year]) - width(steps[year - 1]));
  });

  it("shows nothing for fun choices, crises, dangerous situations or before there is a comparison", () => {
    assert.equal(aftermath({ ...base, mode: "playful" }), null);
    assert.equal(aftermath({ ...base, safety: "crisis" }), null);
    assert.equal(aftermath({ ...base, safety: "dangerous" }), null);
    assert.equal(aftermath({ ...base, signal: false }), null);
    assert.equal(aftermath({ ...base, optionId: "nope" }), null);
  });

  it("adds a caution in high-stakes domains", () => {
    assert.match(aftermath({ ...base, safety: "health-high-stakes" }).caution, /medical professional/);
    assert.equal(aftermath(base).caution, null);
  });

  it("turns each outcome check-in into a question about the early sign due then", () => {
    const picture = aftermath(base);
    const plan = withSigns(followUpPlan({ mode: "serious", stakes: "major", decided: true, reversibility: 0.3 }), picture);
    plan.forEach((step, i) => {
      assert.ok(step.prompt.startsWith(`${picture.steps[i].when} on: `));
      assert.ok(step.prompt.toLowerCase().includes(picture.steps[i].sign.toLowerCase()));
    });
    // An open decision's check-in is untouched.
    const open = followUpPlan({ mode: "serious", stakes: "major", decided: false });
    assert.deepEqual(withSigns(open, picture), open);
  });
});

describe("aftermath takeaways", () => {
  it("says in words what the diagrams draw: the arc, the crossing, the odds and the timing", () => {
    const berlin = aftermath(base);
    const stay = aftermath({ ...base, optionId: "stay" });
    const said = takeaways(berlin, stay);
    assert.match(said.path, /^“Take the Berlin job” dips a little at first, then leaves you clearly better off by year five/);
    assert.match(said.path, /overtakes “Stay”/);
    assert.equal(typeof said.crossing, "number");
    assert.ok(berlin.steps[said.crossing].value > stay.steps[said.crossing].value);
    const last = berlin.steps.at(-1).odds;
    assert.ok(said.odds.includes(`${Math.round(last.well * 100)}% chance it is clearly going well`));
    assert.match(said.timing, /Felt at once, then fades: moving cost\./);
    assert.match(said.timing, /Builds over months: friends and career growth\./);
    assert.match(said.timing, /Keeps compounding for years: income\./);
  });

  it("has no crossing when one option leads all the way", () => {
    const stay = aftermath({ ...base, optionId: "stay" });
    const said = takeaways(stay, null);
    assert.equal(said.crossing, null);
    assert.doesNotMatch(said.path, /overtakes|pulls ahead/);
  });
});

const post = (path, body) => new Promise((resolve, reject) => {
  const request = Readable.from([JSON.stringify(body)]);
  request.method = "POST";
  request.url = path;
  const response = { writeHead(code) { this.status = code; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } };
  // An explicit empty environment: Bun loads .env, and tests must never reach a real provider.
  handler({ env: {} })(request, response).catch(reject);
});

describe("POST /decision/aftermath", () => {
  const request = {
    title: "Berlin or stay", optionId: "berlin", mode: "serious", stakes: "major", safety: "normal",
    options: options.map((o) => ({ ...o, outcomes: o.outcomes.map((oc) => ({ ...oc })) })), factors,
  };

  it("falls back to the app's own wording when no provider is configured", async () => {
    const res = await post("/decision/aftermath", request);
    assert.equal(res.status, 200);
    assert.equal(res.body.steps, null);
    assert.equal(res.body.fallback, true);
  });

  it("never pictures a crisis", async () => {
    const res = await post("/decision/aftermath", { ...request, safety: "crisis" });
    assert.equal(res.body.steps, null);
  });

  it("rejects an option that is not in the decision", async () => {
    const res = await post("/decision/aftermath", { ...request, optionId: "elsewhere" });
    assert.equal(res.status, 400);
  });
});

describe("aftermath wording model", () => {
  it("is told how far each step reaches and how each factor is trending, and words all seven moments", async () => {
    const { aftermathWithAI } = await import("../server/decision-ai.ts");
    const { openaiResponse } = await import("./helpers/ai.js");
    let sent = null;
    const fetchImpl = async (_url, init) => {
      sent = JSON.parse(init.body);
      const steps = JSON.parse(sent.input).steps.map((s, i) => ({ likely: `Step ${i} likely.`, goodTurn: `Good ${i}.`, hardTurn: `Hard ${i}.` }));
      return openaiResponse({ steps });
    };
    const result = await aftermathWithAI({ ...base, title: "Berlin or stay" }, { env: { OPENAI_API_KEY: "test" }, fetchImpl });
    const input = JSON.parse(sent.input);
    assert.equal(result.steps.length, 7);
    assert.deepEqual(input.steps.map((s) => s.daysAfter), [3, 30, 90, 180, 365, 1095, 1825]);
    assert.equal(input.steps.at(-1).horizon, "far");
    assert.ok(input.steps.at(-1).shows.some((f) => f.trend === "compounding past the first estimate"));
    assert.ok(input.steps[2].shows.some((f) => f.trend === "easing"));
    assert.match(sent.instructions, /SEEING FAR AHEAD/);
  });
});

describe("spread calibration", async () => {
  const { calibrate } = await import("../src/decision-engine/spreadCalibration.ts");
  const picture = (spread) => aftermath({ ...base, spread }).steps.at(-1).odds;
  it("stays at 1 with no outcomes, and barely moves on a few", () => {
    assert.equal(calibrate([]).spread, 1);
    const few = calibrate([{ zone: "hard", predict: picture }, { zone: "well", predict: picture }]);
    assert.ok(few.spread >= 0.8 && few.spread <= 1.3);
  });
  it("widens when outcomes keep landing in the clear zones, narrows when they keep landing in between", () => {
    const extreme = Array.from({ length: 40 }, (_, i) => ({ zone: i % 2 ? "hard" : "well", predict: picture }));
    const middling = Array.from({ length: 40 }, () => ({ zone: "mixed", predict: picture }));
    const wide = calibrate(extreme), narrow = calibrate(middling);
    assert.ok(wide.spread > 1 && narrow.spread < 1);
    assert.ok(wide.brierAfter <= wide.brierBefore && narrow.brierAfter <= narrow.brierBefore);
  });
  it("only changes the spread: the net effect at every step is the same", () => {
    const a = aftermath(base).steps, b = aftermath({ ...base, spread: 1.6 }).steps;
    a.forEach((s, i) => assert.equal(s.value, b[i].value));
  });
});
