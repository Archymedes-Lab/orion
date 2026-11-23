// Check-ins, templates, the "is this a decision?" step and exports, through the session as the screens use it.
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { useSession } from "../src/store/session.ts";
import { db } from "../src/db/database.ts";
import { TABLES, deleteDecision } from "../src/db/decisions.ts";
import { dueFollowUps, nextFollowUp, recordRating, snoozeFollowUp } from "../src/db/followups.ts";
import { buildReport, checkInEvent } from "../src/export/report.ts";

beforeEach(async () => {
  useSession.setState({ privateMode: false });
  useSession.getState().reset();
  await db.init();
  for (const table of TABLES) await db.clearTable(table);
});

const DAY = 24 * 60 * 60 * 1000;
const later = (days) => new Date(Date.now() + days * DAY + 60_000);
const rate = (s, lead) => s.options.flatMap((o, i) => s.factors.map((f) => ({ optionId: o.id, factorId: f.id, value: i === lead ? 6 : -3, probabilityConfidence: 0.7 })));

describe("is this a decision?", () => {
  it("asks before comparing a greeting or a fact, and compares when told to", async () => {
    await useSession.getState().submit("hello");
    assert.equal(useSession.getState().status, "clarify");
    assert.equal(useSession.getState().clarify.kind, "greeting");
    await useSession.getState().submit("What is the capital of France?");
    assert.equal(useSession.getState().status, "clarify");
    await useSession.getState().submit("What is the capital of France?", true);
    assert.equal(useSession.getState().status, "ready");
  });
  it("never holds a crisis behind the check", async () => {
    await useSession.getState().submit("I want to die");
    assert.equal(useSession.getState().status, "ready");
    assert.equal(useSession.getState().safety, "crisis");
  });
  it("gives a fun question no interview", async () => {
    await useSession.getState().submit("Pizza or tacos tonight?");
    const s = useSession.getState();
    assert.equal(s.mode, "playful");
    assert.equal(s.questions.length, 0);
    s.flip();
    assert.equal(useSession.getState().flips, 1);
  });
});

describe("check-ins", () => {
  it("are planned when a decision is made, come due, and close when rated", async () => {
    await useSession.getState().submit("Should I take the job offer or stay?");
    let s = useSession.getState();
    assert.equal(s.mode, "serious");
    assert.equal(s.setManualScores(rate(s, 0)), true);
    await useSession.getState().commit(s.options[0].id);
    s = useSession.getState();
    const next = await nextFollowUp(s.decisionId);
    assert.ok(next, "a check-in is scheduled");
    assert.equal((await dueFollowUps(new Date())).length, 0, "nothing due yet");
    const due = await dueFollowUps(later(7));
    assert.equal(due.length, 1);
    assert.equal(due[0].chosen, s.options[0].label);
    await recordRating(s.decisionId, "Good", later(7));
    assert.equal((await dueFollowUps(later(7))).length, 0, "answered");
    assert.equal((await dueFollowUps(later(30))).length, 1, "the month check is still to come");
  });
  it("keep their dates when the same choice is saved again", async () => {
    await useSession.getState().submit("Should I take the job offer or stay?");
    const s = useSession.getState();
    s.setManualScores(rate(s, 0));
    await useSession.getState().commit(s.options[0].id);
    const first = await nextFollowUp(s.decisionId);
    await new Promise((r) => setTimeout(r, 5));
    await useSession.getState().commit(s.options[0].id);
    assert.equal((await nextFollowUp(s.decisionId)).dueAt, first.dueAt);
  });
  it("switch from 'still deciding?' to 'how did it go?' once chosen", async () => {
    await useSession.getState().submit("Should I cook or order food?");
    let s = useSession.getState();
    await useSession.getState().commit(null);
    let due = await dueFollowUps(later(1));
    assert.equal(due[0].kind, "open");
    s.setManualScores(rate(s, 1));
    await useSession.getState().commit(s.options[1].id);
    due = await dueFollowUps(later(2));
    assert.equal(due.length, 1);
    assert.equal(due[0].kind, "outcome");
    s = useSession.getState();
    await snoozeFollowUp(due[0].id, 3, later(2));
    assert.equal((await dueFollowUps(later(2))).length, 0, "snoozed");
  });
  it("are not made for fun decisions or private ones, and go with a deleted decision", async () => {
    await useSession.getState().submit("Pizza or tacos tonight?");
    let s = useSession.getState();
    await useSession.getState().commit(s.options[0].id);
    assert.equal(await nextFollowUp(s.decisionId), null);

    useSession.getState().reset();
    useSession.getState().togglePrivate();
    await useSession.getState().submit("Should I cook or order food?");
    s = useSession.getState();
    await useSession.getState().commit(s.options[0].id);
    assert.equal((await db.list("decision_followups")).length, 0);
    useSession.getState().togglePrivate();

    useSession.getState().reset();
    await useSession.getState().submit("Should I cook or order food?");
    s = useSession.getState();
    await useSession.getState().commit(s.options[0].id);
    assert.ok((await db.list("decision_followups")).length > 0);
    await deleteDecision(s.decisionId);
    assert.equal((await db.list("decision_followups")).length, 0);
  });
});

describe("templates", () => {
  it("start a comparison from named options and the template's factors", async () => {
    assert.equal(await useSession.getState().startTemplate("job-offer", ["Acme offer", "Stay at Globex"], "The offer pays more."), true);
    const s = useSession.getState();
    assert.equal(s.status, "ready");
    assert.equal(s.mode, "serious");
    assert.deepEqual(s.options.map((o) => o.label), ["Acme offer", "Stay at Globex"]);
    assert.ok(s.factors.some((f) => f.label === "Growth"));
    assert.match(s.rawInput, /The offer pays more/);
  });
  it("refuses fewer than two options or an unknown template", async () => {
    assert.equal(await useSession.getState().startTemplate("job-offer", ["Only one"]), false);
    assert.equal(await useSession.getState().startTemplate("nope", ["A", "B"]), false);
  });
});

describe("export", () => {
  it("writes the comparison, the call and the choice in every format, escaping the page", async () => {
    await useSession.getState().submit("Should I cook <b>or</b> order food?");
    const s = useSession.getState();
    s.setManualScores(rate(s, 0));
    const now = useSession.getState();
    const report = buildReport({
      title: now.extraction.title, question: now.rawInput, options: now.options, factors: now.factors, signal: true,
      chosenId: now.options[0].id, call: { kind: "clear", optionId: now.options[0].id, label: now.options[0].label, headline: "Go with it.", line: "Because." },
      date: new Date("2026-10-07T12:00:00Z"),
    });
    assert.match(report.markdown, /^# /);
    assert.match(report.markdown, /## How the options compare/);
    assert.match(report.text, /Chose: /);
    assert.ok(!report.html.includes("<b>or</b>"), "user text is escaped in the page");
    assert.match(report.filename, /^orion-[a-z0-9-]+$/);
  });
  it("says so instead of printing zeros when nothing was scored", () => {
    const report = buildReport({ title: "T", question: "Q", options: [], factors: [{ id: "f", label: "Cost", weight: 1 }], signal: false, chosenId: null, call: null });
    assert.match(report.text, /Not scored yet/);
  });
  it("makes a calendar event for a check-in", () => {
    const ics = checkInEvent({ title: "Job, offer; maybe", prompt: "How is it going?", dueAt: "2026-10-14T09:00:00.000Z", now: new Date("2026-10-07T00:00:00Z") });
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /DTSTART;VALUE=DATE:20261014/);
    assert.match(ics, /SUMMARY:ORION check-in: Job\\, offer\\; maybe/);
    assert.match(ics, /END:VCALENDAR\r\n$/);
  });
});
