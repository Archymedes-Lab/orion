// Same-origin proxy to the ORION API (server/index.ts). The browser only ever talks to this site, so the session
// cookie is first-party and provider keys never leave the API server. ORION_API points at it (default: local dev).
import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { isLocale, tIn } from "@orion/i18n/index.ts";
import { LOCALE_COOKIE, localeFrom } from "@/lib/locale";

const API = (process.env.ORION_API ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const ALLOWED = /^(decision\/(parse|score-factors|triage|aftermath|explain|creative|prioritize|downside)|tasks\/(score|split)|boards\/(list|read|create|ops|invite|join|leave|delete)|auth\/(config|me|login|signup|logout|recover)|account\/web-backup|share(\/[A-Za-z0-9_-]{16,40}(\/(respond|results))?)?|billing\/plan|health|feedback|client-error)$/;
// Shared with the API (ORION_PROXY_SECRET on both). Without it every visitor reaches the API from this server's
// address and shares one set of limits: five signups an hour, a lockout after twenty wrong passwords, and so on.
const SECRET = process.env.ORION_PROXY_SECRET;

/** "address|timestamp|signature", checked by server/visitors.ts verifiedClient. Keep the two in step. */
function signedClient(address: string) {
  const now = Date.now();
  return `${address}|${now}|${createHmac("sha256", SECRET!).update(`${address}|${now}`).digest("base64url")}`;
}

/** The interface language: the client's X-Orion-Lang, else the language cookie, else the browser's preference. */
function language(req: NextRequest) {
  const sent = req.headers.get("x-orion-lang")?.trim().toLowerCase();
  return isLocale(sent) ? sent : localeFrom(req.cookies.get(LOCALE_COOKIE)?.value, req.headers.get("accept-language"));
}

async function forward(req: NextRequest, path: string[]) {
  const route = path.join("/");
  const lang = language(req);
  if (!ALLOWED.test(route)) return Response.json({ error: tIn(lang, "Not found") }, { status: 404 });
  const headers = new Headers({ "Content-Type": "application/json", "X-Orion-Lang": lang });
  for (const name of ["cookie", "authorization", "user-agent"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Vercel writes the visitor's address here itself; a client cannot set it.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim();
  if (ip) headers.set("x-forwarded-for", ip);
  if (ip && SECRET) headers.set("x-orion-client", signedClient(ip));
  try {
    const upstream = await fetch(`${API}/${route}`, {
      method: req.method,
      headers,
      body: req.method === "GET" ? undefined : await req.text(),
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
    });
    const out = new Headers({ "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" });
    for (const cookie of upstream.headers.getSetCookie()) out.append("Set-Cookie", cookie);
    const retry = upstream.headers.get("retry-after");
    if (retry) out.set("Retry-After", retry);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch {
    return Response.json({ error: tIn(lang, "ORION’s server can’t be reached right now."), code: "unreachable" }, { status: 503 });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: NextRequest, ctx: Ctx) { return forward(req, (await ctx.params).path); }
export async function POST(req: NextRequest, ctx: Ctx) { return forward(req, (await ctx.params).path); }
