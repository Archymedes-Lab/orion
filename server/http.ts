// HTTP plumbing for the API server: response headers, per-client rate limiting, and the built web app.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isLocale, type Locale } from "../src/i18n/index.ts";

const asLocale = (value: unknown): Locale | null => {
  const text = typeof value === "string" ? value.trim().toLowerCase() : value;
  return isLocale(text) ? text : null;
};

/**
 * The language of this one request: the `X-Orion-Lang` header the app sends, else a `language` field in the JSON
 * body, else English. Anything else is English too. Per request, never stored: the server answers many people at once.
 */
export function requestLocale(req: IncomingMessage, body?: unknown): Locale {
  const header = req.headers?.["x-orion-lang"];
  const fromHeader = asLocale(Array.isArray(header) ? header[0] : header);
  if (fromHeader) return fromHeader;
  const given = body !== null && typeof body === "object" ? (body as { language?: unknown }).language : undefined;
  return asLocale(given) ?? "en";
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // Browsers ignore this over plain http (localhost), so it only ever pins real deployments to HTTPS.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
};
/** API answers are data, never a page: nothing in them may load or run if a browser is tricked into rendering one. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * Policy for the exported web app: its own scripts, inline styles (React Native Web writes them),
 * and the Outfit font from Google Fonts. The page calls the API on its own origin; `connect` adds others.
 */
export const contentSecurityPolicy = (connect: string[] = []) => [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src ${["'self'", ...connect].join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function json(res: ServerResponse, code: number, value: unknown, headers: Record<string, string> = {}) {
  res.writeHead(code, { ...SECURITY_HEADERS, "Content-Security-Policy": API_CSP, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(code === 204 ? undefined : JSON.stringify(value));
}

/**
 * The caller's address. Forwarded headers are trusted only when the operator says how many proxies set them.
 * Each proxy appends the address it saw, so the entry `proxies` from the end is the one our own proxy wrote;
 * everything to its left came from the client and could be made up to dodge the limits.
 */
export function clientAddress(req: IncomingMessage, proxies: number): string {
  const forwarded = proxies > 0 ? req.headers?.["x-forwarded-for"] : undefined;
  const hops = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return hops[Math.max(0, hops.length - proxies)] || req.socket?.remoteAddress || "unknown";
}

/** Fixed-window request counter per client. `limit` 0 turns it off. */
export function rateLimiter(limit: number, windowMs = 60_000, now: () => number = Date.now) {
  const seen = new Map<string, { count: number; resetAt: number }>();
  return (key: string): { allowed: boolean; retryAfter: number } => {
    if (limit <= 0) return { allowed: true, retryAfter: 0 };
    const time = now();
    // Bound memory: forget finished windows once the table grows.
    if (seen.size > 5_000) for (const [k, v] of seen) if (v.resetAt <= time) seen.delete(k);
    const entry = seen.get(key);
    if (!entry || entry.resetAt <= time) {
      seen.set(key, { count: 1, resetAt: time + windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    entry.count += 1;
    return { allowed: entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.resetAt - time) / 1000)) };
  };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
};

/**
 * Serves the exported web app from `root`. Unknown page paths get index.html (client-side routing);
 * unknown asset paths get a 404. Returns false when there is nothing to serve.
 */
export async function serveStatic(root: string, pathname: string, req: IncomingMessage, res: ServerResponse, csp: string): Promise<boolean> {
  const base = resolve(root);
  let relative: string;
  try { relative = normalize(decodeURIComponent(pathname)); } catch { return false; }
  if (relative.includes("\0")) return false;
  const asset = extname(relative) !== "";
  const candidates = asset ? [join(base, relative)] : [join(base, relative, "index.html"), join(base, `${relative}.html`), join(base, "index.html")];
  for (const file of candidates) {
    // Never leave the build directory, whatever the path says.
    if (file !== base && !file.startsWith(base + sep)) continue;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    const html = type.startsWith("text/html");
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": type,
      "Content-Length": String(info.size),
      // Exported bundles carry a content hash in their name; pages must be revalidated.
      "Cache-Control": html ? "no-cache" : /[\\/](?:_expo|assets)[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      ...(html ? { "Content-Security-Policy": csp } : {}),
    });
    if (req.method === "HEAD") { res.end(); return true; }
    await new Promise<void>((done) => {
      const stream = createReadStream(file);
      stream.on("error", () => { res.destroy(); done(); });
      stream.on("end", done);
      stream.pipe(res);
    });
    return true;
  }
  return false;
}
