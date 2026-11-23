// Prioritize: the combined Eisenhower × leverage board (src/decision-engine/board.ts). The placement rules are the
// proposal's, word for word; the insights (recurring urgencies, Invest share, slipping work, score gaming, delegation,
// capacity) and the operations the browser and the server both apply.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  apply, applyAll, arrange, compareTasks, dateOf, dayNumber, delegateTo, emptyBoard, goalProgress, inflated, investShare, leverageBy, load,
  OpError, placement, quadrant, recurring, slipping, unanchored, weekStart, DAY, KEEP_CLOSED_MS, LIMITS, QUADRANTS,
} from "../src/decision-engine/board.ts";
import { forAll } from "./helpers/property.js";

const NOW = Date.parse("2026-10-23T10:00:00Z"); // a Friday
const s = (value, origin = "user") => ({ value, origin });
let seq = 0;
const task = (over = {}) => ({
  id: over.id ?? `t${++seq}`, title: over.title ?? "A task", impact: s(over.i ?? 3), effort: s(over.e ?? 3), urgency: s(over.u ?? 2),
  status: "open", createdAt: over.createdAt ?? NOW - DAY, postponed: 0, log: [], ...over.rest,
});
const board = (tasks = [], extra = {}) => ({ ...emptyBoard("b1", "Board", "personal", NOW), tasks, ...extra });

describe("placement: the proposal's rules", () => {
  it("urgent means urgency 4 or 5", () => {
    for (const u of [1, 2, 3, 4, 5]) assert.equal(["act", "contain"].includes(quadrant(task({ i: 5, u }))), u >= 4, `urgency ${u}`);
  });
  it("high leverage means impact 4–5 whatever the effort, or impact 3 with effort 1–2", () => {
    for (let i = 1; i <= 5; i++) for (let e = 1; e <= 5; e++) {
      const high = i >= 4 || (i === 3 && e <= 2);
      assert.equal(leverageBy(task({ i, e })) !== null, high, `impact ${i} effort ${e}`);
    }
    assert.equal(leverageBy(task({ i: 5, e: 5 })), "impact", "big bets stay visible");
    assert.equal(leverageBy(task({ i: 3, e: 2 })), "quick_win");
  });
  it("names the four boxes", () => {
    assert.equal(quadrant(task({ i: 4, e: 1, u: 5 })), "act");
    assert.equal(quadrant(task({ i: 4, e: 3, u: 2 })), "invest");
    assert.equal(quadrant(task({ i: 2, e: 1, u: 4 })), "contain");
    assert.equal(quadrant(task({ i: 1, e: 1, u: 1 })), "drop");
  });
  it("orders a box by impact ÷ effort, then the nearest deadline, then the oldest", () => {
    const a = task({ id: "a", i: 4, e: 1, u: 5 }), b = task({ id: "b", i: 5, e: 2, u: 5 });
    const c = task({ id: "c", i: 4, e: 2, u: 5, rest: { due: "2026-11-01" } }), d = task({ id: "d", i: 4, e: 2, u: 5, rest: { due: "2026-10-24" } });
    const e = task({ id: "e", i: 4, e: 2, u: 5, createdAt: NOW - 5 * DAY });
    assert.deepEqual(arrange([e, c, b, a, d]).act.map((t) => t.id), ["a", "b", "d", "c", "e"]);
  });
  it("leaves closed tasks off the board", () => {
    const done = task({ i: 5, u: 5, rest: { status: "done" } });
    assert.equal(arrange([done]).act.length, 0);
  });
  it("says when a one-point change would move a task", () => {
    const p = placement(task({ i: 3, e: 2, u: 3 }));
    assert.equal(p.quadrant, "invest");
    assert.deepEqual(p.edge, { urgency: true, impact: true, effort: true });
    const solid = placement(task({ i: 5, e: 1, u: 1 }));
    assert.deepEqual(solid.edge, { urgency: false, impact: false, effort: false });
  });
});

describe("insights", () => {
  it("finds an urgency that came back three times by theme, and counts its hours", () => {
    const fires = [1, 8, 15].map((d, k) => task({ id: `f${k}`, title: `Client invoice wrong #${k}`, i: 2, e: 2, u: 5, createdAt: NOW - d * DAY, rest: { theme: "Invoicing errors", log: k === 0 ? [{ at: NOW, minutes: 120, quadrant: "contain" }] : [] } }));
    const [r] = recurring(board(fires), NOW);
    assert.equal(r.tasks.length, 3);
    assert.equal(r.theme, "invoicing errors");
    assert.equal(r.hours, 2 + 3 + 3, "logged where logged, the effort anchor elsewhere");
    assert.equal(r.estimated, true);
    assert.equal(r.fix, null);
  });
  it("groups untagged urgencies by shared words, ignores old ones and points at an existing fix", () => {
    const fires = [
      task({ title: "Fix invoicing error for ACME", u: 5, createdAt: NOW - 2 * DAY }),
      task({ title: "Invoicing error for Beta client", u: 4, createdAt: NOW - 3 * DAY }),
      task({ title: "Invoicing error again (Gamma)", u: 5, createdAt: NOW - 4 * DAY }),
      task({ title: "Invoicing error from last quarter", u: 5, createdAt: NOW - 40 * DAY }),
      task({ title: "Order printer paper", u: 5 }),
    ];
    const fix = task({ title: "Automate invoicing", i: 4, u: 2, rest: { from: { kind: "recurring", theme: "Invoicing error" } } });
    const out = recurring(board([...fires, fix]), NOW);
    assert.equal(out.length, 1);
    assert.equal(out[0].tasks.length, 3);
    assert.equal(out[0].theme, "invoicing error", "labelled by the words most titles share");
    assert.equal(out[0].fix?.id, fix.id);
  });
  it("meets across word forms and joins on any task in the group", () => {
    const fires = ["Fix invoicing error for a client", "Client invoice wrong again (Beta)", "Invoice error for Gamma client"].map((title, k) => task({ title, u: 5, createdAt: NOW - (3 - k) * DAY }));
    const [r] = recurring(board(fires), NOW);
    assert.equal(r?.tasks.length, 3);
    assert.equal(r.theme, "invoicing error client");
  });
  it("needs three: two repeats are not a pattern", () => {
    assert.deepEqual(recurring(board([task({ u: 5, rest: { theme: "x" } }), task({ u: 5, rest: { theme: "x" } })]), NOW), []);
  });
  it("measures this week's Invest share against the target (Monday-start weeks)", () => {
    assert.equal(new Date(weekStart(NOW)).toISOString(), "2026-10-19T00:00:00.000Z");
    const t = task({ rest: { log: [
      { at: NOW - DAY, minutes: 30, quadrant: "invest", by: "m1" },
      { at: NOW - 2 * DAY, minutes: 690, quadrant: "act", by: "m2" },
      { at: NOW - 6 * DAY, minutes: 600, quadrant: "invest", by: "m1" }, // last week
    ] } });
    const share = investShare(board([t]), NOW);
    assert.equal(share.minutes, 720);
    assert.equal(share.share, 30 / 720);
    assert.equal(share.target, 0.2);
    assert.equal(investShare(board([t]), NOW, "m1").share, 1, "per member");
  });
  it("raises high-leverage work postponed three times, not low-leverage work", () => {
    const plan = task({ id: "plan", i: 5, e: 4, u: 2, rest: { postponed: 3 } });
    const chore = task({ id: "chore", i: 1, e: 1, u: 1, rest: { postponed: 5 } });
    assert.deepEqual(slipping([plan, chore]).map((t) => t.id), ["plan"]);
  });
  it("points out when most tasks share the top score", () => {
    const fives = Array.from({ length: 4 }, () => task({ i: 5 }));
    assert.equal(inflated([...fives, task({ i: 2 })])?.score, "impact");
    assert.equal(inflated([...fives.slice(0, 2), task(), task(), task()]), null);
    assert.equal(inflated(fives), null, "too few to say");
  });
  it("suggests a delegate by role, then by spare hours, never the person asking; none on a board of one", () => {
    const members = [
      { id: "me", name: "Ana", access: "owner", hoursPerWeek: 40 },
      { id: "bo", name: "Bo", role: "Finance and supplier reports", access: "editor", hoursPerWeek: 10 },
      { id: "cy", name: "Cy", role: "Sales", access: "editor", hoursPerWeek: 40 },
    ];
    const report = task({ title: "Weekly supplier report", i: 2, u: 4 });
    const b = board([report], { members, kind: "team" });
    assert.deepEqual(delegateTo(b, report, "me"), { member: members[1], because: "role" });
    const outage = task({ title: "Follow up on office internet outage", i: 2, u: 4 });
    assert.equal(delegateTo(board([outage], { members, kind: "team" }), outage, "me").member.id, "cy");
    assert.equal(delegateTo(board([report], { members: [members[0]] }), report, "me"), null);
  });
  it("skips someone over capacity and flags them", () => {
    const members = [{ id: "me", name: "Ana", access: "owner" }, { id: "bo", name: "Bo", role: "supplier reports", access: "editor", hoursPerWeek: 10 }];
    const big = task({ i: 5, e: 4, u: 5, rest: { assignee: "bo" } });
    const report = task({ title: "Supplier report", i: 2, u: 4 });
    const b = board([big, report], { members, kind: "team" });
    assert.equal(load(b).find((x) => x.member.id === "bo").over, true);
    assert.equal(delegateTo(b, report, "me"), null);
  });
  it("tracks goals and tasks with no goal", () => {
    const goals = [{ id: "g1", title: "Sign 3 pilot clients" }];
    const t1 = task({ i: 4, rest: { goalId: "g1" } }), t2 = task({ i: 2 }), t3 = task({ rest: { goalId: "g1", status: "done", closedAt: NOW - DAY } });
    const b = board([t1, t2, t3], { goals });
    assert.deepEqual(goalProgress(b, NOW).map(({ open, leverage, doneThisWeek }) => ({ open, leverage, doneThisWeek })), [{ open: 1, leverage: 1, doneThisWeek: 1 }]);
    assert.deepEqual(unanchored(b).map((t) => t.id), [t2.id]);
    assert.deepEqual(unanchored(board([t2])), [], "without goals there is nothing to anchor to");
  });
});

describe("operations", () => {
  const ctx = { now: NOW, actor: null };
  const add = (b, t) => apply(b, { op: "task.add", task: t }, ctx);
  const fresh = (over = {}) => { const { status, createdAt, postponed, log, ...rest } = task(over); return rest; };

  it("adds, edits (the task moves), logs time in the box it was in, completes", () => {
    let b = add(board(), fresh({ id: "x", i: 4, e: 3, u: 2 }));
    assert.equal(quadrant(b.tasks[0]), "invest");
    b = apply(b, { op: "task.log", id: "x", minutes: 90 }, ctx);
    b = apply(b, { op: "task.update", id: "x", patch: { urgency: s(5) } }, ctx);
    assert.equal(quadrant(b.tasks[0]), "act");
    b = apply(b, { op: "task.done", id: "x", minutes: 30 }, { now: NOW + 1000 });
    assert.deepEqual(b.tasks[0].log.map((l) => [l.minutes, l.quadrant]), [[90, "invest"], [30, "act"]]);
    assert.equal(b.tasks[0].status, "done");
    assert.equal(b.tasks[0].closedAt, NOW + 1000);
    assert.equal(b.version, 4);
  });
  it("a retried add is a no-op; postponing pushes the due date a week", () => {
    let b = add(board(), fresh({ id: "x", rest: { due: "2026-12-28" } }));
    assert.equal(add(b, fresh({ id: "x" })), b);
    b = apply(b, { op: "task.postpone", id: "x" }, ctx);
    assert.equal(b.tasks[0].postponed, 1);
    assert.equal(b.tasks[0].due, "2027-01-04");
  });
  it("removing a goal unanchors its tasks; references must exist", () => {
    let b = apply(board(), { op: "goals.set", goals: [{ id: "g1", title: "Hire a sales lead" }] }, ctx);
    b = add(b, fresh({ id: "x", rest: { goalId: "g1" } }));
    b = apply(b, { op: "goals.set", goals: [] }, ctx);
    assert.equal(b.tasks[0].goalId, null);
    assert.throws(() => add(b, fresh({ rest: { goalId: "nope" } })), OpError);
    assert.throws(() => apply(b, { op: "task.update", id: "x", patch: { assignee: "ghost" } }, ctx), OpError);
    assert.throws(() => apply(b, { op: "goals.set", goals: Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, title: "g" })) }, ctx), OpError);
  });
  it("on a team, only owners manage members and the board; anyone may edit themselves", () => {
    const team = { ...emptyBoard("b2", "Team", "team", NOW, { id: "own", name: "Ana" }), members: [{ id: "own", name: "Ana", access: "owner" }, { id: "ed", name: "Bo", access: "editor" }] };
    const asEditor = { now: NOW, actor: "ed" };
    assert.throws(() => apply(team, { op: "member.add", member: { id: "z", name: "Zed" } }, asEditor), (e) => e.code === "forbidden");
    assert.throws(() => apply(team, { op: "board.set", investTarget: 50 }, asEditor), (e) => e.code === "forbidden");
    assert.throws(() => apply(team, { op: "member.remove", id: "own" }, { now: NOW, actor: "own" }), (e) => e.code === "forbidden", "the owner cannot be removed");
    assert.equal(apply(team, { op: "member.update", id: "ed", patch: { hoursPerWeek: 20 } }, asEditor).members[1].hoursPerWeek, 20);
    const added = apply(team, { op: "member.add", member: { id: "z", name: "Zed" } }, { now: NOW, actor: "own" });
    assert.equal(added.members.at(-1).access, "editor");
    const withTask = apply(added, { op: "task.add", task: fresh({ id: "x", rest: { assignee: "z" } }) }, asEditor);
    assert.equal(apply(withTask, { op: "member.remove", id: "z" }, { now: NOW, actor: "own" }).tasks[0].assignee, null, "their tasks become unassigned");
    assert.equal(apply(team, { op: "board.set", investTarget: 140 }, { now: NOW, actor: "own" }).investTarget, 100);
  });
  it("applyAll skips an operation on a task someone else removed, and applies the rest", () => {
    const b = add(board(), fresh({ id: "x" }));
    const { board: out, skipped } = applyAll(b, [{ op: "task.done", id: "gone" }, { op: "task.postpone", id: "x" }], ctx);
    assert.deepEqual(skipped, [{ index: 0, code: "not_found" }]);
    assert.equal(out.tasks[0].postponed, 1);
  });
  it("keeps closed tasks 90 days, then prunes them", () => {
    let b = add(board(), fresh({ id: "old" }));
    b = apply(b, { op: "task.done", id: "old" }, ctx);
    b = add(b, fresh({ id: "new" }));
    const later = apply(b, { op: "task.postpone", id: "new" }, { now: NOW + KEEP_CLOSED_MS + DAY });
    assert.deepEqual(later.tasks.map((t) => t.id), ["new"]);
  });
  it("caps open tasks", () => {
    const tasks = Array.from({ length: LIMITS.tasks }, (_, k) => task({ id: `t${k}` }));
    assert.throws(() => add(board(tasks), fresh({ id: "one-more" })), (e) => e.code === "limit");
  });
});

describe("dates without Date", () => {
  it("round-trips civil dates across leap years", () => forAll(200, (r) => {
    const days = r.int(-30000, 60000);
    assert.equal(dayNumber(dateOf(days)), days);
    assert.equal(dateOf(days), new Date(days * DAY).toISOString().slice(0, 10));
  }));
});

describe("board invariants", () => {
  const randomTask = (r, k) => task({ id: `r${k}`, i: r.int(1, 5), e: r.int(1, 5), u: r.int(1, 5), createdAt: NOW - r.int(0, 60) * DAY, rest: { due: r.bool() ? dateOf(r.int(20700, 20800)) : null } });
  it("every open task lands in exactly one box; each box is sorted; arrangement ignores input order", () => forAll(100, (r) => {
    const tasks = Array.from({ length: r.int(0, 30) }, (_, k) => randomTask(r, k));
    const a = arrange(tasks);
    assert.equal(QUADRANTS.reduce((n, q) => n + a[q].length, 0), tasks.length);
    for (const q of QUADRANTS) for (let k = 1; k < a[q].length; k++) assert.ok(compareTasks(a[q][k - 1], a[q][k]) <= 0);
    assert.deepEqual(arrange(r.shuffle(tasks)), a);
  }));
  it("raising impact or urgency never moves a task to a less pressing box; raising effort never adds leverage", () => forAll(100, (r) => {
    const t = randomTask(r, 0);
    const up = (k) => ({ ...t, [k]: s(Math.min(5, t[k].value + 1)) });
    const rank = { act: 3, invest: 2, contain: 1, drop: 0 };
    assert.ok(rank[quadrant(up("urgency"))] >= rank[quadrant(t)] || quadrant(t) === "invest");
    assert.ok(leverageBy(up("impact")) !== null || leverageBy(t) === null);
    assert.ok(leverageBy(up("effort")) === null || leverageBy(t) !== null);
  }));
  it("the Invest share is a share", () => forAll(60, (r) => {
    const tasks = Array.from({ length: r.int(1, 10) }, (_, k) => task({ id: `l${k}`, rest: { log: Array.from({ length: r.int(0, 5) }, () => ({ at: NOW - r.int(0, 14) * DAY, minutes: r.int(1, 300), quadrant: r.pick(QUADRANTS) })) } }));
    const x = investShare(board(tasks), NOW);
    assert.ok(x.share >= 0 && x.share <= 1);
    assert.equal(QUADRANTS.reduce((a, q) => a + x.byQuadrant[q], 0), x.minutes);
  }));
});
