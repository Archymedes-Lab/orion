// The web app's side of new paths and priorities (web/lib/creative.ts): deciding on the person's current weights,
// adding a path to the comparison, and the wording of built-in limits and approach types.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addPath, creativeView, limitLabel } from "../web/lib/creative.ts";
import { view } from "../web/lib/decide.ts";
import { withLocale } from "../src/i18n/index.ts";
import { forAll } from "./helpers/property.js";

const sure = (k) => [0, 1, 2, 3, 4].map((i) => (i === k ? 0.92 : 0.02));
function fixture() {
  const run = {
    id: "r1", createdAt: 0, question: "Berlin or Kigali?", lens: "personal", title: "Berlin or Kigali", category: ["Career"], stakes: "major", safety: "normal",
    mode: "serious", source: "ai", notice: null, offline: false,
    options: [{ id: "go", label: "Take the Berlin job" }, { id: "stay", label: "Stay" }],
    factors: [{ id: "pay", label: "Pay", weight: 0.5 }, { id: "family", label: "Family", weight: 0.5 }],
    scores: [
      { optionId: "go", factorId: "pay", value: 8, probabilityConfidence: 0.8 }, { optionId: "go", factorId: "family", value: -8, probabilityConfidence: 0.8 },
      { optionId: "stay", factorId: "pay", value: -2, probabilityConfidence: 0.8 }, { optionId: "stay", factorId: "family", value: 6, probabilityConfidence: 0.8 },
    ],
    scenarios: null, duels: {}, chosen: null,
  };
  const j = (optionId, pay, family, extra = {}) => ({ optionId, dims: { pay: sure(pay), family: sure(family) }, violations: { harm: 0.02, law: 0.02, stretch: 0.1 }, novelty: sure(0), niche: { direct: 0.9, staged: 0.1 }, ...extra });
  const data = {
    paths: [
      { id: "path_1", label: "Remote trial first", description: "A quarter from Kigali.", check: "Ask HR.", niche: "staged" },
      { id: "path_2", label: "Lie to the landlord", description: "Break the lease.", check: "Ask a lawyer.", niche: "other" },
    ],
    niches: { direct: "Do it yourself, head on", staged: "Try a small, reversible version first" },
    limits: [{ id: "harm", label: "x", hard: true }, { id: "law", label: "x", hard: true }, { id: "stretch", label: "x", hard: false }],
    baselineId: "stay",
    judgments: [
      j("go", 4, 0), j("stay", 1, 3, { baseline: true }),
      j("path_1", 3, 3, { novelty: sure(4), niche: { direct: 0.1, staged: 0.9 }, violations: { harm: 0.02, law: 0.4, stretch: 0.1 } }),
      j("path_2", 4, 4, { violations: { harm: 0.02, law: 0.95, stretch: 0 } }),
    ],
    judge: "typesafe",
  };
  return { run, data };
}

describe("creativeView", () => {
  it("labels the rows, gates the dishonest path out and the uncertain one to check first", () => {
    const { run, data } = fixture();
    const v = creativeView(run, data);
    const row = (id) => v.rows.find((r) => r.id === id);
    assert.equal(v.rows.length, 4);
    assert.equal(row("path_2").status, "reject");
    assert.equal(row("path_1").status, "verify");
    assert.deepEqual(row("path_1").checks, ["law"]);
    assert.equal(row("path_1").check, "Ask HR.");
    assert.equal(row("stay").baseline, true);
    assert.equal(row("go").listed, true);
    assert.equal(row("path_1").listed, false);
    assert.equal(row("path_1").niche, "Small trial first");
    assert.ok(v.rows.every((r, i) => i === 0 || v.rows[i - 1].score >= r.score), "sorted by score");
    assert.ok(v.rows.every((r) => r.score >= 0 && r.score <= 100));
  });
  it("re-ranks when the person changes the weights, with no new request", () => {
    const { run, data } = fixture();
    const payFirst = creativeView({ ...run, factors: [{ id: "pay", label: "Pay", weight: 0.95 }, { id: "family", label: "Family", weight: 0.05 }] }, data);
    const familyFirst = creativeView({ ...run, factors: [{ id: "pay", label: "Pay", weight: 0.05 }, { id: "family", label: "Family", weight: 0.95 }] }, data);
    assert.equal(payFirst.commit, "go");
    assert.notEqual(familyFirst.commit, "go");
  });
  it("ignores a factor the beliefs don't cover (added after the paths were found)", () => {
    const { run, data } = fixture();
    const v = creativeView({ ...run, factors: [...run.factors, { id: "new", label: "Weather", weight: 0.3 }] }, data);
    assert.equal(v.rows.length, 4);
  });
  it("holds on random weights: a commit, a bold bet that isn't the commit, scores in range", () => forAll(80, (r) => {
    const { run, data } = fixture();
    const v = creativeView({ ...run, factors: run.factors.map((f) => ({ ...f, weight: r.float(0, 1) })) }, data);
    assert.ok(v.commit === null || v.rows.some((x) => x.id === v.commit));
    if (v.innovation) assert.notEqual(v.innovation, v.commit);
    assert.ok(v.evpi >= 0);
    assert.notEqual(v.commit, "path_2");
  }));
});

describe("addPath", () => {
  it("adds the path with scores from the same beliefs, once, and the main verdict ranks it", () => {
    const { run, data } = fixture();
    const next = addPath(run, data, "path_1");
    assert.equal(next.options.length, 3);
    assert.deepEqual(next.options.at(-1), { id: "path_1", label: "Remote trial first", generated: true, path: true });
    assert.deepEqual(next.scores.filter((s) => s.optionId === "path_1").map((s) => s.factorId), ["pay", "family"]);
    assert.equal(addPath(next, data, "path_1"), next, "adding twice changes nothing");
    assert.ok(view(next).ranked.some((r) => r.id === "path_1"));
    assert.equal(creativeView(next, data).rows.find((r) => r.id === "path_1").added, true);
  });
  it("leaves the run alone for an unknown path or a run without scores", () => {
    const { run, data } = fixture();
    assert.equal(addPath(run, data, "nope"), run);
    const unscored = { ...run, scores: null };
    assert.equal(addPath(unscored, data, "path_1"), unscored);
  });
  it("a path the person added is not sent back as a listed option", () => {
    const { run, data } = fixture();
    const next = addPath(run, data, "path_1");
    assert.equal(creativeView(next, data).rows.find((r) => r.id === "path_1").listed, false);
  });
});

describe("wording", () => {
  it("built-in limits are worded in the reader's language; the decision's own come as they are", () => {
    const { data } = fixture();
    assert.equal(limitLabel(data, "law"), "Breaking the law or misleading someone");
    assert.match(withLocale("ko", () => limitLabel(data, "law")), /[가-힣]/);
    assert.equal(limitLabel({ ...data, limits: [...data.limits, { id: "own_1", label: "5천 유로 예산", hard: true }] }, "own_1"), "5천 유로 예산");
  });
});
