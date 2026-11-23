// The person's plan on this device. There are no accounts: a paid checkout is exchanged for a signed licence,
// kept here and renewed by the server only while the subscription is active.
import { create } from "zustand";
import { HttpError, apiEnabled, endpoint, postJSON, request } from "../ai/http.ts";
import { canUse, type PaidFeature, type PlanId } from "./plans.ts";
import { getLocale, intlLocale, t } from "../i18n/index.ts";
import { serverMessage } from "../account/serverMessage.ts";

const STORE_KEY = "orion.licence.v1";
const PASS_KEY = "orion.passes.v1";
/** A mobile money payment that was started but not yet confirmed, so a reload can pick it up again. */
const PENDING_KEY = "orion.mobile-money.v1";
/** Renew when less than this is left, so a licence does not lapse mid-session. */
const RENEW_BEFORE_MS = 6 * 60 * 60 * 1000;

export interface Price { amount: number; currency: string; interval: string | null }
export interface PlanState {
  /** Billing is set up on the server. When false, nothing is limited and no plan is shown. */
  enabled: boolean;
  ready: boolean;
  pro: boolean;
  /** Abuse cap on scored decisions a day for people who have not paid; null when there is none. */
  freeDaily: number | null;
  /** What each plan on sale costs, from Stripe. A plan that is missing is not on sale. */
  prices: Partial<Record<PlanId, Price>>;
  /** Mobile money (MTN / Airtel Rwanda, through Paypack) prices in RWF; null when it is not offered. */
  mobileMoney: Partial<Record<PlanId, Price>> | null;
  /** When Pro was paid for with mobile money: the end of the paid period (it does not renew by itself). */
  until: number | null;
  /** Decisions a one-time pass was bought for on this device or account. */
  passes: string[];
  /** Whether a paid feature is open (always, when billing is not set up). */
  can: (feature: PaidFeature, decisionId?: string | null) => boolean;
  /** The server refused to score because today's free decisions are used up. */
  quotaReached: boolean;
  load: () => Promise<void>;
  /** After Stripe sends the person back with a checkout session id. */
  activate: (sessionId: string) => Promise<boolean>;
  /** Address of the Stripe page to go to, or null if it could not be created. */
  checkoutUrl: (plan?: PlanId, decisionId?: string | null) => Promise<string | null>;
  portalUrl: () => Promise<string | null>;
  /** Sends a payment prompt to the phone. Returns the ticket to check, or the server's reason. */
  startMobileMoney: (plan: PlanId, phone: string, decisionId?: string | null) => Promise<{ ticket: string } | { error: string }>;
  /** Asks whether the phone payment went through; on "paid" the plan or pass is already applied. */
  checkMobileMoney: (ticket: string) => Promise<"pending" | "paid" | "failed" | "error">;
  noteQuota: (reached: boolean) => void;
}

interface Stored { token: string; expiresAt: number; until?: number }
let memory: Stored | null = null;

function read(): Stored | null {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Stored | null;
      if (saved && typeof saved.token === "string" && typeof saved.expiresAt === "number") memory = saved;
    }
  } catch { /* blocked or corrupt storage: fall back to memory */ }
  return memory;
}
function write(value: Stored | null) {
  memory = value;
  try {
    if (typeof localStorage === "undefined") return;
    if (value) localStorage.setItem(STORE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* keep it in memory */ }
}

function readPasses(): Record<string, string> {
  try {
    const saved = typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem(PASS_KEY) ?? "{}") : passMemory;
    if (saved && typeof saved === "object") passMemory = saved as Record<string, string>;
  } catch { /* fall back to memory */ }
  return passMemory;
}
let passMemory: Record<string, string> = {};
function rememberPass(decisionId: string, token: string): string[] {
  passMemory = { ...readPasses(), [decisionId]: token };
  try { if (typeof localStorage !== "undefined") localStorage.setItem(PASS_KEY, JSON.stringify(passMemory)); } catch { /* keep it in memory */ }
  return Object.keys(passMemory);
}
const asPass = (json: unknown): { decisionId: string; token: string } | null => {
  const pass = (json as { pass?: { decisionId?: unknown; token?: unknown } })?.pass ?? (json as { decisionId?: unknown; token?: unknown });
  return typeof pass?.decisionId === "string" && typeof pass.token === "string" ? { decisionId: pass.decisionId, token: pass.token } : null;
};

/** Authorization header for scoring requests, when this device holds a licence that has not expired. */
export function licenceHeader(now = Date.now()): Record<string, string> {
  const stored = memory ?? read();
  return stored && stored.expiresAt > now ? { Authorization: `Bearer ${stored.token}` } : {};
}

const asStored = (json: unknown): Stored | null => {
  const value = json as { token?: unknown; expiresAt?: unknown; until?: unknown };
  if (typeof value?.token !== "string" || typeof value.expiresAt !== "number") return null;
  return { token: value.token, expiresAt: value.expiresAt, ...(typeof value.until === "number" ? { until: value.until } : {}) };
};

function pendingTicket(): string | null {
  try { return typeof localStorage !== "undefined" ? localStorage.getItem(PENDING_KEY) : null; } catch { return null; }
}
function rememberTicket(ticket: string | null) {
  try {
    if (typeof localStorage === "undefined") return;
    if (ticket) localStorage.setItem(PENDING_KEY, ticket); else localStorage.removeItem(PENDING_KEY);
  } catch { /* the payment still completes; only resuming after a reload is lost */ }
}
/** Only ever send people to Stripe's own pages. */
export const stripeUrl = (json: unknown): string | null => {
  const url = (json as { url?: unknown })?.url;
  return typeof url === "string" && /^https:\/\/[a-z0-9.-]+\.stripe\.com\//.test(url) ? url : null;
};

export const usePlan = create<PlanState>((set, get) => ({
  enabled: false,
  ready: false,
  pro: false,
  freeDaily: null,
  prices: {},
  mobileMoney: null,
  until: null,
  passes: [],
  quotaReached: false,
  can: (feature, decisionId) => canUse(feature, { billing: get().enabled, pro: get().pro, passes: get().passes }, decisionId),

  load: async () => {
    if (!apiEnabled()) { set({ ready: true }); return; }
    try {
      const response = await fetch(endpoint("/billing/plan"));
      const plan = await response.json() as { enabled?: unknown; freeDaily?: unknown; prices?: Partial<Record<PlanId, Price>>; mobileMoney?: { prices?: Partial<Record<PlanId, Price>> } | null };
      if (!response.ok || plan.enabled !== true) { set({ enabled: false, ready: true, pro: false }); return; }
      set({
        enabled: true, freeDaily: typeof plan.freeDaily === "number" ? plan.freeDaily : null, prices: plan.prices ?? {},
        mobileMoney: plan.mobileMoney?.prices && Object.keys(plan.mobileMoney.prices).length > 0 ? plan.mobileMoney.prices : null,
        passes: Object.keys(readPasses()),
      });
    } catch { set({ ready: true }); return; }

    let stored = read();
    if (stored && stored.expiresAt - Date.now() < RENEW_BEFORE_MS) {
      try {
        stored = asStored(await postJSON(endpoint("/billing/refresh"), { token: stored.token }));
        write(stored);
      } catch (error) {
        // 401/402: the subscription ended. Anything else (offline, server down): keep what we have until it expires.
        if (error instanceof HttpError && (error.status === 401 || error.status === 402)) { stored = null; write(null); }
      }
    }
    const pro = !!stored && stored.expiresAt > Date.now();
    set({ ready: true, pro, until: pro ? stored?.until ?? null : null, quotaReached: pro ? false : get().quotaReached });
    // A phone payment that was approved after the page closed: pick it up once, quietly.
    const waiting = pendingTicket();
    if (waiting && get().mobileMoney) void get().checkMobileMoney(waiting);
  },

  activate: async (sessionId) => {
    try {
      const json = await postJSON(endpoint("/billing/activate"), { sessionId });
      const pass = (json as { pass?: unknown }).pass ? asPass(json) : null;
      if (pass) { set({ passes: rememberPass(pass.decisionId, pass.token) }); return true; }
      const stored = asStored(json);
      if (!stored) return false;
      write(stored);
      set({ pro: true, until: stored.until ?? null, quotaReached: false });
      return true;
    } catch { return false; }
  },

  checkoutUrl: async (plan, decisionId) => {
    try { return stripeUrl(await postJSON(endpoint("/billing/checkout"), { plan, decisionId: decisionId ?? undefined })); } catch { return null; }
  },
  startMobileMoney: async (plan, phone, decisionId) => {
    const { status, body } = await request("POST", "/billing/paypack/start", { plan, phone, decisionId: decisionId ?? undefined });
    if (status === 200 && typeof body.ticket === "string") { rememberTicket(body.ticket); return { ticket: body.ticket }; }
    return { error: serverMessage(body, t("Could not reach mobile money. Check your connection and try again.")) };
  },
  checkMobileMoney: async (ticket) => {
    const { status, body } = await request("POST", "/billing/paypack/status", { ticket });
    if (status !== 200) {
      // A ticket the server will never accept (too old, not ours, a mismatch) is not worth keeping.
      if (status === 400 || status === 402 || status === 410) rememberTicket(null);
      return "error";
    }
    if (body.status === "pending") return "pending";
    rememberTicket(null);
    if (body.status === "failed") return "failed";
    if (body.status !== "paid") return "error";
    const pass = body.pass ? asPass(body) : null;
    if (pass) { set({ passes: rememberPass(pass.decisionId, pass.token) }); return "paid"; }
    const stored = asStored(body);
    if (!stored) return "error";
    write(stored);
    set({ pro: true, until: stored.until ?? null, quotaReached: false });
    return "paid";
  },
  portalUrl: async () => {
    const stored = read();
    if (!stored) return null;
    try { return stripeUrl(await postJSON(endpoint("/billing/portal"), { token: stored.token })); } catch { return null; }
  },
  noteQuota: (reached) => set({ quotaReached: reached }),
}));

/** A licence that came with the signed-in account (the subscription was bought on another device). */
export function acceptLicence(json: unknown) {
  const stored = asStored(json);
  if (!stored) return;
  write(stored);
  usePlan.setState({ pro: true, until: stored.until ?? null, quotaReached: false });
}

/** Removes the licence and passes kept on this device, when the account they belong to signs out. */
export function forgetPlan() {
  write(null);
  passMemory = {};
  try { if (typeof localStorage !== "undefined") localStorage.removeItem(PASS_KEY); } catch { /* memory is already cleared */ }
  usePlan.setState({ pro: false, passes: [], quotaReached: false });
}

/** Passes that came with the signed-in account (bought on another device). */
export function acceptPasses(list: unknown) {
  if (!Array.isArray(list)) return;
  let passes = usePlan.getState().passes;
  for (const item of list) { const pass = asPass(item); if (pass) passes = rememberPass(pass.decisionId, pass.token); }
  usePlan.setState({ passes });
}

/**
 * "$6.00 / month", in the person's locale. Stripe amounts are in the currency's smallest unit (cents, but whole
 * francs or yen). The amount and currency stay as they are; only the number format and the interval follow the
 * interface language (English keeps the device's own number format).
 */
export function formatPrice(price: Price, locale: string | undefined = getLocale() === "en" ? undefined : intlLocale()): string {
  let amount: string;
  try {
    const format = new Intl.NumberFormat(locale, { style: "currency", currency: price.currency.toUpperCase() });
    amount = format.format(price.amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
  } catch { amount = `${price.amount} ${price.currency.toUpperCase()}`; }
  if (!price.interval) return amount;
  if (price.interval === "month") return t("{amount} / month", { amount });
  if (price.interval === "year") return t("{amount} / year", { amount });
  return `${amount} / ${price.interval}`;
}
