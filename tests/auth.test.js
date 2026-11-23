import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handler } from "../server/index.ts";
import { memoryStore, upstashStore, storeFrom } from "../server/store.ts";
import { newRecoveryCode, passwordProblem } from "../server/auth.ts";
import { issueLicence, billingConfig } from "../server/billing.ts";
import { clientAddress } from "../server/http.ts";

/** A browser-like client: remembers the session cookie between calls. */
function client(handle, { host = "orion.example", ip = "203.0.113.5", headers: extra = {} } = {}) {
  let cookie = "";
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url: path, headers: { host, origin: `https://${host}`, ...extra, ...(cookie ? { cookie } : {}) }, socket: { remoteAddress: ip } });
    const res = {
      writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
      end(text) {
        const set = this.headers["Set-Cookie"];
        if (set) cookie = /Max-Age=0/.test(set) ? "" : set.split(";")[0];
        resolve({ status: this.status, body: text ? JSON.parse(text) : null, headers: this.headers, setCookie: set });
      },
    };
    handle(req, res).catch(reject);
  });
  return { get: (path) => call("GET", path), post: (path, body = {}) => call("POST", path, body), cookie: () => cookie, setCookie: (value) => { cookie = value; } };
}
const server = (env = {}, extra = {}) => handler({ env, store: memoryStore(), authCost: 1024, ...extra });
const account = { username: "ada", email: "Ada@Example.com", password: "correct horse battery", acceptTerms: true };

describe("account store", () => {
  it("is off without a store, on with Upstash variables, and refuses plain http", () => {
    assert.equal(storeFrom({}), null);
    assert.ok(storeFrom({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" }));
    assert.ok(storeFrom({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" }));
    assert.throws(() => storeFrom({ UPSTASH_REDIS_REST_URL: "http://x", UPSTASH_REDIS_REST_TOKEN: "t" }), /https/);
  });
  it("speaks Upstash's REST protocol", async () => {
    const sent = [];
    const store = upstashStore("https://db.upstash.io/", "tok", async (url, init) => {
      sent.push([url, init.headers.Authorization, JSON.parse(init.body)]);
      return Response.json(url.endsWith("/pipeline") ? [{ result: 3 }, { result: 1 }] : { result: sent.length === 1 ? "OK" : null });
    });
    assert.equal(await store.setIfAbsent("k", "v", 60), true);
    assert.equal(await store.setIfAbsent("k", "v"), false);
    assert.equal(await store.incr("n", 900), 3);
    assert.deepEqual(sent[0], ["https://db.upstash.io", "Bearer tok", ["SET", "k", "v", "EX", 60, "NX"]]);
    assert.deepEqual(sent[2][2], [["INCR", "n"], ["EXPIRE", "n", 900, "NX"]]);
  });
  it("expires keys in memory", async () => {
    let now = 0;
    const store = memoryStore(() => now);
    await store.set("a", "1", 10);
    assert.equal(await store.incr("n", 10), 1);
    now = 11_000;
    assert.equal(await store.get("a"), null);
    assert.equal(await store.incr("n", 10), 1);
  });
});

describe("passwords and recovery codes", () => {
  it("asks for length and rejects guessable passwords, without composition rules", () => {
    assert.match(passwordProblem("short", "a@b.co"), /at least 10/);
    assert.match(passwordProblem("password123", "a@b.co"), /easy to guess/);
    assert.match(passwordProblem("aaaaaaaaaaaa", "a@b.co"), /easy to guess/);
    assert.match(passwordProblem("adalovelace2026", "adalovelace@example.com"), /email/);
    assert.equal(passwordProblem("all lowercase words here", "a@b.co"), null);
  });
  it("makes readable, unique recovery codes", () => {
    const code = newRecoveryCode();
    assert.match(code, /^([A-HJ-KMNP-Z2-9]{5}-){3}[A-HJ-KMNP-Z2-9]{5}$/);
    assert.notEqual(code, newRecoveryCode());
  });
});

describe("signing up and in", () => {
  it("says whether accounts are available", async () => {
    assert.deepEqual((await client(handler({ env: {}, store: null })).get("/auth/config")).body, { enabled: false, inviteRequired: false, minPassword: 10 });
    assert.equal((await client(handler({ env: {}, store: null })).post("/auth/login", account)).status, 404);
    assert.equal((await client(server()).get("/auth/config")).body.enabled, true);
  });
  it("creates an account, signs in with a locked-down cookie, and shows the recovery code once", async () => {
    const browser = client(server());
    const created = await browser.post("/auth/signup", account);
    assert.equal(created.status, 201);
    assert.equal(created.body.user.email, "ada@example.com");
    assert.match(created.body.recoveryCode, /^[A-Z2-9-]{23}$/);
    assert.match(created.setCookie, /^__Host-orion_session=[\w-]{40,}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
    assert.equal(JSON.stringify(created.body).includes("scrypt"), false);
    const me = await browser.get("/auth/me");
    assert.equal(me.body.user.email, "ada@example.com");
    assert.equal(me.body.recoveryCode, undefined);
  });
  it("needs consent, a decent password and a new email", async () => {
    const browser = client(server());
    assert.equal((await browser.post("/auth/signup", { ...account, acceptTerms: false })).status, 400);
    const weak = await browser.post("/auth/signup", { ...account, password: "short" });
    assert.deepEqual([weak.status, weak.body.code], [400, "weak_password"]);
    assert.equal((await browser.post("/auth/signup", { ...account, email: "not an email" })).status, 400);
    assert.equal((await browser.post("/auth/signup", account)).status, 201);
    const again = await client(browser.handle ?? server()).post("/auth/signup", account);
    assert.equal(again.status, 201, "a different server has its own store");
  });
  it("refuses a second account for the same email, whatever its capitalisation", async () => {
    const handle = server();
    await client(handle).post("/auth/signup", account);
    const again = await client(handle).post("/auth/signup", { ...account, username: "ada2", email: " ADA@example.COM " });
    assert.deepEqual([again.status, again.body.code], [409, "email_taken"]);
    // The username a failed signup tried to claim is free again.
    assert.equal((await client(handle).post("/auth/signup", { ...account, username: "ada2", email: "other@example.com" })).status, 201);
  });
  it("needs a unique username and shows it instead of the email", async () => {
    const handle = server();
    const created = await client(handle).post("/auth/signup", { ...account, username: "Ada_L" });
    assert.equal(created.body.user.username, "Ada_L");
    const taken = await client(handle).post("/auth/signup", { ...account, username: "ada_l", email: "x@example.com" });
    assert.deepEqual([taken.status, taken.body.code], [409, "username_taken"]);
    for (const bad of ["ab", "has space", "x".repeat(25), "émoji"]) {
      assert.equal((await client(handle).post("/auth/signup", { ...account, username: bad, email: "y@example.com" })).status, 400, bad);
    }
    const { username, ...noName } = account; void username;
    assert.equal((await client(handle).post("/auth/signup", { ...noName, email: "z@example.com" })).status, 400, "required");
  });
  it("gives the same answer for a wrong password and an unknown email", async () => {
    const handle = server();
    await client(handle).post("/auth/signup", account);
    const wrong = await client(handle).post("/auth/login", { email: account.email, password: "not the password" });
    const unknown = await client(handle).post("/auth/login", { email: "nobody@example.com", password: "not the password" });
    assert.deepEqual([wrong.status, wrong.body], [unknown.status, unknown.body]);
    assert.equal(wrong.status, 401);
    assert.equal(wrong.setCookie, undefined);
    const ok = await client(handle).post("/auth/login", { email: "ada@example.com", password: account.password });
    assert.equal(ok.status, 200);
  });
  it("locks sign-in for a while after five wrong passwords, even for the right one", async () => {
    const handle = server();
    await client(handle).post("/auth/signup", account);
    const browser = client(handle, { ip: "198.51.100.9" });
    for (let i = 0; i < 5; i++) assert.equal((await browser.post("/auth/login", { email: account.email, password: "wrong password" })).status, 401);
    const locked = await browser.post("/auth/login", { email: account.email, password: account.password });
    assert.equal(locked.status, 429);
    assert.equal(locked.headers["Retry-After"], "900");
  });
  it("signs out, and a stolen or made-up cookie is not a session", async () => {
    const browser = client(server());
    await browser.post("/auth/signup", account);
    const old = browser.cookie();
    const out = await browser.post("/auth/logout");
    assert.match(out.setCookie, /Max-Age=0/);
    assert.equal((await browser.get("/auth/me")).body.user, null);
    browser.setCookie(old);
    assert.equal((await browser.get("/auth/me")).body.user, null, "the session was deleted on the server, not just in the browser");
    browser.setCookie("__Host-orion_session=made-up");
    assert.equal((await browser.get("/auth/me")).body.user, null);
  });
  it("uses a plain cookie name on localhost, where there is no HTTPS", async () => {
    const created = await client(server(), { host: "localhost:3001" }).post("/auth/signup", account);
    assert.match(created.setCookie, /^orion_session=/);
    assert.doesNotMatch(created.setCookie, /Secure/);
  });
  it("can be invite-only", async () => {
    const handle = server({ ORION_BETA_INVITE_CODES: "aurora, Dawn-26" });
    assert.equal((await client(handle).get("/auth/config")).body.inviteRequired, true);
    assert.equal((await client(handle).post("/auth/signup", account)).body.code, "invite_required");
    assert.equal((await client(handle).post("/auth/signup", { ...account, inviteCode: "nope" })).status, 403);
    assert.equal((await client(handle).post("/auth/signup", { ...account, inviteCode: "DAWN-26" })).status, 201);
  });
  it("limits how many accounts one network can create", async () => {
    const handle = server();
    for (let i = 0; i < 5; i++) assert.equal((await client(handle).post("/auth/signup", { ...account, username: `person${i}`, email: `p${i}@example.com` })).status, 201);
    assert.equal((await client(handle).post("/auth/signup", { ...account, username: "person6", email: "p6@example.com" })).status, 429);
  });
});

describe("recovery and deletion", () => {
  it("resets the password with the recovery code, signs other devices out, and issues a new code", async () => {
    const handle = server();
    const laptop = client(handle);
    const { body: { recoveryCode } } = await laptop.post("/auth/signup", account);
    const phone = client(handle);
    const wrong = await phone.post("/auth/recover", { email: account.email, recoveryCode: "AAAAA-AAAAA-AAAAA-AAAAA", newPassword: "another long password" });
    assert.equal(wrong.status, 401);
    const weak = await phone.post("/auth/recover", { email: account.email, recoveryCode, newPassword: "short" });
    assert.equal(weak.body.code, "weak_password");
    const reset = await phone.post("/auth/recover", { email: account.email, recoveryCode: recoveryCode.toLowerCase().replaceAll("-", " "), newPassword: "another long password" });
    assert.equal(reset.status, 200);
    assert.notEqual(reset.body.recoveryCode, recoveryCode);
    assert.equal((await phone.get("/auth/me")).body.user.email, "ada@example.com");
    assert.equal((await laptop.get("/auth/me")).body.user, null, "the old session ended with the old password");
    assert.equal((await client(handle).post("/auth/login", { email: account.email, password: account.password })).status, 401);
    assert.equal((await client(handle).post("/auth/login", { email: account.email, password: "another long password" })).status, 200);
    assert.equal((await client(handle).post("/auth/recover", { email: account.email, recoveryCode, newPassword: "a third long password" })).status, 401, "a used code is dead");
  });
  it("deletes the account and its backup after checking the password", async () => {
    const handle = server();
    const browser = client(handle);
    await browser.post("/auth/signup", account);
    await browser.post("/account/backup", { data: { app: "orion", version: 1, exportedAt: "2026-10-04T00:00:00Z", tables: { decisions: [{ id: "d1" }] } } });
    assert.equal((await browser.post("/auth/delete", { password: "wrong password" })).status, 401);
    assert.equal((await browser.post("/auth/delete", { password: account.password })).status, 200);
    assert.equal((await browser.get("/auth/me")).body.user, null);
    assert.equal((await client(handle).post("/auth/login", account)).status, 401);
    const reborn = client(handle);
    assert.equal((await reborn.post("/auth/signup", account)).status, 201);
    assert.equal((await reborn.get("/account/backup")).body.data, null, "a new account with the same email does not inherit the old backup");
  });
});

describe("backup, feedback and crash reports", () => {
  const data = { app: "orion", version: 1, exportedAt: "2026-10-04T00:00:00Z", tables: { decisions: [{ id: "d1", title: "Cook or order" }] } };
  it("keeps one backup per account, for that account only", async () => {
    const handle = server();
    const ada = client(handle), bob = client(handle), guest = client(handle);
    await ada.post("/auth/signup", account);
    await bob.post("/auth/signup", { ...account, username: "bob", email: "bob@example.com" });
    assert.equal((await guest.post("/account/backup", { data })).status, 401);
    assert.equal((await guest.get("/account/backup")).status, 401);
    assert.equal((await ada.post("/account/backup", { data })).status, 200);
    assert.deepEqual((await ada.get("/account/backup")).body.data, data);
    assert.equal((await bob.get("/account/backup")).body.data, null);
    assert.equal((await ada.post("/account/backup", { data: { nope: true } })).status, 400);
    const huge = { ...data, tables: { decisions: [{ id: "d", title: "x".repeat(400_000) }] } };
    assert.equal((await ada.post("/account/backup", { data: huge })).status, 413);
  });
  it("stores feedback with the account when signed in, and accepts crash reports", async () => {
    const store = memoryStore();
    const pushed = [];
    const push = store.push; store.push = async (key, value, cap) => { pushed.push(JSON.parse(value)); return push(key, value, cap); };
    const handle = handler({ env: {}, store, authCost: 1024 });
    const browser = client(handle);
    assert.equal((await browser.post("/feedback", { message: "The ranking chart is great", kind: "idea", page: "/" })).status, 401);
    const { body: { user } } = await browser.post("/auth/signup", account);
    await browser.post("/feedback", { message: "Sign-in worked first time", kind: "other" });
    assert.deepEqual(pushed.map((f) => f.user), [user.id]);
    assert.equal((await browser.post("/feedback", { message: "" })).status, 400);
    const error = console.error; console.error = () => {};
    try { assert.equal((await browser.post("/client-error", { message: "TypeError: x", page: "/history", version: "0.2.0" })).status, 204); } finally { console.error = error; }
  });
});

describe("accounts and the paid plan", () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_PRICE_ID: "price_123", ORION_LICENSE_SECRET: "x".repeat(40), ORION_FREE_DAILY: "1" };
  const stripe = (status = "active") => async (url) => String(url).includes("/checkout/sessions/")
    ? Response.json({ status: "complete", mode: "subscription", payment_status: "paid", customer: "cus_1", subscription: "sub_1" })
    : Response.json({ status });
  it("attaches a subscription to the account and hands the licence to another device", async () => {
    const store = memoryStore();
    const handle = handler({ env, store, authCost: 1024, fetchImpl: stripe() });
    const laptop = client(handle);
    await laptop.post("/auth/signup", account);
    assert.equal((await laptop.get("/auth/me")).body.user.pro, false);
    assert.equal((await laptop.post("/billing/activate", { sessionId: "cs_test_1" })).status, 200);
    const phone = client(handle);
    await phone.post("/auth/login", account);
    const me = await phone.get("/auth/me");
    assert.equal(me.body.user.pro, true);
    assert.ok(me.body.licence.token.startsWith("v1."));
    const cancelled = client(handler({ env, store, authCost: 1024, fetchImpl: stripe("canceled") }));
    await cancelled.post("/auth/login", account);
    assert.deepEqual([(await cancelled.get("/auth/me")).body.user.pro, (await cancelled.get("/auth/me")).body.licence], [false, null]);
  });
  it("remembers a one-decision pass on the account and hands it to another device", async () => {
    const passEnv = { ...env, STRIPE_PRICE_ID: undefined, STRIPE_PRICE_PASS: "price_pass" };
    const fetchImpl = async () => Response.json({ status: "complete", mode: "payment", payment_status: "paid", customer: "cus_1", metadata: { decision: "dec_abc_1" } });
    const handle = handler({ env: passEnv, store: memoryStore(), authCost: 1024, fetchImpl });
    const laptop = client(handle);
    await laptop.post("/auth/signup", account);
    assert.deepEqual((await laptop.get("/auth/me")).body.passes, []);
    assert.equal((await laptop.post("/billing/activate", { sessionId: "cs_pass" })).body.pass.decisionId, "dec_abc_1");
    await laptop.post("/billing/activate", { sessionId: "cs_pass" });
    const phone = client(handle);
    await phone.post("/auth/login", account);
    const { passes, user } = (await phone.get("/auth/me")).body;
    assert.deepEqual(passes.map((p) => p.decisionId), ["dec_abc_1"], "once, however many times it was activated");
    assert.ok(passes[0].token.startsWith("p1."));
    assert.equal(user.pro, false, "a pass is not a subscription");
  });
});

describe("ORION is for people who are signed in", () => {
  const scoreInput = { context: "Cook or order food?", stakes: "small", options: [{ id: "a", label: "Cook" }, { id: "b", label: "Order" }], factors: [{ id: "f", label: "Cost" }] };
  it("answers the decision routes only with a session, and says so in a way the app can act on", async () => {
    // Guest tries off: everything needs a session.
    const handle = server({ ORION_GUEST_DECISIONS: "0" });
    const guest = client(handle);
    for (const [path, body] of [["/decision/parse", { input: "Cook or order food?" }], ["/decision/score-factors", scoreInput], ["/decision/triage", { context: "Cook or order?", candidates: ["Cost or time?"], budget: 1 }], ["/decision/explain", {}]]) {
      const refused = await guest.post(path, body);
      assert.deepEqual([refused.status, refused.body.code], [401, "signed_out"], path);
    }
    await guest.post("/auth/signup", account);
    assert.equal((await guest.post("/decision/parse", { input: "Cook or order food?" })).status, 200);
    await guest.post("/auth/logout");
    assert.equal((await guest.post("/decision/parse", { input: "Cook or order food?" })).status, 401);
  });
  it("stays open when the server has no accounts at all", async () => {
    assert.equal((await client(handler({ env: {}, store: null })).post("/decision/parse", { input: "Cook or order food?" })).status, 200);
  });
  it("does not let an old cookie open a new account made with the same email", async () => {
    const handle = server();
    const old = client(handle);
    await old.post("/auth/signup", account);
    const stolen = old.cookie();
    await old.post("/auth/delete", { password: account.password });
    const fresh = client(handle);
    await fresh.post("/auth/signup", account);
    const thief = client(handle);
    thief.setCookie(stolen);
    assert.equal((await thief.get("/auth/me")).body.user, null);
    assert.equal((await thief.get("/account/backup")).status, 401);
  });
  it("gives a purchase to the account that made it and to no other", async () => {
    const env = { STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_PRICE_ID: "price_123", ORION_LICENSE_SECRET: "x".repeat(40), ORION_FREE_DAILY: "1" };
    const fetchImpl = async (url) => String(url).includes("/checkout/sessions/")
      ? Response.json({ status: "complete", mode: "subscription", payment_status: "paid", customer: "cus_1", subscription: "sub_1" })
      : Response.json({ status: "active" });
    const handle = handler({ env, store: memoryStore(), authCost: 1024, fetchImpl });
    const ada = client(handle), bob = client(handle), guest = client(handle);
    await ada.post("/auth/signup", account);
    await bob.post("/auth/signup", { ...account, username: "bob", email: "bob@example.com" });
    assert.equal((await guest.post("/billing/activate", { sessionId: "cs_test_1" })).status, 401);
    const { body: licence } = await ada.post("/billing/activate", { sessionId: "cs_test_1" });
    assert.ok(licence.token.startsWith("v1."));
    assert.equal((await ada.post("/billing/activate", { sessionId: "cs_test_1" })).status, 200, "the buyer can activate again");
    assert.equal((await bob.post("/billing/activate", { sessionId: "cs_test_1" })).status, 409);
    assert.equal((await bob.get("/auth/me")).body.user.pro, false);
    // Ada's licence, copied to Bob's browser, renews nothing and opens nothing for him.
    assert.equal((await bob.post("/billing/refresh", { token: licence.token })).status, 401);
    assert.equal((await bob.post("/billing/portal", { token: licence.token })).status, 401);
    assert.equal((await ada.post("/billing/refresh", { token: licence.token })).status, 200);
  });
});

describe("telling clients apart behind a proxy", () => {
  const req = (forwarded) => ({ headers: forwarded ? { "x-forwarded-for": forwarded } : {}, socket: { remoteAddress: "10.0.0.1" } });
  it("ignores forwarded addresses unless a proxy is declared, and then takes the one the proxy wrote", () => {
    assert.equal(clientAddress(req("6.6.6.6"), 0), "10.0.0.1");
    assert.equal(clientAddress(req("203.0.113.9"), 1), "203.0.113.9");
    assert.equal(clientAddress(req("6.6.6.6, 203.0.113.9"), 1), "203.0.113.9", "a made-up first entry is not believed");
    assert.equal(clientAddress(req("6.6.6.6, 203.0.113.9, 10.0.0.2"), 2), "203.0.113.9");
    assert.equal(clientAddress(req(undefined), 1), "10.0.0.1");
  });
  it("lets the Expo dev server call a local API by default, and nothing foreign call a deployed one", async () => {
    const handle = server();
    const from = (host) => new Promise((resolve) => handle(
      { method: "GET", url: "/auth/config", headers: { host, origin: "http://localhost:8081" }, socket: {} },
      { writeHead(status) { this.status = status; }, end() { resolve(this.status); } }));
    assert.equal(await from("localhost:3001"), 200);
    assert.equal(await from("orion.example"), 403);
  });
});
