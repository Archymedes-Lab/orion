import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { handler } from "../server/index.ts";
import { memoryStore } from "../server/store.ts";
import { readLicence } from "../server/billing.ts";
import {
  PAYPACK_PERIOD_MS, checkPayment, paypackClient, paypackConfig, readTicket, recordWebhook, refreshPrepaid, rwandaNumber, startPayment, verifyPaypackSignature,
} from "../server/paypack.ts";
import { nudgedWeights } from "../src/decision-engine/expectedValue.ts";
import { invoke } from "./helpers/ai.js";

const env = {
  PAYPACK_CLIENT_ID: "app-id", PAYPACK_CLIENT_SECRET: "app-secret", PAYPACK_WEBHOOK_SECRET: "hook-secret",
  PAYPACK_PRICE_MONTHLY: "6500", PAYPACK_PRICE_PASS: "3000", ORION_LICENSE_SECRET: "x".repeat(40), ORION_ALLOWED_ORIGINS: "https://orion.example",
};
const config = paypackConfig(env);
const headers = { origin: "https://orion.example", host: "orion.example" };

/** Fake Paypack. `tx` is what /transactions/find answers; every call is recorded. */
function paypack(tx = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = String(url).replace("https://payments.paypack.rw/api", "");
    calls.push({ path, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (path === "/auth/agents/authorize") return Response.json({ access: "tok-1", refresh: "r", expires: 900 });
    if (path === "/transactions/cashin") return Response.json({ amount: JSON.parse(init.body).amount, created_at: "2026-10-09T20:00:00Z", kind: "CASHIN", ref: "ref-1", status: "pending" });
    if (path === "/transactions/find/ref-1") return Response.json({ amount: 6500, client: "0781234567", fee: 150, kind: "CASHIN", merchant: "M", ref: "ref-1", status: "successful", timestamp: "2026-10-09T20:01:00Z", ...tx });
    return new Response("{}", { status: 404 });
  };
  return { calls, fetchImpl, client: paypackClient(config, { fetchImpl }) };
}
const sign = (raw, secret = "hook-secret") => createHmac("sha256", secret).update(raw).digest("base64");
/** Signs up on `handle` and returns request headers that carry the session, as a signed-in browser would. */
const signedIn = (handle) => new Promise((resolve, reject) => {
  const req = Readable.from([JSON.stringify({ username: "ada", email: "ada@example.com", password: "correct horse battery", acceptTerms: true })]);
  Object.assign(req, { method: "POST", url: "/auth/signup", headers }, { socket: { remoteAddress: "203.0.113.5" } });
  const res = { writeHead(status, h = {}) { this.h = h; }, end() { resolve({ ...headers, cookie: String(this.h["Set-Cookie"] ?? "").split(";")[0] }); } };
  handle(req, res).catch(reject);
});
const head = (handle, path) => new Promise((resolve, reject) => {
  const req = { url: path, method: "HEAD", headers: {}, on() {} };
  const res = { writeHead(status) { this.status = status; }, end() { resolve({ status: this.status }); }, setHeader() {} };
  handle(req, res).catch(reject);
});

describe("Paypack configuration", () => {
  it("is off without keys and refuses a half-finished setup", () => {
    assert.equal(paypackConfig({}), null);
    assert.throws(() => paypackConfig({ PAYPACK_CLIENT_ID: "a" }), /PAYPACK_CLIENT_SECRET/);
    assert.throws(() => paypackConfig({ ...env, PAYPACK_PRICE_MONTHLY: "65.5" }), /whole number/);
    assert.throws(() => paypackConfig({ ...env, ORION_LICENSE_SECRET: "short" }), /ORION_LICENSE_SECRET/);
    assert.throws(() => paypackConfig({ ...env, PAYPACK_MODE: "test" }), /PAYPACK_MODE/);
    assert.deepEqual(config.prices, { monthly: 6500, pass: 3000 });
    assert.equal(config.mode, "production");
  });
  it("reads Rwandan MTN and Airtel numbers the ways people type them", () => {
    assert.equal(rwandaNumber("078 123 4567"), "0781234567");
    assert.equal(rwandaNumber("+250 78 123 4567"), "0781234567");
    assert.equal(rwandaNumber("250731234567"), "0731234567");
    assert.equal(rwandaNumber("0721234567"), "0721234567");
    assert.equal(rwandaNumber("0771234567"), null);
    assert.equal(rwandaNumber("12345"), null);
  });
});

describe("paying with mobile money", () => {
  it("charges the number for the plan's price and hands back a ticket for that exact payment", async () => {
    const { calls, client } = paypack();
    const started = await startPayment(config, client, { plan: "monthly", phone: "+250 78 123 4567" }, 1_000);
    const cashin = calls.find((c) => c.path === "/transactions/cashin");
    assert.deepEqual(cashin.body, { amount: 6500, number: "0781234567" });
    assert.equal(cashin.headers.Authorization, "Bearer tok-1");
    assert.equal(cashin.headers["X-Webhook-Mode"], "production");
    assert.match(cashin.headers["Idempotency-Key"], /^[0-9a-f]{32}$/);
    assert.deepEqual(readTicket(config, started.ticket), { ref: "ref-1", plan: "monthly", amt: 6500, iat: 1_000 });
    assert.equal(readTicket({ licenceSecret: "y".repeat(40) }, started.ticket), null);
  });
  it("refuses a bad number, an unpriced plan, and a pass without a decision before calling Paypack", async () => {
    const { calls, client } = paypack();
    await assert.rejects(startPayment(config, client, { plan: "monthly", phone: "0771234567" }), /MTN or Airtel/);
    await assert.rejects(startPayment(config, client, { plan: "yearly", phone: "0781234567" }), /not on sale/);
    await assert.rejects(startPayment(config, client, { plan: "pass", phone: "0781234567" }), /one decision/);
    assert.equal(calls.length, 0);
  });
  it("turns a successful payment into a licence for the paid period, counted from when it started", async () => {
    const { client } = paypack();
    const { ticket } = await startPayment(config, client, { plan: "monthly", phone: "0781234567" }, 1_000);
    const paid = await checkPayment(config, client, ticket, null, 5_000);
    assert.equal(paid.status, "paid");
    assert.equal(paid.until, 1_000 + PAYPACK_PERIOD_MS.monthly);
    const licence = readLicence(config, paid.token, { now: 5_000 });
    assert.equal(licence.until, paid.until);
    // Checking the same ticket later buys no extra time.
    const again = await checkPayment(config, client, ticket, null, 6 * 86_400_000);
    assert.equal(again.until, paid.until);
    // After a week the ticket itself is refused.
    await assert.rejects(checkPayment(config, client, ticket, null, 8 * 86_400_000), /too old/);
  });
  it("issues a pass for one decision", async () => {
    const { client } = paypack({ amount: 3000 });
    const { ticket } = await startPayment(config, client, { plan: "pass", phone: "0781234567", decisionId: "d-1" });
    const paid = await checkPayment(config, client, ticket, null);
    assert.equal(paid.status, "paid");
    assert.equal(paid.pass.decisionId, "d-1");
  });
  it("reports pending and failed, and refuses a payment that does not match the ticket", async () => {
    const start = async (tx) => { const p = paypack(tx); return { p, ticket: (await startPayment(config, p.client, { plan: "monthly", phone: "0781234567" })).ticket }; };
    let { p, ticket } = await start({ status: "pending" });
    assert.deepEqual(await checkPayment(config, p.client, ticket, null), { status: "pending" });
    ({ p, ticket } = await start({ status: "failed" }));
    assert.deepEqual(await checkPayment(config, p.client, ticket, null), { status: "failed" });
    ({ p, ticket } = await start({ amount: 100 }));
    await assert.rejects(checkPayment(config, p.client, ticket, null), /does not match/);
    ({ p, ticket } = await start({ kind: "CASHOUT" }));
    await assert.rejects(checkPayment(config, p.client, ticket, null), /does not match/);
    await assert.rejects(checkPayment(config, p.client, `${ticket}x`, null), /not valid/);
  });
  it("renews a prepaid licence by itself until the period ends", async () => {
    const { client } = paypack();
    const { ticket } = await startPayment(config, client, { plan: "monthly", phone: "0781234567" }, 1_000);
    const paid = await checkPayment(config, client, ticket, null, 2_000);
    const renewed = refreshPrepaid(config, paid.token, 2 * 86_400_000);
    assert.ok(renewed.expiresAt > 2 * 86_400_000 && renewed.expiresAt <= paid.until);
    assert.throws(() => refreshPrepaid(config, paid.token, paid.until + 1), /ended/);
  });
  it("gets a fresh token once when Paypack says the current one expired", async () => {
    let authorized = 0, first = true;
    const fetchImpl = async (url, init) => {
      const path = String(url).replace("https://payments.paypack.rw/api", "");
      if (path === "/auth/agents/authorize") { authorized++; return Response.json({ access: `tok-${authorized}` }); }
      if (first) { first = false; return new Response("{}", { status: 401 }); }
      return Response.json({ amount: JSON.parse(init.body).amount, kind: "CASHIN", ref: "ref-9", status: "pending" });
    };
    const started = await startPayment(config, paypackClient(config, { fetchImpl }), { plan: "monthly", phone: "0781234567" });
    assert.equal(readTicket(config, started.ticket).ref, "ref-9");
    assert.equal(authorized, 2);
  });
});

describe("Paypack webhook", () => {
  const event = JSON.stringify({ event_id: "e1", kind: "transaction:processed", created_at: "2026-10-09T20:01:00Z",
    data: { ref: "ref-1", kind: "CASHIN", fee: 150, merchant: "M", client: "0781234567", amount: 6500, provider: "mtn", status: "successful", created_at: "x", processed_at: "y" } });
  it("checks the signature over the raw body", () => {
    assert.equal(verifyPaypackSignature("hook-secret", event, sign(event)), true);
    assert.equal(verifyPaypackSignature("hook-secret", `${event} `, sign(event)), false);
    assert.equal(verifyPaypackSignature("hook-secret", event, sign(event, "other")), false);
    assert.equal(verifyPaypackSignature("hook-secret", event, undefined), false);
  });
  it("records the outcome without the customer's number", async () => {
    const store = memoryStore();
    assert.deepEqual(await recordWebhook(store, event), { ref: "ref-1", status: "successful", kind: "CASHIN", recorded: true });
    const saved = await store.get("paypack:tx:ref-1");
    assert.ok(saved && !saved.includes("0781234567"));
    assert.equal(await recordWebhook(store, "not json"), null);
  });
  it("answers Paypack's HEAD ping, rejects a bad signature, and lets a status check use what the webhook recorded", async () => {
    const store = memoryStore();
    const fake = paypack({ status: "pending" });
    const handle = handler({ env, store, fetchImpl: fake.fetchImpl, authCost: 1024 });
    // A store turns accounts on, and a licence renews only for the account that bought it.
    const ada = await signedIn(handle);
    assert.equal((await head(handle, "/billing/paypack/webhook")).status, 200);
    assert.equal((await invoke(handle, "/billing/paypack/webhook", event, { "x-paypack-signature": "wrong" })).status, 401);
    const started = await invoke(handle, "/billing/paypack/start", { plan: "monthly", phone: "0781234567" }, ada);
    assert.equal(started.status, 200);
    // Paypack's own API still says pending; the signed webhook says it went through.
    assert.equal((await invoke(handle, "/billing/paypack/status", { ticket: started.body.ticket }, ada)).body.status, "pending");
    assert.equal((await invoke(handle, "/billing/paypack/webhook", event, { "x-paypack-signature": sign(event) })).status, 200);
    const paid = await invoke(handle, "/billing/paypack/status", { ticket: started.body.ticket }, ada);
    assert.equal(paid.body.status, "paid");
    // The licence it bought renews through the usual route, with no Stripe configured at all.
    const renewed = await invoke(handle, "/billing/refresh", { token: paid.body.token }, ada);
    assert.equal(renewed.status, 200);
    assert.equal(renewed.body.until, paid.body.until);
  });
  it("is off, with the rest of mobile money, when Paypack is not configured", async () => {
    const handle = handler({ env: {}, store: memoryStore() });
    assert.equal((await head(handle, "/billing/paypack/webhook")).status, 404);
    assert.equal((await invoke(handle, "/billing/paypack/start", { plan: "monthly", phone: "0781234567" }, headers)).status, 404);
  });
  it("offers mobile money prices on the plan route", async () => {
    const handle = handler({ env, store: memoryStore(), fetchImpl: paypack().fetchImpl });
    const req = { url: "/billing/plan", method: "GET", headers, on() {} };
    const plan = await new Promise((resolve) => handle(req, { writeHead(s) { this.s = s; }, end(b) { resolve(JSON.parse(b)); }, setHeader() {} }));
    assert.equal(plan.enabled, true);
    assert.deepEqual(plan.mobileMoney.prices.monthly, { amount: 6500, currency: "rwf", interval: "month" });
  });
});

describe("what matters more or less", () => {
  const factors = [{ id: "a", label: "Cost", weight: 0.5 }, { id: "b", label: "Growth", weight: 0.5 }];
  it("moves one factor's weight and keeps the total at one", () => {
    const more = nudgedWeights(factors, "b", "more");
    assert.ok(more[1].weight > 0.6);
    assert.ok(Math.abs(more[0].weight + more[1].weight - 1) < 1e-9);
    const less = nudgedWeights(factors, "b", "less");
    assert.ok(less[1].weight < 0.4);
  });
  it("never drops a factor to nothing and ignores unknown ids", () => {
    let w = factors;
    for (let i = 0; i < 30; i++) w = nudgedWeights(w, "a", "less");
    assert.ok(w[0].weight > 0);
    assert.deepEqual(nudgedWeights(factors, "zzz", "more"), factors);
  });
});
