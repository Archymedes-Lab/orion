// Provider keys and model routing stay on the server; JEV math stays deterministic.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { z } from "zod";
import { ParseRequestSchema, ScoreRequestSchema, TriageRequestSchema, ExplanationRequestSchema, AftermathRequestSchema } from "../src/ai/contracts.ts";
import { parseLocally } from "../src/ai/extractDecision.ts";
import { classifySafety, safetyNotice } from "../src/decision-engine/safety.ts";
import { explainLocal } from "../src/ai/explainDecision.ts";
import { parseWithAI, scoreWithAI, scoreWithJev, triageWithAI, explainWithAI, explanationSummary, aftermathWithAI } from "./decision-ai.ts";
import { AIUnavailable, type ProviderOptions } from "./providers.ts";
import { CreativeRequestSchema, creativeWithAI } from "./creative.ts";
import { PrioritizeRequestSchema, prioritizeOptions } from "./prioritize.ts";
import { DownsideRequestSchema, downsideWithJev } from "./downside.ts";
import { jevModel } from "./typesafe.ts";
import { TaskScoreRequestSchema, TaskSplitRequestSchema, scoreTasks, splitTask } from "./tasks.ts";
import { BOARD_ROUTE, BoardError, boardsRoute, forgetBoards } from "./boards.ts";
import { routesFor, type Task, type Environment } from "./models.ts";
import { ModelRouter } from "./router.ts";
import { clientAddress, contentSecurityPolicy, json as sendJSON, rateLimiter, requestLocale, serveStatic } from "./http.ts";
import { msg, tIn, withLocale, type Locale } from "../src/i18n/index.ts";

import { ActivateRequest, BillingError, CheckoutRequest, LicenceRequest, STRIPE_WEBHOOK_PATH, fulfilmentFrom, verifyStripeSignature, issuePass, activate, bearer, billingConfig, createCheckout, createPortal, dailyQuota, priceReader, readLicence, refresh } from "./billing.ts";

import { PAYPACK_PATHS, PAYPACK_WEBHOOK_PATH, PaypackStartRequest, PaypackStatusRequest, checkPayment, paypackClient, paypackConfig, paypackPrices, recordWebhook, refreshPrepaid, startPayment, verifyPaypackSignature } from "./paypack.ts";
import { storeFrom, storeKind, StoreError, type Store } from "./store.ts";
import { CLIENT_HEADER, GUEST_PATHS, admitGuest, count, guestConfig, isOperator, logError, readStats, verifiedClient } from "./visitors.ts";
import {
  AuthError, BackupRequest, ClientErrorRequest, DeleteRequest, FeedbackRequest, LoginRequest, MAX_BACKUP_BYTES, MIN_PASSWORD, RecoverRequest, SignupRequest,
  attachPass, attachPlan, authConfig, claimPurchase, currentUser, userByEmail, deleteAccount, isSecure, login, logout, readBackup, recover, saveBackup, saveFeedback, sessionCookie, signup, type BackupSlot,
} from "./auth.ts";
import { issueLicence } from "./billing.ts";
import { SHARE_ROUTE, ShareCreateRequest, ShareError, ShareOwnerRequest, ShareRespondRequest, createShare, deleteShare, readShare, respond, results } from "./share.ts";

const ACCOUNT_PATHS = ["/auth/signup", "/auth/login", "/auth/logout", "/auth/recover", "/auth/delete", "/account/backup", "/account/web-backup", "/feedback", "/client-error"];
/** The Expo app's backup and the web app's are kept apart, so saving one never overwrites the other. */
const BACKUPS: Record<string, BackupSlot> = { "/account/backup": "app", "/account/web-backup": "web" };
const BILLING_PATHS = ["/billing/checkout", "/billing/activate", "/billing/refresh", "/billing/portal"];
/** With accounts on, these answer only to someone signed in. Signing in, crash reports and the public reads stay open. */
// Renewing a licence and paying by mobile money work from the device that holds the licence or ticket: a subscription
// renewal is still checked against the signed-in account (ownLicence), and a prepaid licence ends on its own date.
const TASK_PATHS = ["/tasks/score", "/tasks/split"];
const SIGNED_IN_PATHS = ["/decision/parse", "/decision/score-factors", "/decision/triage", "/decision/explain", "/decision/aftermath", "/decision/creative", "/decision/prioritize", "/decision/downside", ...TASK_PATHS, ...BILLING_PATHS.filter((p) => p !== "/billing/refresh"), "/feedback"];
const API_PATHS = ["/decision/parse", "/decision/score-factors", "/decision/triage", "/decision/explain", "/decision/aftermath", "/decision/creative", "/decision/prioritize", "/decision/downside", ...TASK_PATHS, ...BILLING_PATHS, ...PAYPACK_PATHS, ...ACCOUNT_PATHS];
export interface ServerOptions extends ProviderOptions {
  /** Directory of the exported web app (`expo export --platform web`); also read from ORION_STATIC_DIR. */
  staticDir?: string;
  /** One line per finished request. Never receives request or response bodies. */
  log?: (entry: { method: string; path: string; status: number; ms: number }) => void;
  /** Where accounts live. Default: from the environment (Upstash), or none, which turns accounts off. */
  store?: Store | null;
  /** Password hashing work factor; tests lower it. */
  authCost?: number;
}
const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};
class RequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
function body(req: IncomingMessage, limit = 32_768): Promise<unknown> {
  return rawBody(req, limit).then((raw) => {
    try { return JSON.parse(raw || "{}"); } catch { throw new RequestError(400, msg("Invalid JSON")); }
  });
}
/** The request body as sent, for a signature check (the Paypack webhook signs the exact bytes). */
function rawBody(req: IncomingMessage, limit = 32_768): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > limit) {
        if (!exceeded) reject(new RequestError(413, msg("Request is too large")));
        exceeded = true;
        raw = "";
      } else raw += chunk;
    });
    req.on("error", reject);
    req.on("aborted", () => reject(new RequestError(400, msg("Request aborted"))));
    req.on("end", () => {
      if (!exceeded) resolve(raw);
    });
  });
}
const unavailableReason = (error: unknown) => error instanceof AIUnavailable ? error.reason : "providers_unavailable";
const support = (safety: string) => safety === "crisis" || safety === "dangerous";

export function handler(given: ServerOptions = {}) {
  const env: Environment = given.env ?? process.env;
  // One router per server, so what it learns about each model carries over between requests.
  const router = given.router ?? new ModelRouter({
    hedgeMs: env.ORION_HEDGE_MS === undefined || env.ORION_HEDGE_MS === "" ? undefined : positive(env.ORION_HEDGE_MS, 0),
    // OpenRouter's public uptime figures, so a free model that is down is skipped without spending a request on it.
    // Off with ORION_FREE_UPTIME=0, and when a test injects its own fetch (it must never reach the network).
    uptimeFetch: env.ORION_FREE_UPTIME === "0" || given.fetchImpl ? undefined : fetch,
  });
  const options: ServerOptions = { ...given, router };
  if (env.ORION_COMPAT_DISCOVER === "1") router.discoveredModels(options.fetchImpl);
  const allowed = (env.ORION_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // With nothing listed, the Expo dev server may call an API that is itself on localhost, and nothing else may.
  const local = (host: string | undefined) => /^(localhost|127\.0\.0\.1)(:|$)/.test(String(host ?? ""));
  const maxActive = positive(env.ORION_MAX_CONCURRENT, 8) || 8;
  const limited = rateLimiter(positive(env.ORION_RATE_LIMIT, 60));
  // How many proxies in front of this server write X-Forwarded-For (0 = none, the socket address is the client).
  const trustProxy = positive(env.ORION_TRUST_PROXY, 0);
  // The web app's server signs each visitor's address (ORION_PROXY_SECRET, the same value on both), so visitors who
  // arrive through it are told apart instead of sharing the proxy's address and its limits.
  const proxySecret = env.ORION_PROXY_SECRET || undefined;
  const clientOf = (req: IncomingMessage) => (proxySecret && verifiedClient(req.headers?.[CLIENT_HEADER], proxySecret)) || clientAddress(req, trustProxy);
  // With ORION_ADMIN_KEY set, /health shows the model routing and /admin/stats answers only to that key.
  const adminKey = env.ORION_ADMIN_KEY || undefined;
  const guests = guestConfig(env);
  const staticDir = options.staticDir ?? env.ORION_STATIC_DIR;
  const csp = contentSecurityPolicy();
  const started = Date.now();
  // Stripe is optional: without it nothing is limited and the billing routes answer 404.
  const billing = billingConfig(env);
  // Mobile money (Paypack, Rwanda) is optional and independent of Stripe: either one turns paid plans on.
  const paypack = paypackConfig(env);
  const mobileMoney = paypack ? paypackClient(paypack, options) : null;
  // Whatever signs licences: Stripe's settings when there are any, otherwise Paypack's (they share ORION_LICENSE_SECRET).
  const licensing = billing ?? paypack;
  const quota = licensing ? dailyQuota(licensing.freeDaily) : null;
  const price = billing ? priceReader(billing, options) : null;
  // Accounts are optional too: without a store the app works as before, signed out.
  // The same store holds shared decisions, so friends' answers work wherever accounts do.
  const store = given.store === undefined ? storeFrom(env, options.fetchImpl) : given.store;
  const auth = authConfig(env, store, given.authCost ? { cost: given.authCost } : {});
  let active = 0;
  return async (req: IncomingMessage, res: ServerResponse) => {
    const began = Date.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    const cors: Record<string, string> = {};
    // This request's language, from X-Orion-Lang (a `language` field in the body counts once the body is read).
    // Passed along explicitly, never kept anywhere shared: other people's requests are being answered at the same time.
    let lang: Locale = requestLocale(req);
    // Error messages are written in English (marked with msg) and sent in the request's language; `code` never changes.
    const localized = (value: unknown) => {
      if (lang === "en" || value === null || typeof value !== "object" || Array.isArray(value)) return value;
      const { error } = value as { error?: unknown };
      return typeof error === "string" ? { ...value, error: tIn(lang, error) } : value;
    };
    const json = (r: ServerResponse, code: number, value: unknown, extra: Record<string, string> = {}) => {
      sendJSON(r, code, localized(value), { ...cors, ...extra });
      options.log?.({ method: req.method ?? "", path: url.pathname, status: code, ms: Date.now() - began });
    };
    // Stripe's server calls this, not a browser: no Origin, no rate limit, and the raw body is what is signed.
    if (url.pathname === STRIPE_WEBHOOK_PATH) {
      if (!billing?.webhookSecret) { json(res, 404, { error: msg("Billing is not set up on this server") }); return; }
      if (req.method !== "POST") { json(res, 405, { error: msg("Use POST") }, { Allow: "POST" }); return; }
      try {
        const raw = await rawBody(req, 262_144);
        if (!verifyStripeSignature(billing.webhookSecret, raw, req.headers["stripe-signature"])) { json(res, 401, { error: "Invalid signature" }); return; }
        const fulfil = fulfilmentFrom(raw);
        const buyer = fulfil && auth ? await userByEmail(auth, fulfil.account) : null;
        // Credit the account that paid. Already credited (the buyer did return) is fine: claiming twice for one owner passes.
        if (fulfil && auth && buyer && await claimPurchase(auth, buyer, fulfil.kind === "plan" ? fulfil.subscription : fulfil.session)) {
          if (fulfil.kind === "pass") await attachPass(auth, buyer, fulfil.decisionId);
          else await attachPlan(auth, buyer, { customer: fulfil.customer, subscription: fulfil.subscription });
          console.log(JSON.stringify({ stripe: { fulfilled: fulfil.kind, session: fulfil.session } }));
        }
        json(res, 200, { ok: true });
      } catch (error) {
        if (error instanceof RequestError) json(res, error.status, { error: error.message });
        // 5xx so Stripe retries; the event is not lost.
        else json(res, 503, { error: "Could not record that event" });
      }
      return;
    }
    // Paypack's server calls this, not a browser: no Origin, no rate limit, and the raw body is what is signed.
    if (url.pathname === PAYPACK_WEBHOOK_PATH) {
      if (!paypack?.webhookSecret) { json(res, 404, { error: msg("Mobile money is not set up on this server") }); return; }
      // Paypack pings the address with HEAD before it sends an event.
      if (req.method === "HEAD") {
        res.writeHead(200, { "Cache-Control": "no-store" }); res.end();
        options.log?.({ method: "HEAD", path: url.pathname, status: 200, ms: Date.now() - began });
        return;
      }
      if (req.method !== "POST") { json(res, 405, { error: msg("Use POST") }, { Allow: "POST, HEAD" }); return; }
      try {
        const raw = await rawBody(req, 65_536);
        if (!verifyPaypackSignature(paypack.webhookSecret, raw, req.headers["x-paypack-signature"])) { json(res, 401, { error: "Invalid signature" }); return; }
        const event = await recordWebhook(store, raw);
        if (event) console.log(JSON.stringify({ paypack: event }));
        json(res, 200, { ok: true });
      } catch (error) {
        if (error instanceof RequestError) json(res, error.status, { error: error.message });
        // 5xx so Paypack can try again later; the event is not lost.
        else json(res, 503, { error: "Could not record that event" });
      }
      return;
    }
    const origin = req.headers?.origin;
    if (origin) {
      // The page that this server itself serves is always allowed; other origins must be listed.
      let sameOrigin = false;
      try { sameOrigin = new URL(origin).host === req.headers.host; } catch { /* malformed Origin */ }
      const dev = env.ORION_ALLOWED_ORIGINS === undefined && origin === "http://localhost:8081" && local(req.headers.host);
      if (!sameOrigin && !dev && !allowed.includes(origin)) { json(res, 403, { error: msg("Origin not allowed") }); return; }
      Object.assign(cors, {
        "Access-Control-Allow-Origin": origin, Vary: "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Orion-Lang", "Access-Control-Max-Age": "600",
        // The session cookie travels on requests from an allowed origin (the app on another port in development).
        "Access-Control-Allow-Credentials": "true",
      });
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors); res.end();
      return;
    }
    if (url.pathname === "/health" && req.method === "GET") {
      try {
        const routing = Object.fromEntries((["parse", "score", "triage", "explain", "aftermath", "diverge"] as Task[]).map((task) =>
          [task, router.order(routesFor(task, env, env.ORION_COMPAT_DISCOVER === "1" ? router.discoveredModels(options.fetchImpl) : []), task).map(({ provider, model }) => ({ provider, model }))]));
        // The database behind accounts and shared links: which one, and whether it answers right now.
        let reachable = false;
        if (store) { try { await store.get("health:ping"); reachable = true; } catch { reachable = false; } }
        // Which models answer, and how they are doing, is for the operator once a key is set; everyone else learns
        // only whether ORION is up and what it can do.
        if (adminKey && !isOperator(req.headers?.authorization, adminKey)) {
          json(res, 200, {
            ok: true, database: { reachable }, aiConfigured: Boolean(env.TYPESAFE_API_KEY) || routing.score.length > 0, jev: Boolean(env.TYPESAFE_API_KEY),
            billing: Boolean(billing), accounts: Boolean(auth), sharing: Boolean(store), guestDecisions: auth && store && guests ? guests.decisions : 0,
          });
          return;
        }
        json(res, 200, {
          database: { kind: given.store === undefined ? storeKind(env) : store ? "custom" : "none", reachable },
          ok: true, aiConfigured: Boolean(env.TYPESAFE_API_KEY) || routing.score.length > 0,
          jev: Boolean(env.TYPESAFE_API_KEY), jevModel: env.TYPESAFE_API_KEY ? jevModel(env) : null, billing: Boolean(billing), accounts: Boolean(auth), sharing: Boolean(store), guestDecisions: auth && store && guests ? guests.decisions : 0, uptimeSeconds: Math.round((Date.now() - started) / 1000), routing,
          freeModels: router.describeFree(Object.values(routing).flat().filter((r) => r.provider === "compatible").map((r) => r.model)), ...router.snapshot(),
        });
      } catch { json(res, 503, { ok: false, error: "Invalid model configuration" }); }
      return;
    }
    if (url.pathname === "/admin/stats" && req.method === "GET") {
      // Launch numbers and recent errors. Answers 404 to anyone without the operator key, as if it were not here.
      if (!store || !isOperator(req.headers?.authorization, adminKey)) { json(res, 404, { error: msg("not found") }); return; }
      try { json(res, 200, await readStats(store, Math.min(60, Number(url.searchParams.get("days")) || 14))); }
      catch { json(res, 503, { error: msg("Accounts are unavailable right now. Try again shortly.") }); }
      return;
    }
    if (url.pathname === "/billing/plan" && req.method === "GET") {
      if (licensing) {
        const prices = billing && price ? await price() : {};
        json(res, 200, {
          enabled: true, freeDaily: licensing.freeDaily, prices, price: prices.yearly ?? null,
          mobileMoney: paypack ? { provider: "paypack", country: "RW", networks: ["MTN", "Airtel"], prices: paypackPrices(paypack) } : null,
        });
      } else json(res, 200, { enabled: false });
      return;
    }
    if (url.pathname === "/auth/config" && req.method === "GET") {
      json(res, 200, { enabled: Boolean(auth), inviteRequired: Boolean(auth?.inviteCodes), minPassword: MIN_PASSWORD });
      return;
    }
    if (auth && req.method === "GET" && (url.pathname === "/auth/me" || url.pathname in BACKUPS)) {
      // Each of these reads the account store, so they count against the same per-client limit as everything else.
      const rate = limited(clientOf(req));
      if (!rate.allowed) { json(res, 429, { error: msg("Too many requests; try again shortly") }, { "Retry-After": String(rate.retryAfter) }); return; }
      try {
        const user = await currentUser(auth, req);
        if (url.pathname in BACKUPS) {
          if (!user) json(res, 401, { error: msg("Sign in first") });
          else json(res, 200, { data: await readBackup(auth, user, BACKUPS[url.pathname]) });
          return;
        }
        // A subscriber's licence is handed to whichever device they sign in on, while Stripe says it is active.
        let licence: { token: string; expiresAt: number; until?: number } | null = null;
        if (user?.plan?.until !== undefined && licensing) {
          // Paid with mobile money: open until the paid period ends, no provider to ask.
          if (user.plan.until > Date.now()) licence = { ...issueLicence(licensing, user.plan.subscription, user.plan.customer, Date.now(), user.plan.until), until: user.plan.until };
        } else if (user?.plan && billing) {
          try { licence = await refresh(billing, issueLicence(billing, user.plan.subscription, user.plan.customer).token, options); } catch { /* not active */ }
        }
        const passes = user && licensing ? (user.passes ?? []).map((decisionId) => ({ decisionId, token: issuePass(licensing, decisionId) })) : [];
        json(res, 200, { user: user ? { id: user.id, email: user.email, createdAt: user.createdAt, pro: Boolean(licence) } : null, licence, passes });
      } catch { json(res, 503, { error: msg("Accounts are unavailable right now") }); }
      return;
    }
    const share = url.pathname.match(SHARE_ROUTE);
    if (share) {
      const [, shareId, action] = share;
      const reading = req.method === "GET" && shareId !== undefined && action === undefined;
      if (!reading && (req.method !== "POST" || (shareId !== undefined && action === undefined))) {
        json(res, 405, { error: msg("Method not allowed") }, { Allow: shareId && !action ? "GET, OPTIONS" : "POST, OPTIONS" }); return;
      }
      if (!store) { json(res, 404, { error: msg("Sharing is not set up on this server") }); return; }
      const client = clientOf(req);
      const rate = limited(client);
      if (!rate.allowed) { json(res, 429, { error: msg("Too many requests; try again shortly") }, { "Retry-After": String(rate.retryAfter) }); return; }
      try {
        if (reading) json(res, 200, await readShare(store, shareId));
        else {
          const input = await body(req);
          if (shareId === undefined) json(res, 201, await createShare(store, ShareCreateRequest.parse(input)));
          else if (action === "respond") json(res, 200, await respond(store, shareId, ShareRespondRequest.parse(input), client));
          else if (action === "results") json(res, 200, await results(store, shareId, ShareOwnerRequest.parse(input).ownerKey));
          else json(res, 200, await deleteShare(store, shareId, ShareOwnerRequest.parse(input).ownerKey));
        }
      } catch (error) {
        if (error instanceof z.ZodError) json(res, 400, { error: msg("Check what you entered and try again."), code: "invalid_request" });
        else if (error instanceof ShareError || error instanceof RequestError) json(res, error.status, { error: error.message });
        else if (error instanceof StoreError) json(res, 503, { error: msg("Sharing is unavailable right now. Try again shortly.") });
        else json(res, 500, { error: msg("Unable to process that") });
      }
      return;
    }
    const boards = url.pathname.match(BOARD_ROUTE);
    if (boards) {
      // Boards live in the account store; without accounts the web app keeps its board on the device instead.
      if (!auth || !store) { json(res, 404, { error: msg("Accounts are not set up on this server") }); return; }
      if (req.method !== "POST") { json(res, 405, { error: msg("Use POST") }, { Allow: "POST, OPTIONS" }); return; }
      const rate = limited(clientOf(req));
      if (!rate.allowed) { json(res, 429, { error: msg("Too many requests; try again shortly") }, { "Retry-After": String(rate.retryAfter) }); return; }
      try {
        const input = await body(req, 64_000);
        const user = await currentUser(auth, req);
        if (!user) { json(res, 401, { error: msg("Sign in to use ORION"), code: "signed_out" }); return; }
        json(res, 200, await boardsRoute(store, boards[1], input, { id: user.id, email: user.email }));
      } catch (error) {
        if (error instanceof z.ZodError) json(res, 400, { error: msg("Check what you entered and try again."), code: "invalid_request" });
        else if (error instanceof BoardError) json(res, error.status, { error: error.message, code: error.code });
        else if (error instanceof RequestError) json(res, error.status, { error: error.message });
        else if (error instanceof StoreError) json(res, 503, { error: msg("Boards are unavailable right now. Try again shortly.") });
        else json(res, 500, { error: msg("Unable to process that") });
      }
      return;
    }
    if (!API_PATHS.includes(url.pathname)) {
      if (staticDir && (req.method === "GET" || req.method === "HEAD")) {
        try {
          if (await serveStatic(staticDir, url.pathname, req, res, csp)) {
            options.log?.({ method: req.method, path: url.pathname, status: 200, ms: Date.now() - began });
            return;
          }
        } catch { /* fall through to 404 */ }
      }
      json(res, 404, { error: msg("not found") }); return;
    }
    if (req.method !== "POST") { json(res, 405, { error: msg("Use POST") }, { Allow: "POST, OPTIONS" }); return; }
    const client = clientOf(req);
    const rate = limited(client);
    if (!rate.allowed) void count(store, "rate_limited");
    if (!rate.allowed) { json(res, 429, { error: msg("Too many requests; try again shortly") }, { "Retry-After": String(rate.retryAfter) }); return; }
    // A licence can be renewed wherever licences are signed; checkout and the portal are Stripe's.
    if (BILLING_PATHS.includes(url.pathname) && !(url.pathname === "/billing/refresh" ? licensing : billing)) { json(res, 404, { error: msg("Billing is not set up on this server") }); return; }
    if (PAYPACK_PATHS.includes(url.pathname) && !paypack) { json(res, 404, { error: msg("Mobile money is not set up on this server") }); return; }
    if ((url.pathname.startsWith("/auth/") || url.pathname in BACKUPS) && !auth) { json(res, 404, { error: msg("Accounts are not set up on this server") }); return; }
    if (active >= maxActive) { json(res, 503, { error: msg("Server busy; try again shortly") }, { "Retry-After": "2" }); return; }
    active++;
    try {
      const input = await body(req, url.pathname in BACKUPS ? MAX_BACKUP_BYTES + 4_096 : undefined);
      lang = requestLocale(req, input);
      // Looked up once per request. With accounts on, ORION itself is for people who are signed in.
      // Renewal is open to the device that holds a licence, but still knows who is signed in for the ownership check.
      const user = auth && (SIGNED_IN_PATHS.includes(url.pathname) || url.pathname === "/billing/refresh") ? await currentUser(auth, req) : null;
      // Signed out: a few decisions a day as a guest (ORION_GUEST_DECISIONS), then an invitation to sign up.
      let guest = false;
      if (auth && SIGNED_IN_PATHS.includes(url.pathname) && !user) {
        if (!(guests && store && GUEST_PATHS.includes(url.pathname))) { json(res, 401, { error: msg("Sign in to use ORION"), code: "signed_out" }); return; }
        const verdict = await admitGuest(store, guests, client, url.pathname);
        if (!verdict.allowed) { void count(store, "guest_limit"); json(res, 401, { error: verdict.error, code: verdict.code }); return; }
        guest = true;
      }
      if (url.pathname === "/decision/parse") void count(store, guest ? "guest_decision" : "decision");
      // A licence only counts for the account that holds the subscription, so a copied token unlocks nothing elsewhere.
      const ownLicence = (token: unknown, allowExpired = false) => {
        const licence = licensing ? readLicence(licensing, token, { allowExpired }) : null;
        if (!licence) return null;
        // A prepaid (mobile money) licence carries its own end date, so renewing it adds nothing beyond that date.
        if (licence.until !== undefined) return licence;
        return !auth || user?.plan?.subscription === licence.subscription ? licence : null;
      };
      if (ACCOUNT_PATHS.includes(url.pathname)) {
        const secure = isSecure(req);
        const signedIn = (result: { token: string; user: unknown; recoveryCode?: string }, code = 200) =>
          json(res, code, { user: result.user, recoveryCode: result.recoveryCode }, { "Set-Cookie": sessionCookie(result.token, secure) });
        if (url.pathname === "/client-error") {
          // Crash reports from the app: the error text and page only, never decision content.
          const report = ClientErrorRequest.parse(input);
          console.error(JSON.stringify({ clientError: report.message, page: report.page, version: report.version }));
          void count(store, "client_error");
          void logError(store, { source: "client", message: report.message, page: report.page, version: report.version });
          json(res, 204, null);
        } else if (url.pathname === "/feedback") {
          const feedback = FeedbackRequest.parse(input);
          if (auth) await saveFeedback(auth, feedback, user);
          else console.log(JSON.stringify({ feedback }));
          json(res, 200, { ok: true });
        } else if (!auth) json(res, 404, { error: msg("Accounts are not set up on this server") });
        else if (url.pathname === "/auth/signup") { signedIn(await signup(auth, SignupRequest.parse(input), client, lang), 201); void count(store, "signup"); }
        else if (url.pathname === "/auth/login") { signedIn(await login(auth, LoginRequest.parse(input), client)); void count(store, "login"); }
        else if (url.pathname === "/auth/recover") signedIn(await recover(auth, RecoverRequest.parse(input), client, lang));
        else if (url.pathname === "/auth/logout") {
          await logout(auth, req);
          json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(null, secure) });
        } else {
          const owner = await currentUser(auth, req);
          if (!owner) json(res, 401, { error: msg("Sign in first"), code: "signed_out" });
          else if (url.pathname === "/auth/delete") {
            await deleteAccount(auth, owner, DeleteRequest.parse(input).password);
            await forgetBoards(auth.store, owner.id);
            json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(null, secure) });
          } else json(res, 200, await saveBackup(auth, owner, BackupRequest.parse(input).data, BACKUPS[url.pathname]));
        }
      } else if (url.pathname === "/billing/refresh" && licensing) {
        const token = LicenceRequest.parse(input).token;
        // A copied token renews nothing for anyone but the account that holds the subscription.
        if (!ownLicence(token, true)) { json(res, 401, { error: msg("That licence is not valid") }); return; }
        // A prepaid (mobile money) licence carries its own end date; a subscription is checked with Stripe.
        if (readLicence(licensing, token, { allowExpired: true })?.until !== undefined) json(res, 200, refreshPrepaid(licensing, token));
        else if (billing) json(res, 200, await refresh(billing, token, options));
        else json(res, 401, { error: msg("That licence is not valid") });
      } else if (paypack && mobileMoney && PAYPACK_PATHS.includes(url.pathname)) {
        if (url.pathname === "/billing/paypack/start") json(res, 200, await startPayment(paypack, mobileMoney, PaypackStartRequest.parse(input)));
        else {
          const result = await checkPayment(paypack, mobileMoney, PaypackStatusRequest.parse(input).ticket, store);
          // Signed in: keep what was bought on the account, as with a card payment.
          const user = result.status === "paid" && auth ? await currentUser(auth, req).catch(() => null) : null;
          if (auth && user && result.status === "paid") {
            if ("pass" in result) await attachPass(auth, user, result.pass.decisionId);
            else await attachPlan(auth, user, { customer: "paypack", subscription: `pp_${result.ref}`, until: result.until });
          }
          json(res, 200, result);
        }
      } else if (billing && BILLING_PATHS.includes(url.pathname)) {
        // Stripe sends people back to the app: the configured address, or the page that made this request.
        const base = billing.publicUrl ?? origin;
        if (url.pathname === "/billing/activate") {
          const { sessionId } = ActivateRequest.parse(input);
          const licence = await activate(billing, sessionId, options);
          // Remember the purchase on the account so it follows them to other devices, and so that the checkout
          // link, which is all the proof there is, works for the account that paid and no other.
          if (auth && user) {
            const paid = "pass" in licence ? null : readLicence(billing, licence.token);
            if (!await claimPurchase(auth, user, paid ? paid.subscription : sessionId)) throw new BillingError(409, msg("That purchase belongs to another account"));
            if ("pass" in licence) await attachPass(auth, user, licence.pass.decisionId);
            else if (paid) await attachPlan(auth, user, { customer: paid.customer, subscription: paid.subscription });
          }
          json(res, 200, licence);
        }
        else if ((url.pathname === "/billing/refresh" || url.pathname === "/billing/portal") && !ownLicence(LicenceRequest.parse(input).token, true)) json(res, 401, { error: msg("That licence is not valid") });
        else if (url.pathname === "/billing/refresh") json(res, 200, await refresh(billing, LicenceRequest.parse(input).token, options));
        else if (!base) json(res, 400, { error: "Set ORION_PUBLIC_URL so checkout knows where to return" });
        else if (url.pathname === "/billing/checkout") json(res, 200, await createCheckout(billing, base, CheckoutRequest.parse(input), options, user?.email));
        else json(res, 200, await createPortal(billing, LicenceRequest.parse(input).token, base, options));
      } else if (url.pathname === "/decision/parse") {
        const { input: text, business } = ParseRequestSchema.parse(input);
        const safety = classifySafety(text);
        // Crisis/dangerous input uses the local support path without any paid call.
        if (!support(safety)) {
          try { json(res, 200, await parseWithAI(text, { ...options, env }, business, lang)); return; }
          catch (error) {
            json(res, 200, { ...withLocale(lang, () => parseLocally(text)), safety, fallback: true, fallbackReason: unavailableReason(error) });
            return;
          }
        }
        json(res, 200, { ...withLocale(lang, () => parseLocally(text)), safety, fallback: true, fallbackReason: "support_path" });
      } else if (url.pathname === "/decision/score-factors") {
        const request = ScoreRequestSchema.parse(input);
        const safety = classifySafety(request.context);
        if (support(safety)) { json(res, 422, { error: msg("Support path required"), safety }); return; }
        // Subscribers are not counted; everyone else gets a number of scored decisions a day.
        const metered = licensing && quota && !ownLicence(bearer(req.headers?.authorization)) ? quota : null;
        // Count per account when signed in, so the allowance does not depend on which network someone is on.
        const who = user?.id ?? client;
        if (metered && licensing && metered.remaining(who) === 0) {
          json(res, 402, { error: msg("Today's free scored decisions are used up"), upgrade: true, freeDaily: licensing.freeDaily });
          return;
        }
        // Jev first (one batched request); the general providers answer if it is missing or fails.
        if (env.TYPESAFE_API_KEY) {
          try {
            const scored = await scoreWithJev(request, { apiKey: env.TYPESAFE_API_KEY, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs });
            metered?.spend(who);
            json(res, 200, scored); return;
          }
          catch { /* fall through */ }
        }
        try {
          const scored = await scoreWithAI(request, { ...options, env }, lang);
          metered?.spend(who);
          json(res, 200, scored);
        }
        catch (error) { json(res, 503, { error: msg("AI estimates unavailable; use manual estimates"), fallbackReason: unavailableReason(error) }); }
      } else if (url.pathname === "/decision/triage") {
        const request = TriageRequestSchema.parse(input);
        const candidates = [...new Set(request.candidates)];
        if (support(classifySafety(request.context)) || request.budget === 0 || candidates.length === 0) {
          json(res, 200, { keep: [], fallback: true }); return;
        }
        try { json(res, 200, await triageWithAI({ ...request, candidates }, { ...options, env }, lang)); }
        catch (error) { json(res, 200, { keep: candidates.slice(0, request.budget), fallback: true, fallbackReason: unavailableReason(error) }); }
      } else if (url.pathname === "/decision/creative") {
        const request = CreativeRequestSchema.parse(input);
        if (support(classifySafety(request.context))) { json(res, 422, { error: msg("Support path required") }); return; }
        // New paths ride on the day's scored decisions: opening them does not use one up, but they stop when none are left.
        const metered = licensing && quota && !ownLicence(bearer(req.headers?.authorization)) ? quota : null;
        if (metered && metered.remaining(user?.id ?? client) === 0) {
          json(res, 402, { error: msg("Today's free scored decisions are used up"), upgrade: true }); return;
        }
        try { json(res, 200, await creativeWithAI(request, { ...options, env, typesafeKey: env.TYPESAFE_API_KEY }, lang)); }
        catch (error) { json(res, 503, { error: msg("New paths are unavailable right now"), fallbackReason: unavailableReason(error) }); }
      } else if (url.pathname === "/decision/prioritize") {
        const request = PrioritizeRequestSchema.parse(input);
        if (support(classifySafety(request.context))) { json(res, 422, { error: msg("Support path required") }); return; }
        const metered = licensing && quota && !ownLicence(bearer(req.headers?.authorization)) ? quota : null;
        if (metered && metered.remaining(user?.id ?? client) === 0) {
          json(res, 402, { error: msg("Today's free scored decisions are used up"), upgrade: true }); return;
        }
        try { json(res, 200, await prioritizeOptions(request, { ...options, env, typesafeKey: env.TYPESAFE_API_KEY }, lang)); }
        catch (error) { json(res, 503, { error: msg("Priorities are unavailable right now"), fallbackReason: unavailableReason(error) }); }
      } else if (url.pathname === "/decision/downside") {
        const request = DownsideRequestSchema.parse(input);
        if (support(classifySafety(request.context))) { json(res, 422, { error: msg("Support path required") }); return; }
        // Jev only: the answers are probabilities on fixed scales, which a general model can't give honestly.
        if (!env.TYPESAFE_API_KEY) { json(res, 503, { error: msg("The downside check is unavailable right now") }); return; }
        try { json(res, 200, await downsideWithJev(request, { apiKey: env.TYPESAFE_API_KEY, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs })); }
        catch (error) { json(res, 503, { error: msg("The downside check is unavailable right now"), fallbackReason: unavailableReason(error) }); }
      } else if (url.pathname === "/tasks/score") {
        const request = TaskScoreRequestSchema.parse(input);
        if (request.tasks.some((t) => support(classifySafety(`${t.title} ${t.notes ?? ""}`)))) { json(res, 422, { error: msg("Support path required") }); return; }
        // Proposals for a to-do list: not a scored decision, so they do not use up the day's allowance.
        try { json(res, 200, await scoreTasks(request, { ...options, env, typesafeKey: env.TYPESAFE_API_KEY }, lang)); }
        catch (error) { json(res, 503, { error: msg("ORION can’t propose scores right now. Set them yourself, or try again shortly."), fallbackReason: unavailableReason(error) }); }
      } else if (url.pathname === "/tasks/split") {
        const request = TaskSplitRequestSchema.parse(input);
        if (support(classifySafety(`${request.task.title} ${request.task.notes ?? ""} ${request.task.blocker ?? ""}`))) { json(res, 422, { error: msg("Support path required") }); return; }
        try { json(res, 200, await splitTask(request, { ...options, env }, lang)); }
        catch (error) { json(res, 503, { error: msg("ORION can’t split this task right now. Try again shortly."), fallbackReason: unavailableReason(error) }); }
      } else if (url.pathname === "/decision/aftermath") {
        const request = AftermathRequestSchema.parse(input);
        // Crisis and dangerous situations get support, not a picture of the future; the app shows its own local wording otherwise.
        if (request.safety === "crisis" || request.safety === "dangerous") { json(res, 200, { steps: null, fallback: true }); return; }
        try { json(res, 200, { ...(await aftermathWithAI(request, { ...options, env }, lang)), fallback: false }); }
        catch (error) { json(res, 200, { steps: null, fallback: true, fallbackReason: unavailableReason(error) }); }
      } else {
        const request = ExplanationRequestSchema.parse(input);
        if (support(request.safety)) { json(res, 200, { explanation: withLocale(lang, () => safetyNotice(request.safety)), fallback: true }); return; }
        try { json(res, 200, await explainWithAI(request, { ...options, env }, lang)); }
        catch (error) { json(res, 200, { explanation: withLocale(lang, () => explainLocal(explanationSummary(request))), fallback: true, fallbackReason: unavailableReason(error) }); }
      }
    } catch (error) {
      if (error instanceof z.ZodError) json(res, 400, { error: ACCOUNT_PATHS.includes(url.pathname) ? msg("Check the details you entered and try again.") : msg("Invalid decision request"), code: "invalid_request" });
      else if (error instanceof AuthError) json(res, error.status, { error: error.message, code: error.code }, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
      else if (error instanceof StoreError) json(res, 503, { error: msg("Accounts are unavailable right now. Try again shortly.") });
      else if (error instanceof RequestError || error instanceof BillingError) json(res, error.status, { error: error.message });
      else {
        void count(store, "server_error");
        void logError(store, { source: "server", message: error instanceof Error ? `${error.name}: ${error.message}` : String(error), path: url.pathname });
        json(res, 500, { error: msg("Unable to process decision") });
      }
    } finally { active--; }
  };
}

if (process.env.ORION_SERVE === "1") {
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.ORION_HOST ?? "127.0.0.1";
  const staticDir = process.env.ORION_STATIC_DIR ?? (existsSync("dist/index.html") ? "dist" : undefined);
  const quiet = process.env.ORION_LOG === "0";
  const server = createServer(handler({
    staticDir,
    log: quiet ? undefined : (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry })),
  }));
  // Slow or stalled clients must not hold sockets open.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000;
  server.listen(port, host, () => console.log(`orion api on ${host}:${port}${staticDir ? ` (serving ${staticDir}/)` : ""}`));
  // Finish in-flight requests on a deploy or Ctrl-C, then leave; do not hang forever.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}
