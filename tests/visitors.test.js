// Launch readiness: visitors behind the web proxy are told apart, guests get a few tries, the operator sees counts
// and errors, /health keeps model details private, and the web app's backup never overwrites the Expo app's.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handler } from "../server/index.ts";
import { memoryStore } from "../server/store.ts";
import { admitGuest, signClient, verifiedClient, isOperator } from "../server/visitors.ts";
import { routesFor } from "../server/models.ts";

const SECRET = "proxy-secret-for-tests";

function call(handle, method, path, { body, headers = {}, ip = "198.51.100.7" } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url: path, headers: { host: "orion.example", ...headers }, socket: { remoteAddress: ip } });
    const res = {
      writeHead(status, h = {}) { this.status = status; this.headers = h; },
      end(text) { resolve({ status: this.status, headers: this.headers, body: text ? JSON.parse(text) : null }); },
    };
    handle(req, res).catch(reject);
  });
}

const signup = (i) => ({ username: `user${i}`, email: `u${i}@example.com`, password: "correct horse battery", acceptTerms: true });

describe("signed client address", () => {
  it("accepts a fresh signature and refuses forged, altered or stale ones", () => {
    const now = 1_800_000_000_000;
    const value = signClient("203.0.113.9", SECRET, now);
    assert.equal(verifiedClient(value, SECRET, now + 1000), "203.0.113.9");
    assert.equal(verifiedClient(value, "other-secret", now), null);
    assert.equal(verifiedClient(value.replace("203.0.113.9", "203.0.113.8"), SECRET, now), null);
    assert.equal(verifiedClient(value, SECRET, now + 10 * 60_000), null, "older than five minutes");
    assert.equal(verifiedClient("not|a|signature", SECRET, now), null);
    assert.equal(verifiedClient(signClient("2001:db8::1", SECRET, now), SECRET, now), "2001:db8::1");
  });

  it("lets many visitors behind one proxy sign up, where unsigned they would share one limit", async () => {
    const env = { ORION_PROXY_SECRET: SECRET };
    const signed = handler({ env, store: memoryStore(), authCost: 1024 });
    for (let i = 0; i < 8; i++) {
      const res = await call(signed, "POST", "/auth/signup", { body: signup(i), headers: { "x-orion-client": signClient(`203.0.113.${i + 1}`, SECRET) } });
      assert.equal(res.status, 201, `visitor ${i}`);
    }
    const unsigned = handler({ env, store: memoryStore(), authCost: 1024 });
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await call(unsigned, "POST", "/auth/signup", { body: signup(i) })).status);
    assert.deepEqual(statuses.slice(0, 5), [201, 201, 201, 201, 201]);
    assert.ok(statuses.slice(5).every((s) => s === 429), "the sixth signup from one address in an hour is refused");
    const forged = await call(unsigned, "POST", "/auth/signup", { body: signup(99), headers: { "x-orion-client": signClient("203.0.113.200", "guess") } });
    assert.equal(forged.status, 429, "a header signed with the wrong secret counts as the proxy's own address");
  });
});

describe("guest tries", () => {
  const parse = { input: "Cook or order food tonight?" };
  it("allows a few decisions signed out, then invites a signup", async () => {
    const handle = handler({ env: { ORION_GUEST_DECISIONS: "2" }, store: memoryStore(), authCost: 1024 });
    assert.equal((await call(handle, "POST", "/decision/parse", { body: parse })).status, 200);
    assert.equal((await call(handle, "POST", "/decision/parse", { body: parse })).status, 200);
    const third = await call(handle, "POST", "/decision/parse", { body: parse });
    assert.deepEqual([third.status, third.body.code], [401, "guest_limit"]);
    const other = await call(handle, "POST", "/decision/parse", { body: parse, ip: "198.51.100.8" });
    assert.equal(other.status, 200, "another visitor has their own tries");
  });

  it("keeps tasks, boards and feedback for accounts", async () => {
    const handle = handler({ env: {}, store: memoryStore(), authCost: 1024 });
    const res = await call(handle, "POST", "/tasks/score", { body: { tasks: [{ id: "a", title: "Write" }] } });
    assert.deepEqual([res.status, res.body.code], [401, "signed_out"]);
  });

  it("caps follow-up requests per decision and the day's total for everyone", async () => {
    const store = memoryStore();
    const config = { decisions: 1, dailyTotal: 2 };
    for (let i = 0; i < 12; i++) assert.equal((await admitGuest(store, config, "a", "/decision/score-factors")).allowed, true);
    assert.equal((await admitGuest(store, config, "a", "/decision/score-factors")).allowed, false);
    assert.equal((await admitGuest(store, config, "b", "/decision/parse")).allowed, true);
    assert.equal((await admitGuest(store, config, "c", "/decision/parse")).allowed, true);
    assert.equal((await admitGuest(store, config, "d", "/decision/parse")).allowed, false, "the day's total is reached");
  });
});

describe("operator view", () => {
  const ADMIN = "admin-key-for-tests";
  it("hides model routing from /health once a key is set, and shows it to the key", async () => {
    const env = { ORION_ADMIN_KEY: ADMIN, OPENROUTER_API_KEY: "k", ORION_FREE_UPTIME: "0" };
    const handle = handler({ env, store: memoryStore(), fetchImpl: async () => new Response("{}") });
    const open = await call(handle, "GET", "/health");
    assert.equal(open.body.ok, true);
    assert.equal(open.body.routing, undefined);
    assert.equal(open.body.guestDecisions, 2);
    const operator = await call(handle, "GET", "/health", { headers: { authorization: `Bearer ${ADMIN}` } });
    assert.ok(operator.body.routing.parse.length > 0);
  });

  it("counts launch events and keeps client errors for the operator only", async () => {
    const handle = handler({ env: { ORION_ADMIN_KEY: ADMIN }, store: memoryStore(), authCost: 1024 });
    await call(handle, "POST", "/auth/signup", { body: signup(1) });
    await call(handle, "POST", "/decision/parse", { body: { input: "Bus or taxi?" } });
    await call(handle, "POST", "/client-error", { body: { message: "TypeError: x is undefined", page: "/app" } });
    assert.equal((await call(handle, "GET", "/admin/stats")).status, 404, "no key, no stats");
    assert.equal((await call(handle, "GET", "/admin/stats", { headers: { authorization: "Bearer wrong" } })).status, 404);
    const stats = await call(handle, "GET", "/admin/stats", { headers: { authorization: `Bearer ${ADMIN}` } });
    assert.equal(stats.status, 200);
    const today = stats.body.days[0].counts;
    assert.deepEqual([today.signup, today.guest_decision, today.client_error], [1, 1, 1]);
    assert.equal(stats.body.errors[0].message, "TypeError: x is undefined");
    assert.equal(isOperator(undefined, ADMIN), false);
  });
});

describe("web backup", () => {
  it("keeps the web app's backup apart from the Expo app's", async () => {
    const handle = handler({ env: {}, store: memoryStore(), authCost: 1024 });
    const created = await call(handle, "POST", "/auth/signup", { body: signup(1) });
    const cookie = created.headers["Set-Cookie"].split(";")[0];
    const data = (tables) => ({ data: { app: "orion", version: 1, exportedAt: new Date().toISOString(), tables } });
    assert.equal((await call(handle, "POST", "/account/backup", { body: data({ decisions: [{ id: "expo" }] }), headers: { cookie } })).status, 200);
    assert.equal((await call(handle, "POST", "/account/web-backup", { body: data({ runs: [{ id: "web" }] }), headers: { cookie } })).status, 200);
    const app = await call(handle, "GET", "/account/backup", { headers: { cookie } });
    const web = await call(handle, "GET", "/account/web-backup", { headers: { cookie } });
    assert.equal(app.body.data.tables.decisions[0].id, "expo");
    assert.equal(web.body.data.tables.runs[0].id, "web");
  });
});

describe("model pool", () => {
  it("never routes to withdrawn models or, unless allowed, to ones that log prompts", () => {
    const env = { OPENROUTER_API_KEY: "k", ORION_COMPAT_MODELS: "minimax/minimax-m3.1-flash:free,nvidia/nemotron-3.5-super-vl:free,cohere/north-mini-code:free" };
    const models = (e) => routesFor("parse", e).filter((r) => r.provider === "compatible").map((r) => r.model);
    assert.deepEqual(models(env), ["cohere/north-mini-code:free"]);
    assert.ok(models({ ...env, ORION_ALLOW_PROMPT_LOGGING: "1" }).includes("nvidia/nemotron-3.5-super-vl:free"));
  });
});
