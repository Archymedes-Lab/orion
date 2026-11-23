import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { useSession } from "../src/store/session.ts";
import { db } from "../src/db/database.ts";
import { getCalibration, latestRatings, toneOf } from "../src/db/insights.ts";

beforeEach(async () => {
  useSession.setState({ privateMode: false });
  useSession.getState().reset();
  await db.init();
  for (const table of ["decisions", "decision_metadata", "options", "factors", "option_factor_values", "questions", "user_preferences", "decision_outcomes", "decision_choices"]) {
    await db.clearTable(table);
  }
});

let tick = 0;
/** Saves a decision where option 0 leads (or ties), chooses `pick`, and rates it. */
async function decide({ pick, rating, tie = false }) {
  await useSession.getState().submit("Should I cook or order food?");
  let s = useSession.getState();
  assert.equal(s.setManualScores(s.options.flatMap((o, i) => s.factors.map((f) => ({
    optionId: o.id, factorId: f.id, value: tie ? 3 : i === 0 ? 6 : -2, probabilityConfidence: 0.5,
  })))), true);
  s = useSession.getState();
  await s.commit(pick === null ? null : s.options[pick].id);
  if (rating) {
    await db.insert("decision_outcomes", { id: `out_${++tick}`, decision_id: s.decisionId, rating, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString() });
  }
  return s.decisionId;
}

describe("outcome calibration", () => {
  it("splits rated choices by whether they followed the leading option", async () => {
    await decide({ pick: 0, rating: "Great" });
    await decide({ pick: 0, rating: "Bad" });
    await decide({ pick: 1, rating: "Neutral" });
    assert.deepEqual(await getCalibration(), {
      followed: { well: 1, neutral: 0, badly: 1 },
      tossup: { well: 0, neutral: 0, badly: 0 },
      diverged: { well: 0, neutral: 1, badly: 0 },
      reasons: { unsaid: { well: 0, neutral: 1, badly: 0 } },
    });
  });
  it("leaves out ties, undecided and unrated decisions", async () => {
    await decide({ pick: 0, rating: "Good", tie: true });
    await decide({ pick: null, rating: "Good" });
    await decide({ pick: 0, rating: null });
    assert.deepEqual(await getCalibration(), {
      followed: { well: 0, neutral: 0, badly: 0 },
      tossup: { well: 0, neutral: 0, badly: 0 },
      diverged: { well: 0, neutral: 0, badly: 0 },
      reasons: {},
    });
  });
  it("counts only the latest rating for a decision", async () => {
    const id = await decide({ pick: 0, rating: "Very bad" });
    await db.insert("decision_outcomes", { id: `out_${++tick}`, decision_id: id, rating: "Good", created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString() });
    assert.equal((await latestRatings())[id], "Good");
    assert.deepEqual((await getCalibration()).followed, { well: 1, neutral: 0, badly: 0 });
  });
  it("maps ratings to tones and ignores unknown values", () => {
    assert.deepEqual(["Great", "Good", "Neutral", "Bad", "Very bad", "?", undefined].map(toneOf),
      ["well", "well", "neutral", "badly", "badly", null, null]);
  });
});

describe("how choices against the comparison turn out", () => {
  it("separates toss-ups from real divergence and groups divergence by the reason given", async () => {
    // A toss-up: half a point apart.
    await useSession.getState().submit("Should I cook or order food?");
    let s = useSession.getState();
    s.setManualScores(s.options.flatMap((o, i) => s.factors.map((f) => ({ optionId: o.id, factorId: f.id, value: i === 0 ? 3 : 2.5, probabilityConfidence: 0.5 }))));
    s = useSession.getState();
    await s.commit(s.options[1].id);
    await db.insert("decision_outcomes", { id: `out_${++tick}`, decision_id: s.decisionId, rating: "Good", created_at: "2026-02-01" });
    // A deliberate choice against a clear leader.
    const id = await decide({ pick: 1, rating: null });
    await useSession.getState().explainChoice("deliberate");
    await db.insert("decision_outcomes", { id: `out_${++tick}`, decision_id: id, rating: "Great", created_at: "2026-02-02" });
    const calibration = await getCalibration();
    assert.deepEqual(calibration.tossup, { well: 1, neutral: 0, badly: 0 });
    assert.deepEqual(calibration.diverged, { well: 1, neutral: 0, badly: 0 });
    assert.deepEqual(calibration.reasons, { deliberate: { well: 1, neutral: 0, badly: 0 } });
  });
});
