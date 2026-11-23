// Mobile money in Rwanda (MTN MoMo and Airtel Money) through Paypack, for people who pay by phone, not by card.
//
// Paypack takes one-off payments ("cash-in"): ORION asks Paypack to charge a number, the person approves the
// prompt on their phone, and Paypack reports the result. There is no recurring billing, so a mobile money
// "Pro, monthly" is a prepaid month: it does not renew by itself, and the app says so.
//
// Like the Stripe side (server/billing.ts) this needs no server database:
//   1. /billing/paypack/start  charges the number and hands back a signed ticket (reference, plan, amount, time).
//   2. /billing/paypack/status takes the ticket back, asks Paypack (or the webhook's record) whether that exact
//      reference was paid in full, and then issues the same licence or pass as a card payment would. A paid
//      month is a licence with `until`, renewed by this server alone until the month is over.
//   3. /billing/paypack/webhook receives Paypack's "transaction:processed" event, checks its signature, and,
//      when a store is configured, records the outcome so step 2 does not have to wait for Paypack's API.
// The period runs from when the payment was started (signed into the ticket), so a ticket checked twice
// never buys more time. Phone numbers are sent to Paypack only; they are never logged or stored by ORION.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Environment } from "./models.ts";
import type { PlanId } from "../src/billing/plans.ts";
import { BillingError, DecisionId, issueLicence, issuePass, readLicence, type LicenceKey } from "./billing.ts";
import type { Store } from "./store.ts";
import { msg } from "../src/i18n/index.ts";

export const PAYPACK_API = "https://payments.paypack.rw/api";
export const PAYPACK_WEBHOOK_PATH = "/billing/paypack/webhook";
export const PAYPACK_PATHS = ["/billing/paypack/start", "/billing/paypack/status"];
const DAY_MS = 86_400_000;
/** How long one mobile money payment keeps Pro open. */
export const PAYPACK_PERIOD_MS: Record<"monthly" | "yearly", number> = { monthly: 30 * DAY_MS, yearly: 365 * DAY_MS };
/** A started payment can be checked for a week; after that the ticket is refused. */
const TICKET_TTL_MS = 7 * DAY_MS;
/** Paypack's access tokens last about 15 minutes; renew a little early. */
const TOKEN_REUSE_MS = 10 * 60_000;
const TX_KEY = (ref: string) => `paypack:tx:${ref}`;

export interface PaypackConfig extends LicenceKey {
  clientId: string;
  clientSecret: string;
  /** From the webhook's settings in the Paypack dashboard. Without it the webhook route is off. */
  webhookSecret: string | null;
  /** Whole Rwandan francs per plan. At least one is set. */
  prices: Partial<Record<PlanId, number>>;
  freeDaily: number | null;
  mode: "production" | "development";
  baseUrl: string;
}

const PLAN_PRICE_VARS: [PlanId, string][] = [["monthly", "PAYPACK_PRICE_MONTHLY"], ["yearly", "PAYPACK_PRICE_YEARLY"], ["pass", "PAYPACK_PRICE_PASS"]];

/** null when Paypack is not set up. Throws on a half-finished setup, so it fails at startup rather than at checkout. */
export function paypackConfig(env: Environment): PaypackConfig | null {
  const prices: Partial<Record<PlanId, number>> = {};
  for (const [plan, name] of PLAN_PRICE_VARS) {
    const value = env[name];
    if (value === undefined || value === "") continue;
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount < 1) throw new Error(`${name} must be a whole number of Rwandan francs, for example 6500.`);
    prices[plan] = amount;
  }
  const any = Object.keys(prices).length > 0;
  if (!env.PAYPACK_CLIENT_ID && !env.PAYPACK_CLIENT_SECRET && !any) return null;
  if (!env.PAYPACK_CLIENT_ID || !env.PAYPACK_CLIENT_SECRET || !any) {
    throw new Error("Paypack needs PAYPACK_CLIENT_ID, PAYPACK_CLIENT_SECRET and at least one price (PAYPACK_PRICE_MONTHLY, PAYPACK_PRICE_YEARLY or PAYPACK_PRICE_PASS).");
  }
  if (!env.ORION_LICENSE_SECRET || env.ORION_LICENSE_SECRET.length < 32) throw new Error("Paypack needs ORION_LICENSE_SECRET (32+ random characters) to sign licences.");
  const freeDaily = env.ORION_FREE_DAILY === undefined || env.ORION_FREE_DAILY === "" ? null : Number(env.ORION_FREE_DAILY);
  if (freeDaily !== null && (!Number.isInteger(freeDaily) || freeDaily < 0)) throw new Error("ORION_FREE_DAILY must be a whole number, 0 or more.");
  const mode = env.PAYPACK_MODE === undefined || env.PAYPACK_MODE === "" ? "production" : env.PAYPACK_MODE;
  if (mode !== "production" && mode !== "development") throw new Error("PAYPACK_MODE must be production or development.");
  return {
    clientId: env.PAYPACK_CLIENT_ID, clientSecret: env.PAYPACK_CLIENT_SECRET, webhookSecret: env.PAYPACK_WEBHOOK_SECRET || null,
    prices, licenceSecret: env.ORION_LICENSE_SECRET, freeDaily, mode, baseUrl: (env.PAYPACK_BASE_URL || PAYPACK_API).replace(/\/+$/, ""),
  };
}

/** What the plans screen shows for mobile money: amounts in RWF, which has no minor unit. */
export function paypackPrices(config: PaypackConfig) {
  const interval = { monthly: "month", yearly: "year", pass: null } as const;
  return Object.fromEntries((Object.entries(config.prices) as [PlanId, number][]).map(([plan, amount]) => [plan, { amount, currency: "rwf", interval: interval[plan] }])) as
    Partial<Record<PlanId, { amount: number; currency: string; interval: string | null }>>;
}

/** An MTN or Airtel Rwanda number as Paypack expects it (07XXXXXXXX), from the ways people type it; else null. */
export function rwandaNumber(input: string): string | null {
  const compact = input.replace(/[\s().-]/g, "");
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  const local = digits.startsWith("250") ? `0${digits.slice(3)}` : digits;
  return /^07[2389]\d{7}$/.test(local) ? local : null;
}

// ---------------------------------------------------------------------------
// Paypack REST
// ---------------------------------------------------------------------------
interface PaypackOptions { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number }
class Unauthorized extends Error {}

const Tokens = z.object({ access: z.string().min(1) });
export const PaypackTransaction = z.object({
  ref: z.string().min(1).max(100),
  kind: z.string(),
  amount: z.number(),
  status: z.string(),
});
export type PaypackTransaction = z.infer<typeof PaypackTransaction>;

export function paypackClient(config: PaypackConfig, options: PaypackOptions = {}) {
  const now = options.now ?? Date.now;
  let token: { access: string; until: number } | null = null;

  async function send(method: "GET" | "POST", path: string, body: unknown, access: string | null, headers: Record<string, string> = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    try {
      const response = await (options.fetchImpl ?? fetch)(`${config.baseUrl}${path}`, {
        method, signal: controller.signal,
        headers: {
          Accept: "application/json", "Content-Type": "application/json", "X-Webhook-Mode": config.mode,
          ...(access ? { Authorization: `Bearer ${access}` } : {}), ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 401 && access) throw new Unauthorized();
      // Paypack's error bodies can echo the phone number; report only what the person can act on.
      if (response.status === 400 || response.status === 422) throw new BillingError(400, msg("Mobile money could not start that payment. Check the number and try again."));
      if (response.status === 404) throw new BillingError(404, msg("Mobile money has no payment with that reference"));
      if (!response.ok) throw new BillingError(502, msg("Mobile money could not complete that right now. Try again in a moment."));
      return await response.json();
    } catch (error) {
      if (error instanceof BillingError || error instanceof Unauthorized) throw error;
      throw new BillingError(502, msg("Mobile money is not reachable right now. Try again in a moment."));
    } finally { clearTimeout(timer); }
  }

  async function access(fresh = false): Promise<string> {
    if (!fresh && token && token.until > now()) return token.access;
    let data: z.infer<typeof Tokens>;
    try {
      data = Tokens.parse(await send("POST", "/auth/agents/authorize", { client_id: config.clientId, client_secret: config.clientSecret }, null));
    } catch (error) {
      token = null;
      if (error instanceof BillingError && error.status !== 502) throw new BillingError(502, msg("Mobile money is not set up correctly on this server"));
      throw error instanceof BillingError ? error : new BillingError(502, msg("Mobile money is not set up correctly on this server"));
    }
    token = { access: data.access, until: now() + TOKEN_REUSE_MS };
    return token.access;
  }

  /** One retry with a fresh token when Paypack says the current one has expired. */
  async function authed(method: "GET" | "POST", path: string, body?: unknown, headers?: Record<string, string>) {
    try { return await send(method, path, body, await access(), headers); }
    catch (error) {
      if (!(error instanceof Unauthorized)) throw error;
      try { return await send(method, path, body, await access(true), headers); }
      catch (again) { if (again instanceof Unauthorized) throw new BillingError(502, msg("Mobile money is not set up correctly on this server")); throw again; }
    }
  }

  return {
    async cashin(amount: number, number: string): Promise<PaypackTransaction> {
      // A fresh key per attempt: Paypack never runs the same key twice, so a retried request cannot charge twice.
      return PaypackTransaction.parse(await authed("POST", "/transactions/cashin", { amount, number }, { "Idempotency-Key": randomBytes(16).toString("hex") }));
    },
    async find(ref: string): Promise<PaypackTransaction> {
      return PaypackTransaction.parse(await authed("GET", `/transactions/find/${encodeURIComponent(ref)}`));
    },
  };
}
export type PaypackClient = ReturnType<typeof paypackClient>;

// ---------------------------------------------------------------------------
// Tickets: proof that this server started a given payment, for a given plan and amount, at a given time.
// ---------------------------------------------------------------------------
const Ticket = z.object({
  ref: z.string().min(1).max(100),
  plan: z.enum(["monthly", "yearly", "pass"]),
  dec: DecisionId.optional(),
  amt: z.number().int().positive(),
  iat: z.number().finite(),
});
type Ticket = z.infer<typeof Ticket>;
const signTicket = (payload: string, secret: string) => createHmac("sha256", secret).update(`paypack:${payload}`).digest("base64url");

export function issueTicket(key: LicenceKey, ticket: Ticket): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `t1.${payload}.${signTicket(payload, key.licenceSecret)}`;
}
export function readTicket(key: LicenceKey, token: unknown): Ticket | null {
  if (typeof token !== "string" || token.length > 1000) return null;
  const [version, payload, signature, ...rest] = token.split(".");
  if (version !== "t1" || !payload || !signature || rest.length) return null;
  const expected = Buffer.from(signTicket(payload, key.licenceSecret)), given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try { return Ticket.parse(JSON.parse(Buffer.from(payload, "base64url").toString())); } catch { return null; }
}

export const PaypackStartRequest = z.object({
  plan: z.enum(["monthly", "yearly", "pass"]),
  phone: z.string().min(9).max(20),
  decisionId: DecisionId.optional(),
});
export const PaypackStatusRequest = z.object({ ticket: z.string().min(1).max(1000) });

export async function startPayment(config: PaypackConfig, client: PaypackClient, request: z.infer<typeof PaypackStartRequest>, now = Date.now()) {
  const amount = config.prices[request.plan];
  if (!amount) throw new BillingError(400, msg("That plan is not on sale with mobile money"));
  if (request.plan === "pass" && !request.decisionId) throw new BillingError(400, msg("A pass is bought for one decision"));
  const number = rwandaNumber(request.phone);
  if (!number) throw new BillingError(400, msg("Enter an MTN or Airtel Rwanda number, like 078 123 4567."));
  const started = await client.cashin(amount, number);
  const ticket = issueTicket(config, { ref: started.ref, plan: request.plan, ...(request.plan === "pass" ? { dec: request.decisionId } : {}), amt: amount, iat: now });
  return { ticket, amount, currency: "rwf", status: "pending" as const };
}

export type PaymentCheck =
  | { status: "pending" | "failed" }
  | { status: "paid"; pass: { decisionId: string; token: string } }
  | { status: "paid"; token: string; expiresAt: number; until: number; plan: "monthly" | "yearly"; ref: string };

/** Whether the ticket's payment went through in full, and if so the licence or pass it bought. */
export async function checkPayment(config: PaypackConfig, client: PaypackClient, token: string, store: Store | null, now = Date.now()): Promise<PaymentCheck> {
  const ticket = readTicket(config, token);
  if (!ticket) throw new BillingError(400, msg("That payment reference is not valid"));
  if (now - ticket.iat > TICKET_TTL_MS) throw new BillingError(410, msg("That payment is too old to check here. Contact support with the time you paid."));
  let tx: PaypackTransaction | null = null;
  if (store) {
    try {
      const saved = await store.get(TX_KEY(ticket.ref));
      const parsed = saved ? PaypackTransaction.safeParse(JSON.parse(saved)) : null;
      if (parsed?.success && parsed.data.status !== "pending") tx = parsed.data;
    } catch { /* the store is a shortcut; Paypack itself is the answer */ }
  }
  tx ??= await client.find(ticket.ref);
  // Only the exact payment the ticket was issued for counts: same reference, a deposit, the full amount.
  if (tx.ref !== ticket.ref || tx.kind.toUpperCase() !== "CASHIN" || tx.amount !== ticket.amt) throw new BillingError(402, msg("That payment does not match what was bought"));
  const status = tx.status.toLowerCase();
  if (status === "failed") return { status: "failed" };
  if (status !== "successful") return { status: "pending" };
  if (ticket.plan === "pass") return { status: "paid", pass: { decisionId: ticket.dec!, token: issuePass(config, ticket.dec!) } };
  const until = ticket.iat + PAYPACK_PERIOD_MS[ticket.plan];
  if (until <= now) throw new BillingError(402, msg("That paid period has already ended"));
  return { status: "paid", ...issueLicence(config, `pp_${ticket.ref}`, "paypack", now, until), until, plan: ticket.plan, ref: ticket.ref };
}

/** A new licence for a prepaid period, until it ends. No payment provider is asked: the period is signed in the licence. */
export function refreshPrepaid(key: LicenceKey, token: string, now = Date.now()) {
  const licence = readLicence(key, token, { allowExpired: true, now });
  if (!licence || licence.until === undefined) throw new BillingError(401, msg("That licence is not valid"));
  if (licence.until <= now) throw new BillingError(402, msg("The paid period has ended"));
  return { ...issueLicence(key, licence.subscription, licence.customer, now, licence.until), until: licence.until };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------
/** Paypack signs the raw body with HMAC-SHA256 and the webhook secret, base64-encoded, in X-Paypack-Signature. */
export function verifyPaypackSignature(secret: string, rawBody: string, header: string | string[] | undefined): boolean {
  if (typeof header !== "string" || header.trim() === "") return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("base64"));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const WebhookEvent = z.object({ kind: z.string().optional(), data: PaypackTransaction.passthrough() });

/** Records a processed transaction so a status check can answer without calling Paypack. Returns what to log. */
export async function recordWebhook(store: Store | null, rawBody: string): Promise<{ ref: string; status: string; kind: string; recorded: boolean } | null> {
  let event: z.infer<typeof WebhookEvent>;
  try { event = WebhookEvent.parse(JSON.parse(rawBody)); } catch { return null; }
  if (event.kind && event.kind !== "transaction:processed") return null;
  const { ref, kind, amount, status } = event.data;
  // The customer's number (data.client) is deliberately not kept.
  if (store) await store.set(TX_KEY(ref), JSON.stringify({ ref, kind, amount, status }), 30 * 24 * 3600);
  return { ref, status, kind, recorded: Boolean(store) };
}
