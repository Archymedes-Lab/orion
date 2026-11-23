// Prioritize on the server: boards (/boards/*) through the real handler with accounts on, and the AI's proposals
// (/tasks/score, /tasks/split) with a fake Jev and a fake OpenAI. No network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handler } from "../server/index.ts";
import { memoryStore } from "../server/store.ts";
import { TASK_QUESTIONS, scoreTasks } from "../server/tasks.ts";
import { invoke, openaiResponse } from "./helpers/ai.js";

/** A browser-like client that keeps its session cookie. */
function client(handle, ip = "203.0.113.5") {
  let cookie = "";
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url: path, headers: { host: "orion.example", origin: "https://orion.example", ...(cookie ? { cookie } : {}) }, socket: { remoteAddress: ip } });
    const res = {
      writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
      end(text) {
        const set = this.headers["Set-Cookie"];
        if (set) cookie = /Max-Age=0/.test(set) ? "" : set.split(";")[0];
        resolve({ status: this.status, body: text ? JSON.parse(text) : null });
      },
    };
    handle(req, res).catch(reject);
  });
  return { post: (path, body = {}) => call("POST", path, body), get: (path) => call("GET", path) };
}
const s = (value, origin = "user") => ({ value, origin });
const newTask = (id, over = {}) => ({ id, title: `Task ${id}`, impact: s(3), effort: s(3), urgency: s(2), ...over });

async function people(n, store = memoryStore()) {
  const h = handler({ env: {}, store, authCost: 1024 });
  const out = [];
  for (let k = 0; k < n; k++) {
    const c = client(h, `203.0.113.${10 + k}`);
    const r = await c.post("/auth/signup", { username: `user${k}`, email: `user${k}@example.com`, password: "correct horse battery", acceptTerms: true });
    assert.equal(r.status, 201);
    out.push(c);
  }
  return { h, people: out, store };
}

describe("boards", () => {
  it("needs accounts, a session and POST", async () => {
    assert.equal((await client(handler({ env: {}, store: null })).post("/boards/list")).status, 404, "no accounts: the web app keeps a local board");
    const h = handler({ env: {}, store: memoryStore(), authCost: 1024 });
    assert.equal((await client(h).post("/boards/list")).status, 401);
    assert.equal((await client(h).get("/boards/list")).status, 405);
  });

  it("gives everyone one personal board, and keeps it across lists", async () => {
    const { people: [ana] } = await people(1);
    const first = await ana.post("/boards/list");
    assert.equal(first.status, 200);
    assert.equal(first.body.boards.length, 1);
    assert.equal(first.body.boards[0].kind, "personal");
    const again = await ana.post("/boards/list");
    assert.deepEqual(again.body.boards.map((b) => b.id), first.body.boards.map((b) => b.id));
  });

  it("applies operations and returns the board without account ids", async () => {
    const { people: [ana] } = await people(1);
    const [{ id: boardId }] = (await ana.post("/boards/list")).body.boards;
    const r = await ana.post("/boards/ops", { boardId, ops: [
      { op: "goals.set", goals: [{ id: "g1", title: "Sign 3 pilot clients" }] },
      { op: "task.add", task: newTask("t1", { impact: s(4), goalId: "g1" }) },
      { op: "task.log", id: "t1", minutes: 45 },
    ] });
    assert.equal(r.status, 200);
    assert.equal(r.body.board.tasks[0].log[0].quadrant, "invest");
    assert.equal(r.body.board.tasks[0].log[0].by, r.body.me, "time is logged to the member acting");
    assert.equal(r.body.board.version, 3);
    assert.ok(!JSON.stringify(r.body).includes("accountId"));
    assert.equal(r.body.board.members[0].linked, true);
  });

  it("rejects malformed operations and fields the client may not set", async () => {
    const { people: [ana] } = await people(1);
    const [{ id: boardId }] = (await ana.post("/boards/list")).body.boards;
    for (const ops of [
      [{ op: "task.add", task: { ...newTask("t1"), impact: s(9) } }],
      [{ op: "task.add", task: { ...newTask("t1"), status: "done" } }],
      [{ op: "member.update", id: "x", patch: { access: "owner" } }],
      [{ op: "member.add", member: { id: "x", name: "Eve", accountId: "someone" } }],
      [{ op: "nope" }],
    ]) assert.equal((await ana.post("/boards/ops", { boardId, ops })).status, 400, JSON.stringify(ops));
  });

  it("shares a team board by invite: one use, linked to a named slot, owner-only powers", async () => {
    const { people: [ana, bo, cy] } = await people(3);
    const created = await ana.post("/boards/create", { name: "Acme ops", you: "Ana" });
    assert.equal(created.status, 200);
    const boardId = created.body.board.id;
    // Ana adds Bo as a named member first (tasks can be delegated to him before he joins), then invites him into that slot.
    await ana.post("/boards/ops", { boardId, ops: [{ op: "member.add", member: { id: "bo", name: "Bo", role: "Finance" } }, { op: "task.add", task: newTask("t1", { assignee: "bo", urgency: s(5) }) }] });
    const invite = await ana.post("/boards/invite", { boardId, memberId: "bo" });
    assert.equal(invite.status, 200);
    assert.equal((await bo.post("/boards/read", { boardId })).status, 404, "not a member yet");
    const joined = await bo.post("/boards/join", { code: invite.body.code, you: "Bo" });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.me, "bo", "Bo took the slot he was invited into");
    assert.equal(joined.body.board.members.length, 2);
    assert.equal((await cy.post("/boards/join", { code: invite.body.code, you: "Cy" })).status, 404, "an invite works once");
    assert.equal((await bo.post("/boards/invite", { boardId })).status, 403);
    const forbidden = await bo.post("/boards/ops", { boardId, ops: [{ op: "board.set", investTarget: 50 }, { op: "task.done", id: "t1", minutes: 20 }] });
    assert.equal(forbidden.status, 200);
    assert.deepEqual(forbidden.body.skipped, [{ index: 0, code: "forbidden" }], "an editor's owner-only op is skipped, the rest lands");
    assert.equal(forbidden.body.board.tasks[0].status, "done");
    assert.equal((await bo.post("/boards/list")).body.boards.length, 2);
    // Leaving and deleting.
    assert.equal((await ana.post("/boards/leave", { boardId })).status, 400, "the only owner cannot walk away");
    assert.equal((await bo.post("/boards/leave", { boardId })).status, 200);
    assert.equal((await bo.post("/boards/list")).body.boards.length, 1);
    assert.equal((await bo.post("/boards/delete", { boardId })).status, 404);
    assert.equal((await ana.post("/boards/delete", { boardId })).status, 200);
    assert.equal((await ana.post("/boards/read", { boardId })).status, 404);
  });

  it("merges concurrent edits instead of losing one", async () => {
    const { people: [ana, bo] } = await people(2);
    const boardId = (await ana.post("/boards/create", { name: "Team", you: "Ana" })).body.board.id;
    const { code } = (await ana.post("/boards/invite", { boardId })).body;
    await bo.post("/boards/join", { code, you: "Bo" });
    const writes = await Promise.all(Array.from({ length: 8 }, (_, k) => (k % 2 ? ana : bo).post("/boards/ops", { boardId, ops: [{ op: "task.add", task: newTask(`t${k}`) }] })));
    assert.ok(writes.every((w) => w.status === 200));
    const final = (await ana.post("/boards/read", { boardId })).body.board;
    assert.equal(final.tasks.length, 8);
    assert.equal(final.version, 1 + 8, "the join, then every add");
  });

  it("deleting an account removes its personal board and hands a team board to the next member", async () => {
    const store = memoryStore();
    const { people: [ana, bo] } = await people(2, store);
    const boardId = (await ana.post("/boards/create", { name: "Team", you: "Ana" })).body.board.id;
    const personal = (await ana.post("/boards/list")).body.boards.find((b) => b.kind === "personal").id;
    await bo.post("/boards/join", { code: (await ana.post("/boards/invite", { boardId })).body.code, you: "Bo" });
    assert.equal((await ana.post("/auth/delete", { password: "correct horse battery" })).status, 200);
    assert.equal(await store.get(`board:${personal}`), null);
    const team = (await bo.post("/boards/read", { boardId })).body;
    assert.equal(team.board.members.find((m) => m.id === team.me).access, "owner");
    assert.equal(team.board.members.find((m) => m.name === "Ana").linked, false);
  });
});

// ── AI proposals ─────────────────────────────────────────────────────────────────────────────────────────────

/** A fake Jev that "believes" a level per score from the task title (invoice → urgent, plan → impactful, big effort). */
function fakeJev(log, { fail = false } = {}) {
  const truth = { impact: (t) => (/plan/i.test(t) ? 4 : 1), effort: (t) => (/plan/i.test(t) ? 3 : 0), urgency: (t) => (/invoice/i.test(t) ? 4 : 1) };
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    log.push(body);
    if (fail) return new Response("boom", { status: 500 });
    const answers = {};
    for (const [qid, q] of Object.entries(body.questions)) {
      const key = qid.split("@")[0];
      if (q.type === "choice") {
        const want = /plan/i.test(body.state.task) ? "g1" : "none";
        answers[qid] = { type: "choice", choice: want, probabilities: Object.fromEntries(Object.keys(q.criteria).map((l) => [l, l === want ? 0.8 : 0.2 / (Object.keys(q.criteria).length - 1)])), confidence: 0.8 };
        continue;
      }
      const levels = TASK_QUESTIONS[key].levels;
      const peak = truth[key](body.state.task);
      const probabilities = Object.fromEntries(q.criteria.map((label, position) => [String(position), levels.indexOf(label) === peak ? 0.9 : 0.025]));
      answers[qid] = { type: "score", score: 0, legend: {}, probabilities, confidence: 0.8 };
    }
    return Response.json({ model: "jev-test", answers, usage: { input_tokens: 1, output_tokens: 1 } });
  };
}
function fakeFetch({ jev, openai = {} }) {
  return async (url, init) => {
    if (String(url).includes("typesafe")) return jev(url, init);
    openai.calls?.push(JSON.parse(init.body));
    if (openai.slowMs) await new Promise((r) => setTimeout(r, openai.slowMs));
    if (openai.fail) return new Response("down", { status: 503 });
    return openaiResponse(openai.reply);
  };
}
const scoreRequest = {
  tasks: [{ id: "a", title: "Fix invoice error for a client", due: "2026-10-23" }, { id: "b", title: "Write the 2027 sales plan" }],
  goals: [{ id: "g1", title: "Sign 3 pilot clients" }],
  today: "2026-10-23",
};
const generalReply = { tasks: [
  { id: "a", impact: 2, effort: 1, urgency: 5, goalId: "", theme: "invoicing errors", why: "A client is waiting on a corrected invoice today." },
  { id: "b", impact: 5, effort: 5, urgency: 2, goalId: "g1", theme: "", why: "The plan steers how the pilots get signed." },
] };

describe("task proposals", () => {
  it("Jev gives the scores and the goal, the general model the theme and reason", async () => {
    const log = [];
    const out = await scoreTasks(scoreRequest, { env: { OPENAI_API_KEY: "o" }, fetchImpl: fakeFetch({ jev: fakeJev(log), openai: { reply: generalReply } }), typesafeKey: "k" });
    assert.equal(out.judge, "typesafe");
    assert.equal(log.length, 2, "one Jev request per task");
    assert.equal(Object.keys(log[0].questions).length, 6 + 2, "three scores in both directions, the goal choice once per rotation (goal + none)");
    assert.equal(log[0].state.due, "2026-10-23");
    assert.equal("due" in log[1].state, false, "an unknown deadline is left out, not sent as \"none\"");
    assert.deepEqual(out.tasks.map(({ impact, effort, urgency }) => [impact, effort, urgency]), [[2, 1, 5], [5, 4, 2]]);
    assert.equal(out.tasks[0].theme, "invoicing errors");
    assert.equal(out.tasks[0].goalId, null);
    assert.equal(out.tasks[1].goalId, "g1", "Jev's goal pick");
  });
  it("does not wait for a slow general model once Jev has answered", async () => {
    const started = Date.now();
    const out = await scoreTasks(scoreRequest, { env: { OPENAI_API_KEY: "o" }, fetchImpl: fakeFetch({ jev: fakeJev([]), openai: { reply: generalReply, slowMs: 3000 } }), typesafeKey: "k", graceMs: 50 });
    assert.ok(Date.now() - started < 1500);
    assert.equal(out.tasks[0].urgency, 5);
    assert.equal(out.tasks[1].goalId, "g1");
    assert.equal(out.tasks[0].why, null);
  });
  it("falls back to the general model alone, and drops goal ids it invented", async () => {
    const reply = { tasks: [{ ...generalReply.tasks[0], goalId: "made-up" }, generalReply.tasks[1]] };
    const out = await scoreTasks(scoreRequest, { env: { OPENAI_API_KEY: "o" }, fetchImpl: fakeFetch({ jev: fakeJev([], { fail: true }), openai: { reply } }), typesafeKey: "k" });
    assert.equal(out.judge, "ai");
    assert.deepEqual(out.tasks.map((t) => t.urgency), [5, 2]);
    assert.equal(out.tasks[0].goalId, null);
  });
  it("keeps Jev's scores when the general model is down", async () => {
    const out = await scoreTasks(scoreRequest, { env: { OPENAI_API_KEY: "o" }, fetchImpl: fakeFetch({ jev: fakeJev([]), openai: { fail: true } }), typesafeKey: "k", graceMs: 2000 });
    assert.equal(out.tasks[0].urgency, 5);
    assert.equal(out.tasks[0].why, null);
  });
  it("through the server: 503 with no model, support path for a crisis, and a split into steps", async () => {
    const none = handler({ env: {}, fetchImpl: async () => new Response("", { status: 500 }) });
    assert.equal((await invoke(none, "/tasks/score", scoreRequest)).status, 503);
    const h = handler({ env: { OPENAI_API_KEY: "o" }, fetchImpl: fakeFetch({ jev: fakeJev([]), openai: { reply: { steps: [{ title: "List the three target segments", impact: 3, effort: 1, urgency: 2 }, { title: "Draft the pilot pricing", impact: 4, effort: 2, urgency: 2 }] } } }) });
    const crisis = await invoke(h, "/tasks/score", { ...scoreRequest, tasks: [{ id: "x", title: "I want to kill myself" }] });
    assert.equal(crisis.status, 422);
    const split = await invoke(h, "/tasks/split", { task: { title: "Write the 2027 sales plan", blocker: "I don't know which segments to target" }, goals: scoreRequest.goals, today: "2026-10-23" });
    assert.equal(split.status, 200);
    assert.equal(split.body.steps.length, 2);
    assert.equal((await invoke(h, "/tasks/score", { ...scoreRequest, tasks: [] })).status, 400);
  });
});
