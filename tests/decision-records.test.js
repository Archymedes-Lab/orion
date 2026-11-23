// Round-trip: a decision that is made is remembered as a durable record, reads
// back after a relaunch, and the check-in / outcome edits a person adds later
// come back re-readable — so the deep-dive surface recomputes from memory.
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { useSession } from "../src/store/session.ts";
import { db } from "../src/db/database.ts";
import { TABLES } from "../src/db/decisions.ts";
import { loadDecisionRecord, updateDecisionRecord } from "../src/db/decisionRecords.ts";
import { recordCheckIn, recordOutcome, scoreDecisionQuality } from "../src/decision-engine/checkIns.ts";

beforeEach(async () => {
  useSession.setState({ privateMode: false });
  useSession.getState().reset();
  await db.init();
  for (const table of TABLES) await db.clearTable(table);
});

const rate = (s, lead) => s.options.flatMap((o, i) => s.factors.map((f) => ({ optionId: o.id, factorId: f.id, value: i === lead ? 6 : -3, probabilityConfidence: 0.7 })));

describe("decision memory round-trip", () => {
  it("writes a record only when a decision is made, and reads it back after a relaunch", async () => {
    await useSession.getState().submit("Should I take the job offer or stay?");
    const s = useSession.getState();
    assert.equal(s.mode, "serious");
    assert.equal(s.setManualScores(rate(s, 0)), true);
    await useSession.getState().commit(s.options[0].id);
    const id = useSession.getState().decisionId;

    const rows = (await db.list("decision_records")).filter((r) => r.id === id);
    assert.equal(rows.length, 1, "a decision record is written on commit");

    // Relaunch: a fresh session reads the decision back, and the record with it.
    useSession.getState().reset();
    assert.equal(await useSession.getState().loadDecision(id), true);
    const fresh = useSession.getState();
    assert.equal(fresh.committedOptionId, s.options[0].id);
    assert.equal(fresh.status, "ready");

    const record = await loadDecisionRecord(id);
    assert.ok(record, "the record survives the relaunch");
    assert.equal(record.id, id);
    assert.equal(record.rawInput, "Should I take the job offer or stay?");
    assert.equal(record.chosenOptionId, s.options[0].id);
    assert.equal(record.againstRecommendation, false, "choosing the leader is not against the recommendation");
    assert.equal(record.status, "decided");
    assert.equal(record.extraction.options.length, s.options.length);
    assert.equal(record.extraction.factors.length, s.factors.length);
    assert.equal(record.scores.length, s.options.length);
    assert.ok(record.checkIns.length > 0, "the check-in plan is part of the memory");
    assert.equal(record.outcomeRating, undefined);
  });

  it("updates the record as check-ins and the outcome come in", async () => {
    await useSession.getState().submit("Should I take the job offer or stay?");
    const s = useSession.getState();
    assert.equal(s.setManualScores(rate(s, 1)), true);
    await useSession.getState().commit(s.options[1].id);
    const id = useSession.getState().decisionId;

    const record = await loadDecisionRecord(id);
    assert.ok(record && record.checkIns.length > 0, "a serious decision plans check-ins");

    const answered = recordCheckIn(record, record.checkIns[0].id, "better", "It is working");
    const reviewed = recordOutcome(answered, {
      overall: "better",
      factors: [],
      surprises: ["It changed faster than expected"],
      wouldChange: "Ask earlier",
    });
    await updateDecisionRecord(reviewed);

    const again = await loadDecisionRecord(id);
    assert.ok(again);
    assert.equal(again.checkIns[0].status, "completed");
    assert.equal(again.checkIns[0].rating, "better");
    assert.equal(again.checkIns[0].notes, "It is working");
    assert.equal(again.status, "reviewed");
    assert.equal(again.outcomeRating.overall, "better");
    assert.equal(again.outcomeRating.surprises[0], "It changed faster than expected");
    assert.equal(again.lesson, "Ask earlier");

    // The surviving memory still recomputes the surfaces ORION draws from it.
    const quality = scoreDecisionQuality(again);
    assert.ok(quality.score > 0);
    assert.ok(quality.criteria.length >= 5);
  });

  it("writes no record while a decision stays open", async () => {
    await useSession.getState().submit("Should I take the job offer or stay?");
    const s = useSession.getState();
    s.setManualScores(rate(s, 0));
    await useSession.getState().commit(null);
    assert.equal((await db.list("decision_records")).length, 0);
  });
});