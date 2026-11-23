// Stripe subscriptions without accounts or a server database.
// Checkout proves payment; the server then signs a short-lived licence the device keeps, and renews it only
// while Stripe says the subscription is active. Stripe is called over its REST API, so there is no SDK to ship.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Environment } from "./models.ts";
import type { PlanId } from "../src/billing/plans.ts";
import { msg } from "../src/i18n/index.ts";

const STRIPE = "https://api.stripe.com/v1";
const LICENCE_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE = new Set(["active", "trialing"]);

export class BillingError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export interface BillingConfig {
  secretKey: string;
  /** Stripe Price ids by plan. At least one is set. */
  prices: Partial<Record<PlanId, string>>;
  licenceSecret: string;
  /**
   * Scored decisions a day for people who have not paid, as protection against abuse; null means no cap.
   * The free product is not limited by count: what is paid is depth (src/billing/plans.ts).
   */
  freeDaily: number | null;
  /** Where Stripe sends people back to, when the request's own origin should not be used. */
  publicUrl?: string;
  /** Signing secret of the Stripe webhook endpoint (whsec_…). Without it the webhook route is off and only the return trip fulfils a purchase. */
  webhookSecret?: string;
}

/** null when Stripe is not set up (then nothing is limited). Throws on a half-finished setup, so it fails at startup. */
export function billingConfig(env: Environment): BillingConfig | null {
  // STRIPE_PRICE_ID is the earlier single-plan name and still means the yearly plan.
  const named: [PlanId, string | undefined][] = [["yearly", env.STRIPE_PRICE_YEARLY || env.STRIPE_PRICE_ID], ["monthly", env.STRIPE_PRICE_MONTHLY], ["pass", env.STRIPE_PRICE_PASS]];
  const prices = Object.fromEntries(named.filter(([, id]) => id)) as Partial<Record<PlanId, string>>;
  const any = Object.keys(prices).length > 0;
  if (!env.STRIPE_SECRET_KEY && !any) return null;
  if (!env.STRIPE_SECRET_KEY || !any) throw new Error("Billing needs both STRIPE_SECRET_KEY and at least one price (STRIPE_PRICE_YEARLY, STRIPE_PRICE_MONTHLY or STRIPE_PRICE_PASS).");
  if (!/^(sk|rk)_(test|live)_/.test(env.STRIPE_SECRET_KEY)) throw new Error("STRIPE_SECRET_KEY must be a secret or restricted key (sk_… or rk_…).");
  if (Object.values(prices).some((id) => !id.startsWith("price_"))) throw new Error("Stripe prices must be price ids (price_…).");
  if (!env.ORION_LICENSE_SECRET || env.ORION_LICENSE_SECRET.length < 32) throw new Error("Billing needs ORION_LICENSE_SECRET (32+ random characters) to sign licences.");
  const freeDaily = env.ORION_FREE_DAILY === undefined || env.ORION_FREE_DAILY === "" ? null : Number(env.ORION_FREE_DAILY);
  if (freeDaily !== null && (!Number.isInteger(freeDaily) || freeDaily < 0)) throw new Error("ORION_FREE_DAILY must be a whole number, 0 or more.");
  if (env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET must be a webhook signing secret (whsec_…).");
  return { secretKey: env.STRIPE_SECRET_KEY, prices, licenceSecret: env.ORION_LICENSE_SECRET, freeDaily, publicUrl: env.ORION_PUBLIC_URL?.replace(/\/+$/, ""), webhookSecret: env.STRIPE_WEBHOOK_SECRET || undefined };
}

// ---------------------------------------------------------------------------
// Licence: v1.<payload>.<signature>, HMAC-SHA256 over the payload.
// ---------------------------------------------------------------------------
/**
 * `until` is set on a prepaid licence (mobile money through Paypack): the paid period's end. Such a licence is
 * renewed by the server alone, without asking a payment provider, until that date (server/paypack.ts).
 */
export interface Licence { subscription: string; customer: string; expiresAt: number; until?: number }
/** What signs licences and passes. Stripe's config has it; so does Paypack's. */
export type LicenceKey = Pick<BillingConfig, "licenceSecret">;
const Payload = z.object({ sub: z.string().min(1).max(200), cus: z.string().min(1).max(200), exp: z.number().finite(), until: z.number().finite().optional() });
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function issueLicence(config: LicenceKey, subscription: string, customer: string, now = Date.now(), until?: number): { token: string; expiresAt: number } {
  // A prepaid licence never outlives what was paid for.
  const expiresAt = until === undefined ? now + LICENCE_TTL_MS : Math.min(now + LICENCE_TTL_MS, until);
  const payload = Buffer.from(JSON.stringify({ sub: subscription, cus: customer, exp: expiresAt, ...(until === undefined ? {} : { until }) })).toString("base64url");
  return { token: `v1.${payload}.${sign(payload, config.licenceSecret)}`, expiresAt };
}

/** The licence if the signature is ours; null otherwise. Expiry is checked unless `allowExpired`. */
export function readLicence(config: LicenceKey, token: unknown, options: { allowExpired?: boolean; now?: number } = {}): Licence | null {
  if (typeof token !== "string" || token.length > 2000) return null;
  const [version, payload, signature, ...rest] = token.split(".");
  if (version !== "v1" || !payload || !signature || rest.length) return null;
  const expected = Buffer.from(sign(payload, config.licenceSecret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = Payload.parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    if (!options.allowExpired && data.exp <= (options.now ?? Date.now())) return null;
    return { subscription: data.sub, customer: data.cus, expiresAt: data.exp, ...(data.until === undefined ? {} : { until: data.until }) };
  } catch { return null; }
}

/** A one-time pass: proof that the paid features were bought for one decision. It does not expire. */
export function issuePass(config: LicenceKey, decisionId: string): string {
  const payload = Buffer.from(JSON.stringify({ dec: decisionId })).toString("base64url");
  return `p1.${payload}.${sign(`pass:${payload}`, config.licenceSecret)}`;
}
/** The decision a pass is for, if the signature is ours. */
export function readPass(config: LicenceKey, token: unknown): string | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const [version, payload, signature, ...rest] = token.split(".");
  if (version !== "p1" || !payload || !signature || rest.length) return null;
  const expected = Buffer.from(sign(`pass:${payload}`, config.licenceSecret)), given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try { return DecisionId.parse((JSON.parse(Buffer.from(payload, "base64url").toString()) as { dec?: unknown }).dec); } catch { return null; }
}

export const bearer = (header: string | string[] | undefined) =>
  typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : undefined;

// ---------------------------------------------------------------------------
// Stripe REST
// ---------------------------------------------------------------------------
interface StripeOptions { fetchImpl?: typeof fetch; timeoutMs?: number }

async function stripe(config: BillingConfig, method: "GET" | "POST", path: string, params: Record<string, string> | null, options: StripeOptions): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${STRIPE}${path}`, {
      method, signal: controller.signal,
      headers: { Authorization: `Bearer ${config.secretKey}`, ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: params ? new URLSearchParams(params).toString() : undefined,
    });
    // Stripe's error bodies can name customers and keys; report only the status.
    if (!response.ok) throw new BillingError(response.status === 404 ? 404 : 502, response.status === 404 ? msg("Not found at the payment provider") : msg("The payment provider could not complete that"));
    return await response.json();
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw new BillingError(502, msg("The payment provider is not reachable"));
  } finally { clearTimeout(timer); }
}

const stripeId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,200}$`));
export const DecisionId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const STRIPE_WEBHOOK_PATH = "/billing/stripe-webhook";
export const CheckoutRequest = z.object({ plan: z.enum(["yearly", "monthly", "pass"]).optional(), decisionId: DecisionId.optional() });
const Session = z.object({
  metadata: z.record(z.string(), z.string()).nullable().optional(),
  url: z.string().url().nullable().optional(), status: z.string().nullable().optional(), mode: z.string().optional(),
  payment_status: z.string().optional(), customer: z.string().nullable().optional(), subscription: z.string().nullable().optional(),
});
export const ActivateRequest = z.object({ sessionId: stripeId("cs") });
export const LicenceRequest = z.object({ token: z.string().min(1).max(2000) });

/**
 * A hosted Checkout page for a plan. `base` is the app's own address, already checked by the caller.
 * With no plan named, the yearly plan if there is one, otherwise whichever plan is set up.
 */
export async function createCheckout(config: BillingConfig, base: string, request: z.infer<typeof CheckoutRequest> = {}, options: StripeOptions = {}, account?: string): Promise<{ url: string }> {
  const plan = request.plan ?? (["yearly", "monthly", "pass"] as PlanId[]).find((id) => config.prices[id])!;
  const price = config.prices[plan];
  if (!price) throw new BillingError(400, msg("That plan is not on sale"));
  if (plan === "pass" && !request.decisionId) throw new BillingError(400, msg("A pass is bought for one decision"));
  const session = Session.parse(await stripe(config, "POST", "/checkout/sessions", {
    mode: plan === "pass" ? "payment" : "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    ...(plan === "pass" ? { "metadata[decision]": request.decisionId! } : {}),
    // Who is paying, so the webhook can credit their account if they never come back to the app.
    ...(account ? { customer_email: account, "metadata[account]": account } : {}),
    success_url: `${base}/you?checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/you?checkout=cancelled`,
  }, options));
  if (!session.url) throw new BillingError(502, msg("The payment provider did not return a checkout page"));
  return { url: session.url };
}

export type Activation = { token: string; expiresAt: number } | { pass: { decisionId: string; token: string } };

/** Exchanges a finished Checkout session for a licence or a pass. The session id is the proof of purchase. */
export async function activate(config: BillingConfig, sessionId: string, options: StripeOptions = {}): Promise<Activation> {
  const session = Session.parse(await stripe(config, "GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`, null, options));
  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (session.mode === "payment") {
    const decision = DecisionId.safeParse(session.metadata?.decision);
    if (session.status !== "complete" || !paid || !decision.success) throw new BillingError(402, msg("That checkout was not completed"));
    return { pass: { decisionId: decision.data, token: issuePass(config, decision.data) } };
  }
  if (session.status !== "complete" || session.mode !== "subscription" || !paid || !session.subscription || !session.customer) {
    throw new BillingError(402, msg("That checkout was not completed"));
  }
  return issueLicence(config, session.subscription, session.customer);
}

/** A new licence if Stripe still reports the subscription as active; otherwise 402. */
export async function refresh(config: BillingConfig, token: string, options: StripeOptions = {}) {
  const licence = readLicence(config, token, { allowExpired: true });
  if (!licence) throw new BillingError(401, msg("That licence is not valid"));
  const subscription = z.object({ status: z.string() }).parse(await stripe(config, "GET", `/subscriptions/${encodeURIComponent(licence.subscription)}`, null, options));
  if (!ACTIVE.has(subscription.status)) throw new BillingError(402, msg("The subscription is no longer active"));
  return issueLicence(config, licence.subscription, licence.customer);
}

/** Stripe's own page for changing the card or cancelling. */
export async function createPortal(config: BillingConfig, token: string, base: string, options: StripeOptions = {}): Promise<{ url: string }> {
  const licence = readLicence(config, token, { allowExpired: true });
  if (!licence) throw new BillingError(401, msg("That licence is not valid"));
  const session = Session.parse(await stripe(config, "POST", "/billing_portal/sessions", { customer: licence.customer, return_url: `${base}/you` }, options));
  if (!session.url) throw new BillingError(502, msg("The payment provider did not return a billing page"));
  return { url: session.url };
}

export interface Price { amount: number; currency: string; interval: string | null }
/** What each plan costs, read from Stripe so the app never hard-codes a price. Cached for an hour. */
export function priceReader(config: BillingConfig, options: StripeOptions = {}, now: () => number = Date.now) {
  let cached: { at: number; prices: Partial<Record<PlanId, Price>> } | null = null;
  return async (): Promise<Partial<Record<PlanId, Price>>> => {
    if (cached && now() - cached.at < 3_600_000) return cached.prices;
    const prices: Partial<Record<PlanId, Price>> = {};
    let complete = true;
    await Promise.all((Object.entries(config.prices) as [PlanId, string][]).map(async ([plan, id]) => {
      try {
        const data = z.object({ unit_amount: z.number().nullable(), currency: z.string(), recurring: z.object({ interval: z.string() }).nullable().optional() })
          .parse(await stripe(config, "GET", `/prices/${encodeURIComponent(id)}`, null, options));
        if (data.unit_amount !== null) prices[plan] = { amount: data.unit_amount, currency: data.currency, interval: data.recurring?.interval ?? null };
      } catch { complete = false; /* show the plan without a price rather than fail */ }
    }));
    // A failed lookup is retried after a minute, not an hour.
    cached = { at: complete ? now() : now() - 3_540_000, prices };
    return prices;
  };
}

/** Free scored decisions per client per UTC day. In memory: it resets when the server restarts. */
export function dailyQuota(limit: number | null, now: () => number = Date.now) {
  let day = "";
  let used = new Map<string, number>();
  const roll = () => {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) { day = today; used = new Map(); }
  };
  return {
    remaining(key: string) { roll(); return limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - (used.get(key) ?? 0)); },
    spend(key: string) { roll(); used.set(key, (used.get(key) ?? 0) + 1); },
  };
}

// ---------------------------------------------------------------------------
// Webhook: Stripe tells the server about a payment even when the buyer closed the tab before returning.
// ---------------------------------------------------------------------------
const TOLERANCE_S = 300;

/** Stripe-Signature is `t=<unix>,v1=<hex>`: HMAC-SHA256 of `<t>.<raw body>` with the endpoint secret. Replays older than 5 minutes fail. */
export function verifyStripeSignature(secret: string, rawBody: string, header: string | string[] | undefined, now = Date.now()): boolean {
  if (typeof header !== "string") return false;
  const parts = header.split(",").map((part) => part.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !/^\d+$/.test(t) || Math.abs(now / 1000 - Number(t)) > TOLERANCE_S) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return signatures.some((candidate) => { const given = Buffer.from(candidate); return given.length === expected.length && timingSafeEqual(given, expected); });
}

export type Fulfilment =
  | { kind: "plan"; account: string; customer: string; subscription: string; session: string }
  | { kind: "pass"; account: string; decisionId: string; session: string };

const StripeEvent = z.object({ type: z.string(), data: z.object({ object: Session.extend({ id: z.string() }) }) });

/**
 * What a verified event asks for: a paid checkout that was made from a signed-in account. Anything else (other
 * events, an unpaid session, a checkout from a signed-out device) returns null and is acknowledged without effect.
 */
export function fulfilmentFrom(rawBody: string): Fulfilment | null {
  let event: z.infer<typeof StripeEvent>;
  try { event = StripeEvent.parse(JSON.parse(rawBody)); } catch { return null; }
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return null;
  const session = event.data.object;
  const account = session.metadata?.account;
  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (!account || !paid || session.status !== "complete") return null;
  if (session.mode === "payment") {
    const decision = DecisionId.safeParse(session.metadata?.decision);
    return decision.success ? { kind: "pass", account, decisionId: decision.data, session: session.id } : null;
  }
  if (session.mode !== "subscription" || !session.subscription || !session.customer) return null;
  return { kind: "plan", account, customer: session.customer, subscription: session.subscription, session: session.id };
}
