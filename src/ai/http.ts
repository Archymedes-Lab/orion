import { getLocale } from "../i18n/index.ts";

/** Our own API base. Empty = offline mode (local heuristics only); "/" = the origin that serves the page. */
export const API_BASE: string =
  (typeof process !== "undefined" &&
    process.env.EXPO_PUBLIC_ORION_API) ||
  "";
export const endpoint = (path: string) => `${API_BASE.replace(/\/$/, "")}${path}`;
export const apiEnabled = (): boolean => API_BASE.length > 0;

export class HttpError extends Error {
  constructor(public readonly status: number) { super(`Decision service unavailable (${status})`); }
}

/** Called when the server says the session is gone, so the app can go back to the sign-in page. */
let signedOut: () => void = () => {};
export const onSignedOut = (handler: () => void) => { signedOut = handler; };

/** RN-compatible deadline covering both the request and response body. */
export async function postJSON(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController();
  // Longer than the server can spend on one request: Jev's 20 s, then the router's 45 s across fallback models.
  // The loading screen has Cancel.
  const timer = setTimeout(() => controller.abort(), 75_000);
  try {
    const response = await fetch(url, {
      method: "POST", // The language travels with every call, so the model writes in it.
      headers: { "Content-Type": "application/json", "X-Orion-Lang": getLocale(), ...headers },
      body: JSON.stringify(body), signal: controller.signal, credentials: "include",
    });
    if (response.status === 401 && (await response.clone().json().catch(() => null) as { code?: unknown } | null)?.code === "signed_out") signedOut();
    if (!response.ok) throw new HttpError(response.status);
    return await response.json();
  } finally { clearTimeout(timer); }
}

/** For calls where the caller needs the status and the server's own message (sign-in, backup). Never throws. */
export async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint(path), {
      method, signal: controller.signal, credentials: "include",
      headers: { "X-Orion-Lang": getLocale(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, body: (json && typeof json === "object" ? json : {}) as Record<string, unknown> };
  } catch { return { status: 0, body: {} }; } finally { clearTimeout(timer); }
}
