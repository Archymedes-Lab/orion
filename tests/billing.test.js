import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../server/index.ts";
import { billingConfig, dailyQuota, issueLicence, issuePass, priceReader, readLicence, readPass } from "../server/billing.ts";
import { PAID_FEATURES, PLANS, canUse } from "../src/billing/plans.ts";
import { invoke, scoreInput, scoresFor, openaiResponse } from "./helpers/ai.js";

const env = {
  STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_PRICE_ID: "price_123", ORION_LICENSE_SECRET: "x".repeat(40),
  ORION_FREE_DAILY: "1", OPENAI_API_KEY: "test-openai", ORION_ALLOWED_ORIGINS: "https://orion.example",
};
const config = billingConfig(env);
const headers = { origin: "https://orion.example", host: "orion.example" };

/** Fake Stripe + fake scoring provider. Records every Stripe call. */
function world(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (!String(url).startsWith("https://api.stripe.com/")) return openaiResponse({ scores: scoresFor(scoreInput) });
    const path = String(url).replace("https://api.stripe.com/v1", "");
    calls.push({ path, method: init.method, body: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null, auth: init.headers.Authorization });
    const reply = overrides[path] ?? {
      "/checkout/sessions": { url: "https://checkout.stripe.com/c/pay/cs_test_1" },
      "/checkout/sessions/cs_test_1": { status: "complete", mode: "subscription", payment_status: "paid", customer: "cus_1", subscription: "sub_1" },
      "/subscriptions/sub_1": { status: "active" },
      "/billing_portal/sessions": { url: "https://billing.stripe.com/p/session/1" },
      "/prices/price_123": { unit_amount: 600, currency: "usd", recurring: { interval: "month" } },
    }[path];
    return reply ? Response.json(reply) : new Response("{}", { status: 404 });
  };
  return { calls, handle: handler({ env, fetchImpl }) };
}

describe("billing configuration", () => {
  it("is off without Stripe keys and refuses a half-finished setup", () => {
    assert.equal(billingConfig({}), null);
    assert.throws(() => billingConfig({ STRIPE_SECRET_KEY: "sk_test_abc" }), /both/);
    assert.throws(() => billingConfig({ ...env, STRIPE_SECRET_KEY: "pk_test_abc" }), /secret/);
    assert.throws(() => billingConfig({ ...env, ORION_LICENSE_SECRET: "short" }), /ORION_LICENSE_SECRET/);
    assert.throws(() => billingConfig({ ...env, ORION_FREE_DAILY: "-1" }), /ORION_FREE_DAILY/);
    assert.equal(config.freeDaily, 1);
  });
  it("answers 404 on billing routes and limits nothing when Stripe is not set up", async () => {
    const handle = handler({ env: { OPENAI_API_KEY: "k" }, fetchImpl: async () => openaiResponse({ scores: scoresFor(scoreInput) }) });
    assert.equal((await invoke(handle, "/billing/checkout", {})).status, 404);
    for (let i = 0; i < 3; i++) assert.equal((await invoke(handle, "/decision/score-factors", scoreInput)).status, 200);
  });
});

describe("licences", () => {
  it("accepts its own signature and rejects tampering, other secrets and expiry", () => {
    const { token, expiresAt } = issueLicence(config, "sub_1", "cus_1", 1_000);
    assert.deepEqual(readLicence(config, token, { now: 2_000 }), { subscription: "sub_1", customer: "cus_1", expiresAt });
    const [v, payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "sub_1", cus: "cus_1", exp: 9e15 })).toString("base64url");
    assert.equal(readLicence(config, `${v}.${forged}.${sig}`), null);
    assert.equal(readLicence(config, `${v}.${payload}.${sig.slice(0, -2)}xx`), null);
    assert.equal(readLicence({ ...config, licenceSecret: "y".repeat(40) }, token, { now: 2_000 }), null);
    assert.equal(readLicence(config, token, { now: expiresAt + 1 }), null);
    assert.ok(readLicence(config, token, { now: expiresAt + 1, allowExpired: true }));
    for (const junk of [undefined, "", "v1..", "a.b.c.d", 42]) assert.equal(readLicence(config, junk), null);
  });
});

describe("checkout, activation and renewal", () => {
  it("creates a subscription checkout that returns to the app", async () => {
    const { calls, handle } = world();
    const res = await invoke(handle, "/billing/checkout", {}, headers);
    assert.equal(res.status, 200);
    assert.equal(res.body.url, "https://checkout.stripe.com/c/pay/cs_test_1");
    assert.equal(calls[0].auth, "Bearer sk_test_abc");
    assert.equal(calls[0].body.mode, "subscription");
    assert.equal(calls[0].body["line_items[0][price]"], "price_123");
    assert.equal(calls[0].body.success_url, "https://orion.example/you?checkout={CHECKOUT_SESSION_ID}");
  });
  it("needs a return address when the request has no origin", async () => {
    assert.equal((await invoke(world().handle, "/billing/checkout", {})).status, 400);
  });
  it("turns a completed checkout into a licence, and refuses an unpaid one", async () => {
    const paid = await invoke(world().handle, "/billing/activate", { sessionId: "cs_test_1" });
    assert.equal(paid.status, 200);
    assert.equal(readLicence(config, paid.body.token).customer, "cus_1");
    const open = world({ "/checkout/sessions/cs_test_1": { status: "open", mode: "subscription", payment_status: "unpaid", customer: null, subscription: null } });
    assert.equal((await invoke(open.handle, "/billing/activate", { sessionId: "cs_test_1" })).status, 402);
    assert.equal((await invoke(world().handle, "/billing/activate", { sessionId: "cs_unknown" })).status, 404);
    assert.equal((await invoke(world().handle, "/billing/activate", { sessionId: "../prices/price_123" })).status, 400);
  });
  it("renews only while Stripe reports the subscription as active", async () => {
    const { token } = issueLicence(config, "sub_1", "cus_1", 0); // long expired
    const renewed = await invoke(world().handle, "/billing/refresh", { token });
    assert.equal(renewed.status, 200);
    assert.ok(readLicence(config, renewed.body.token));
    const cancelled = world({ "/subscriptions/sub_1": { status: "canceled" } });
    assert.equal((await invoke(cancelled.handle, "/billing/refresh", { token })).status, 402);
    assert.equal((await invoke(world().handle, "/billing/refresh", { token: "v1.bad.token" })).status, 401);
  });
  it("opens the billing portal for the licence's own customer", async () => {
    const { calls, handle } = world();
    const { token } = issueLicence(config, "sub_1", "cus_1");
    const res = await invoke(handle, "/billing/portal", { token }, headers);
    assert.equal(res.body.url, "https://billing.stripe.com/p/session/1");
    assert.equal(calls[0].body.customer, "cus_1");
    assert.equal(calls[0].body.return_url, "https://orion.example/you");
  });
  it("does not pass Stripe error details to the caller", async () => {
    const handle = handler({ env, fetchImpl: async () => new Response(JSON.stringify({ error: { message: "No such price: sk_test_abc" } }), { status: 400 }) });
    const res = await invoke(handle, "/billing/checkout", {}, headers);
    assert.equal(res.status, 502);
    assert.doesNotMatch(JSON.stringify(res.body), /sk_test|No such/);
  });
});

describe("free quota", () => {
  it("counts scored decisions per client and stops at the daily limit; subscribers are not counted", async () => {
    const { handle } = world();
    assert.equal((await invoke(handle, "/decision/score-factors", scoreInput)).status, 200);
    const blocked = await invoke(handle, "/decision/score-factors", scoreInput);
    assert.equal(blocked.status, 402);
    assert.equal(blocked.body.upgrade, true);
    const { token } = issueLicence(config, "sub_1", "cus_1");
    for (let i = 0; i < 3; i++) {
      assert.equal((await invoke(handle, "/decision/score-factors", scoreInput, { authorization: `Bearer ${token}` })).status, 200);
    }
    const expired = issueLicence(config, "sub_1", "cus_1", 0).token;
    assert.equal((await invoke(handle, "/decision/score-factors", scoreInput, { authorization: `Bearer ${expired}` })).status, 402);
    // Parsing stays available: the app falls back to its quick questions.
    assert.equal((await invoke(handle, "/decision/parse", { input: "Cook or order food?" })).status, 200);
  });
  it("does not charge the quota when scoring fails", async () => {
    let fail = true;
    const handle = handler({ env, fetchImpl: async () => fail ? new Response("{}", { status: 500 }) : openaiResponse({ scores: scoresFor(scoreInput) }) });
    assert.equal((await invoke(handle, "/decision/score-factors", scoreInput)).status, 503);
    fail = false;
    assert.equal((await invoke(handle, "/decision/score-factors", scoreInput)).status, 200);
  });
  it("starts again on a new day", () => {
    let now = Date.parse("2026-10-03T23:59:00Z");
    const quota = dailyQuota(2, () => now);
    quota.spend("a"); quota.spend("a");
    assert.equal(quota.remaining("a"), 0);
    assert.equal(quota.remaining("b"), 2);
    now = Date.parse("2026-10-04T00:01:00Z");
    assert.equal(quota.remaining("a"), 2);
  });
  it("reads the price from Stripe once and caches it", async () => {
    let calls = 0;
    const read = priceReader(config, { fetchImpl: async () => { calls++; return Response.json({ unit_amount: 600, currency: "usd", recurring: { interval: "month" } }); } });
    assert.deepEqual(await read(), { yearly: { amount: 600, currency: "usd", interval: "month" } });
    await read();
    assert.equal(calls, 1);
  });
});

describe("plan on the device", () => {
  it("formats prices in the currency's own units and only trusts Stripe addresses", async () => {
    const { formatPrice, stripeUrl, licenceHeader } = await import("../src/billing/plan.ts");
    assert.equal(formatPrice({ amount: 600, currency: "usd", interval: "month" }, "en-US"), "$6.00 / month");
    assert.match(formatPrice({ amount: 5000, currency: "rwf", interval: "year" }, "en-US"), /5,000 \/ year$/);
    assert.equal(stripeUrl({ url: "https://checkout.stripe.com/c/pay/cs_1" }), "https://checkout.stripe.com/c/pay/cs_1");
    for (const url of ["https://evil.example/stripe.com/", "https://stripe.com.evil.example/", "javascript:alert(1)", undefined]) {
      assert.equal(stripeUrl({ url }), null);
    }
    assert.deepEqual(licenceHeader(), {});
  });
});

describe("plans: yearly, monthly and a one-decision pass", () => {
  const plansEnv = { ...env, STRIPE_PRICE_ID: undefined, STRIPE_PRICE_YEARLY: "price_year", STRIPE_PRICE_MONTHLY: "price_month", STRIPE_PRICE_PASS: "price_pass", ORION_FREE_DAILY: undefined };
  const plansConfig = billingConfig(plansEnv);
  function shop(overrides = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      if (!String(url).startsWith("https://api.stripe.com/")) return openaiResponse({ scores: scoresFor(scoreInput) });
      const path = String(url).replace("https://api.stripe.com/v1", "");
      calls.push({ path, body: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null });
      const reply = overrides[path] ?? {
        "/checkout/sessions": { url: "https://checkout.stripe.com/c/pay/cs_test_2" },
        "/checkout/sessions/cs_pass": { status: "complete", mode: "payment", payment_status: "paid", customer: "cus_1", subscription: null, metadata: { decision: "dec_abc_1" } },
        "/prices/price_year": { unit_amount: 2999, currency: "usd", recurring: { interval: "year" } },
        "/prices/price_month": { unit_amount: 499, currency: "usd", recurring: { interval: "month" } },
        "/prices/price_pass": { unit_amount: 499, currency: "usd", recurring: null },
      }[path];
      return reply ? Response.json(reply) : new Response("{}", { status: 404 });
    };
    return { calls, handle: handler({ env: plansEnv, fetchImpl }) };
  }

  it("reads the plans from the environment, with the old single price still meaning yearly", () => {
    assert.deepEqual(plansConfig.prices, { yearly: "price_year", monthly: "price_month", pass: "price_pass" });
    assert.deepEqual(config.prices, { yearly: "price_123" });
    assert.equal(plansConfig.freeDaily, null, "no cap on decisions unless one is set");
    assert.throws(() => billingConfig({ ...plansEnv, STRIPE_PRICE_PASS: "prod_123" }), /price ids/);
    assert.throws(() => billingConfig({ STRIPE_SECRET_KEY: "sk_test_abc" }), /at least one price/);
  });
  it("does not limit how many decisions a free user can have scored", async () => {
    const { handle } = shop();
    for (let i = 0; i < 6; i++) assert.equal((await invoke(handle, "/decision/score-factors", scoreInput)).status, 200);
  });
  it("reports what each plan costs", async () => {
    const { handle } = shop();
    const plan = await new Promise((resolve) => handle({ method: "GET", url: "/billing/plan", headers: {} }, { writeHead() {}, end: (body) => resolve(JSON.parse(body)) }));
    assert.equal(plan.enabled, true);
    assert.equal(plan.freeDaily, null);
    assert.deepEqual(plan.prices.yearly, { amount: 2999, currency: "usd", interval: "year" });
    assert.deepEqual(plan.prices.pass, { amount: 499, currency: "usd", interval: null });
  });
  it("checks out each plan with the right price and mode", async () => {
    const { calls, handle } = shop();
    await invoke(handle, "/billing/checkout", {}, headers);
    await invoke(handle, "/billing/checkout", { plan: "monthly" }, headers);
    await invoke(handle, "/billing/checkout", { plan: "pass", decisionId: "dec_abc_1" }, headers);
    assert.deepEqual(calls.map((c) => [c.body.mode, c.body["line_items[0][price]"]]), [["subscription", "price_year"], ["subscription", "price_month"], ["payment", "price_pass"]]);
    assert.equal(calls[2].body["metadata[decision]"], "dec_abc_1");
    assert.equal((await invoke(handle, "/billing/checkout", { plan: "pass" }, headers)).status, 400, "a pass needs a decision");
    assert.equal((await invoke(handle, "/billing/checkout", { plan: "lifetime" }, headers)).status, 400);
    assert.equal((await invoke(handle, "/billing/checkout", { plan: "pass", decisionId: "../x" }, headers)).status, 400);
    const yearlyOnly = handler({ env, fetchImpl: async () => Response.json({ url: "https://checkout.stripe.com/x" }) });
    assert.equal((await invoke(yearlyOnly, "/billing/checkout", { plan: "pass", decisionId: "dec_1" }, headers)).status, 400, "a plan that is not on sale");
  });
  it("turns a paid pass into proof for that one decision, which cannot be forged or moved", async () => {
    const { handle } = shop();
    const res = await invoke(handle, "/billing/activate", { sessionId: "cs_pass" });
    assert.equal(res.status, 200);
    assert.equal(res.body.pass.decisionId, "dec_abc_1");
    assert.equal(readPass(plansConfig, res.body.pass.token), "dec_abc_1");
    const [v, , sig] = res.body.pass.token.split(".");
    const other = Buffer.from(JSON.stringify({ dec: "dec_other" })).toString("base64url");
    assert.equal(readPass(plansConfig, `${v}.${other}.${sig}`), null);
    assert.equal(readPass({ ...plansConfig, licenceSecret: "y".repeat(40) }, res.body.pass.token), null);
    assert.equal(readLicence(plansConfig, res.body.pass.token), null, "a pass is not a subscription licence");
    assert.equal(readPass(plansConfig, issueLicence(plansConfig, "sub_1", "cus_1").token), null);
    const unpaid = shop({ "/checkout/sessions/cs_pass": { status: "open", mode: "payment", payment_status: "unpaid", metadata: { decision: "dec_abc_1" } } });
    assert.equal((await invoke(unpaid.handle, "/billing/activate", { sessionId: "cs_pass" })).status, 402);
    assert.equal(readPass(plansConfig, issuePass(plansConfig, "dec_abc_1")), "dec_abc_1");
  });
  it("opens paid features by entitlement: everything when billing is off, a pass only for its own decision", () => {
    const free = { billing: true, pro: false, passes: [] };
    assert.equal(canUse("deep_analysis", { billing: false, pro: false, passes: [] }, "d1"), true);
    assert.equal(canUse("deep_analysis", free, "d1"), false);
    assert.equal(canUse("deep_analysis", { ...free, pro: true }, "d1"), true);
    const passed = { ...free, passes: ["d1"] };
    assert.deepEqual([canUse("deep_analysis", passed, "d1"), canUse("choice_justification", passed, "d1"), canUse("deep_analysis", passed, "d2")], [true, true, false]);
    assert.equal(canUse("full_insights", passed, "d1"), false, "insights span every decision, so a pass does not open them");
    assert.equal(canUse("full_insights", { ...free, pro: true }), true);
  });
  it("keeps the plan definitions consistent", () => {
    assert.deepEqual(Object.keys(PLANS), ["yearly", "monthly", "pass"]);
    assert.equal(Object.values(PLANS).filter((p) => p.recommended).length, 1);
    assert.equal(PLANS.yearly.recommended, true);
    assert.ok(PLANS.yearly.suggestedUsd < PLANS.monthly.suggestedUsd * 12, "yearly is cheaper than twelve months");
    assert.equal(PAID_FEATURES.full_insights.inPass, false);
  });
});

describe("stripe webhook", async () => {
  const { createHmac } = await import("node:crypto");
  const { verifyStripeSignature, fulfilmentFrom } = await import("../server/billing.ts");
  const secret = "whsec_test";
  const sign = (raw, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
  const event = (object, type = "checkout.session.completed") => JSON.stringify({ type, data: { object } });
  const sub = { id: "cs_test_9", status: "complete", mode: "subscription", payment_status: "paid", customer: "cus_9", subscription: "sub_9", metadata: { account: "a@b.co" } };

  it("checks the signature and the age", () => {
    const raw = event(sub);
    assert.ok(verifyStripeSignature(secret, raw, sign(raw)));
    assert.ok(!verifyStripeSignature(secret, raw + " ", sign(raw)));
    assert.ok(!verifyStripeSignature("whsec_other", raw, sign(raw)));
    assert.ok(!verifyStripeSignature(secret, raw, sign(raw, Math.floor(Date.now() / 1000) - 3600)));
    assert.ok(!verifyStripeSignature(secret, raw, undefined));
  });
  it("fulfils only paid, completed checkouts from an account", () => {
    assert.deepEqual(fulfilmentFrom(event(sub)), { kind: "plan", account: "a@b.co", customer: "cus_9", subscription: "sub_9", session: "cs_test_9" });
    assert.deepEqual(fulfilmentFrom(event({ ...sub, mode: "payment", metadata: { account: "a@b.co", decision: "d1" } })), { kind: "pass", account: "a@b.co", decisionId: "d1", session: "cs_test_9" });
    assert.equal(fulfilmentFrom(event({ ...sub, payment_status: "unpaid" })), null);
    assert.equal(fulfilmentFrom(event({ ...sub, metadata: {} })), null);
    assert.equal(fulfilmentFrom(event(sub, "invoice.paid")), null);
    assert.equal(fulfilmentFrom("not json"), null);
  });
  it("credits the account over HTTP, rejects bad signatures, and is off without a secret", async () => {
    const { memoryStore } = await import("../server/store.ts");
    const store = memoryStore();
    const e = { ...env, STRIPE_WEBHOOK_SECRET: secret };
    const handle = handler({ env: e, store, authCost: 4, fetchImpl: async () => new Response("{}", { status: 404 }) });
    const signup = await invoke(handle, "/auth/signup", { username: "buyer", email: "a@b.co", password: "correct horse battery", acceptTerms: true }, headers);
    assert.equal(signup.status, 201, JSON.stringify(signup.body));
    const raw = event(sub);
    const post = (body, signature) => invoke(handle, "/billing/stripe-webhook", JSON.parse(body), { host: "orion.example", "stripe-signature": signature, "x-raw": body });
    // The fake request helper re-serialises JSON, so sign exactly what it will send.
    const sent = JSON.stringify(JSON.parse(raw));
    assert.equal((await post(sent, "t=1,v1=bad")).status, 401);
    assert.equal((await invoke(handle, "/auth/login", { email: "a@b.co", password: "correct horse battery" }, headers)).body.user.pro, false);
    assert.equal((await post(sent, sign(sent))).status, 200);
    assert.equal((await invoke(handle, "/auth/login", { email: "a@b.co", password: "correct horse battery" }, headers)).body.user.pro, true);
    // Delivered twice (Stripe retries): still fine.
    assert.equal((await post(sent, sign(sent))).status, 200);
    const off = handler({ env, fetchImpl: async () => new Response("{}") });
    assert.equal((await invoke(off, "/billing/stripe-webhook", {}, { host: "orion.example" })).status, 404);
  });
});
