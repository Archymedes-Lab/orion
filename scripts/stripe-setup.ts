// Creates what ORION needs in a Stripe account and prints the env lines to paste. Safe to run again: prices are
// found by lookup key, the portal is updated in place, and a webhook for the same URL is reused.
//
//   STRIPE_SECRET_KEY=sk_test_… bun scripts/stripe-setup.ts https://your-app.example.com
//
// Run it with a test key first, then again with the live key. Amounts come from `suggestedUsd` in src/billing/plans.ts.
import { PLANS, type PlanId } from "../src/billing/plans.ts";

const key = process.env.STRIPE_SECRET_KEY;
const site = process.argv[2]?.replace(/\/+$/, "");
if (!key || !/^(sk|rk)_(test|live)_/.test(key) || !site?.startsWith("https://")) {
  console.error("Usage: STRIPE_SECRET_KEY=sk_test_… bun scripts/stripe-setup.ts https://your-app.example.com");
  process.exit(1);
}

async function stripe(method: "GET" | "POST", path: string, params?: Record<string, string>): Promise<any> {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${data?.error?.message ?? response.status}`);
  return data;
}

const live = key.includes("_live_");
console.log(`Stripe ${live ? "LIVE" : "test"} mode, site ${site}\n`);

// 1. One product, three prices found by lookup key so a rerun does not create duplicates.
const product = (await stripe("GET", "/products/search?query=" + encodeURIComponent("metadata['orion']:'pro'"))).data[0]
  ?? await stripe("POST", "/products", { name: "ORION Pro", "metadata[orion]": "pro" });

const ids: Record<PlanId, string> = {} as Record<PlanId, string>;
for (const [plan, info] of Object.entries(PLANS) as [PlanId, (typeof PLANS)[PlanId]][]) {
  const lookup = `orion_${plan}`;
  const found = (await stripe("GET", `/prices?lookup_keys[]=${lookup}&active=true`)).data[0];
  const price = found ?? await stripe("POST", "/prices", {
    product: product.id, currency: "usd", unit_amount: String(Math.round(info.suggestedUsd * 100)), lookup_key: lookup, nickname: info.name,
    ...(plan === "monthly" ? { "recurring[interval]": "month" } : plan === "yearly" ? { "recurring[interval]": "year" } : {}),
  });
  ids[plan] = price.id;
  console.log(`${found ? "found  " : "created"} ${plan.padEnd(8)} ${price.id}  ${(price.unit_amount / 100).toFixed(2)} ${price.currency}`);
}

// 2. Customer portal: cancel, change card, see invoices. Without a saved configuration the portal link fails.
const portal = {
  "business_profile[headline]": "Manage your ORION subscription",
  "features[invoice_history][enabled]": "true",
  "features[payment_method_update][enabled]": "true",
  "features[subscription_cancel][enabled]": "true",
  "features[subscription_cancel][mode]": "at_period_end",
  "default_return_url": `${site}/you`,
};
const existing = (await stripe("GET", "/billing_portal/configurations?is_default=true")).data[0];
await stripe("POST", existing ? `/billing_portal/configurations/${existing.id}` : "/billing_portal/configurations", portal);
console.log(`${existing ? "updated" : "created"} customer portal`);

// 3. Webhook: lets a purchase reach the account even when the buyer closes the tab before returning.
const endpointUrl = `${site}/billing/stripe-webhook`;
const hook = (await stripe("GET", "/webhook_endpoints?limit=100")).data.find((e: { url: string }) => e.url === endpointUrl);
let secret = "";
if (hook) console.log(`found   webhook ${hook.id} (its signing secret is only shown at creation: reveal it in the dashboard)`);
else {
  const made = await stripe("POST", "/webhook_endpoints", { url: endpointUrl, "enabled_events[0]": "checkout.session.completed", "enabled_events[1]": "checkout.session.async_payment_succeeded" });
  secret = made.secret;
  console.log(`created webhook ${made.id}`);
}

console.log(`\nAdd to the server environment:\n`);
console.log(`STRIPE_SECRET_KEY=${live ? "sk_live_…" : "sk_test_…"}   (the key you ran this with)`);
console.log(`STRIPE_PRICE_YEARLY=${ids.yearly}\nSTRIPE_PRICE_MONTHLY=${ids.monthly}\nSTRIPE_PRICE_PASS=${ids.pass}`);
console.log(`STRIPE_WEBHOOK_SECRET=${secret || "whsec_… (from the dashboard)"}\nORION_PUBLIC_URL=${site}\nORION_LICENSE_SECRET=$(openssl rand -hex 32)   (once; keep it, changing it signs everyone out of Pro)`);
