// Where accounts, sessions and backups live. The server itself keeps nothing between requests when it runs as
// serverless functions, so anything that must survive goes through this small key-value interface.
// Production: Upstash Redis over its REST API (plain fetch, no SDK). Development and tests: memory.
import type { Environment } from "./models.ts";

export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Writes only if the key does not exist. Returns whether it wrote. */
  setIfAbsent(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  /** Adds one to a counter that expires `ttlSeconds` after its first increment. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Puts a value at the front of a list and keeps only the newest `cap` entries; `ttlSeconds` expires the list. */
  push(key: string, value: string, cap: number, ttlSeconds?: number): Promise<void>;
  /** A list's entries, newest first. */
  list(key: string): Promise<string[]>;
}

export class StoreError extends Error {}

export function memoryStore(now: () => number = Date.now): Store {
  const data = new Map<string, { value: string; expires: number }>();
  const lists = new Map<string, { items: string[]; expires: number }>();
  const live = (key: string) => {
    const entry = data.get(key);
    if (entry && entry.expires <= now()) { data.delete(key); return undefined; }
    return entry;
  };
  const expiry = (ttl?: number) => (ttl ? now() + ttl * 1000 : Number.POSITIVE_INFINITY);
  return {
    async get(key) { return live(key)?.value ?? null; },
    async set(key, value, ttl) { data.set(key, { value, expires: expiry(ttl) }); },
    async setIfAbsent(key, value, ttl) { if (live(key)) return false; data.set(key, { value, expires: expiry(ttl) }); return true; },
    async del(...keys) { for (const key of keys) { data.delete(key); lists.delete(key); } },
    async incr(key, ttl) {
      const entry = live(key);
      const next = Number(entry?.value ?? 0) + 1;
      data.set(key, { value: String(next), expires: entry?.expires ?? expiry(ttl) });
      return next;
    },
    async push(key, value, cap, ttl) {
      const current = lists.get(key);
      const items = current && current.expires > now() ? current.items : [];
      lists.set(key, { items: [value, ...items].slice(0, cap), expires: ttl ? expiry(ttl) : current?.expires ?? Number.POSITIVE_INFINITY });
    },
    async list(key) {
      const current = lists.get(key);
      if (current && current.expires <= now()) { lists.delete(key); return []; }
      return [...(current?.items ?? [])];
    },
  };
}

/** Upstash Redis REST: each command is a JSON array POSTed to the database URL. */
export function upstashStore(url: string, token: string, fetchImpl: typeof fetch = fetch): Store {
  const base = url.replace(/\/+$/, "");
  const send = async (path: string, body: unknown): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new StoreError(`store_http_${response.status}`);
      return await response.json();
    } catch (error) {
      throw error instanceof StoreError ? error : new StoreError("store_unreachable");
    } finally { clearTimeout(timer); }
  };
  const run = async (...command: (string | number)[]) => {
    const reply = await send("", command) as { result?: unknown; error?: string };
    if (reply.error) throw new StoreError("store_command_failed");
    return reply.result;
  };
  const withTtl = (command: (string | number)[], ttl?: number) => (ttl ? [...command, "EX", ttl] : command);
  return {
    async get(key) { const value = await run("GET", key); return typeof value === "string" ? value : null; },
    async set(key, value, ttl) { await run(...withTtl(["SET", key, value], ttl)); },
    async setIfAbsent(key, value, ttl) { return (await run(...withTtl(["SET", key, value], ttl), "NX")) === "OK"; },
    async del(...keys) { if (keys.length) await run("DEL", ...keys); },
    async incr(key, ttl) {
      const replies = await send("/pipeline", [["INCR", key], ["EXPIRE", key, ttl, "NX"]]) as { result?: unknown; error?: string }[];
      if (!Array.isArray(replies) || replies[0]?.error) throw new StoreError("store_command_failed");
      return Number(replies[0].result);
    },
    async push(key, value, cap, ttl) {
      await send("/pipeline", [["LPUSH", key, value], ["LTRIM", key, 0, cap - 1], ...(ttl ? [["EXPIRE", key, ttl]] : [])]);
    },
    async list(key) { const value = await run("LRANGE", key, 0, -1); return Array.isArray(value) ? value.map(String) : []; },
  };
}

/** Which store the environment configures: Upstash (durable), memory (local only), or none. */
export function storeKind(env: Environment): "upstash" | "memory" | "none" {
  if ((env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL) && (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)) return "upstash";
  return env.ORION_ACCOUNT_STORE === "memory" ? "memory" : "none";
}

/** The store this environment asks for, or null when accounts are not set up. */
export function storeFrom(env: Environment, fetchImpl?: typeof fetch): Store | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) {
    if (!url.startsWith("https://")) throw new Error("The account store URL must be https.");
    return upstashStore(url, token, fetchImpl);
  }
  // For local development only: accounts vanish when the server stops.
  return env.ORION_ACCOUNT_STORE === "memory" ? memoryStore() : null;
}
