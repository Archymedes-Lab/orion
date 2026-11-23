// Browser client for the ORION API, through this site's own /api/orion proxy. Every request names the interface
// language (X-Orion-Lang), so the server and its models answer in it.
import { getLocale, t } from "@orion/i18n/index.ts";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public body?: Record<string, unknown>) { super(message); }
}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown, init: { signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Orion-Lang": getLocale() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api/orion/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    signal: init.signal,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? t("Something went wrong.")), json.code as string | undefined, json);
  return json as T;
}
