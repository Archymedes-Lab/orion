// Accounts: sign up, sign in, sessions, password recovery, backup, feedback.
// Follows the OWASP Authentication and Session Management cheat sheets and NIST SP 800-63B:
// long passwords without composition rules, a slow salted hash, one generic sign-in error, throttling,
// opaque server-side sessions in an HttpOnly cookie, and sessions that end when the password changes.
// There is no email service, so "forgot password" uses a recovery code shown once at signup.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import type { Environment } from "./models.ts";
import type { Store } from "./store.ts";
import { msg, tIn, type Locale } from "../src/i18n/index.ts";

export const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;
const SESSION_DAYS = 30;
const SESSION_TTL = SESSION_DAYS * 24 * 60 * 60;
const LOCK_SECONDS = 15 * 60;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_CLIENT = 20;
const MAX_SIGNUPS_PER_CLIENT = 5;
export const MAX_BACKUP_BYTES = 300_000;
const COMMON = new Set(["password", "passwords", "password1", "password12", "password123", "1234567890", "12345678910", "qwertyuiop", "qwerty12345", "iloveyou12", "letmein123", "welcome123", "administrator", "0123456789", "abcdefghij", "orionorion", "1q2w3e4r5t", "aaaaaaaaaa", "1111111111"]);

export class AuthError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string, public readonly retryAfter?: number) { super(message); }
}

export interface AuthConfig {
  store: Store;
  /** When set, only people with one of these codes can create an account (closed beta). */
  inviteCodes: Set<string> | null;
  /** scrypt work factor. Lower only in tests. */
  cost: number;
  now: () => number;
}

export function authConfig(env: Environment, store: Store | null, overrides: Partial<AuthConfig> = {}): AuthConfig | null {
  if (!store) return null;
  const codes = (env.ORION_BETA_INVITE_CODES ?? "").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  return { store, inviteCodes: codes.length ? new Set(codes) : null, cost: 2 ** 15, now: Date.now, ...overrides };
}

export interface User {
  id: string;
  email: string;
  /** Shown in the app instead of the email. Unique, compared without case. Older accounts may have none. */
  username?: string;
  password: string;
  recovery: string;
  /** Bumped when the password changes; older sessions stop working. */
  version: number;
  createdAt: string;
  acceptedTermsAt: string;
  /** `until` is set for a prepaid plan (mobile money): Pro ends then unless paid again. */
  plan?: { customer: string; subscription: string; until?: number };
  /** Decisions a one-time pass was bought for. */
  passes?: string[];
}
export interface PublicUser { id: string; email: string; username: string; createdAt: string; pro: boolean }
const publicUser = (user: User): PublicUser => ({
  id: user.id, email: user.email, username: user.username ?? user.email.split("@")[0], createdAt: user.createdAt, pro: Boolean(user.plan) && (user.plan?.until === undefined || user.plan.until > Date.now()),
});

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const userKey = (email: string) => `user:${sha(normalizeEmail(email))}`;
/** Claims a username: points at the account that owns it. */
const usernameKey = (username: string) => `username:${username.trim().toLowerCase()}`;
export const USERNAME_RULE = "3–24 characters: letters, numbers, dots, dashes or underscores.";
export const Username = z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9._-]+$/);

const Email = z.string().trim().min(3).max(254).email();
const Password = z.string().min(1).max(MAX_PASSWORD);
export const SignupRequest = z.object({ username: Username, email: Email, password: Password, acceptTerms: z.literal(true), inviteCode: z.string().trim().max(100).optional() });
export const LoginRequest = z.object({ email: Email, password: Password });
export const RecoverRequest = z.object({ email: Email, recoveryCode: z.string().trim().min(1).max(60), newPassword: Password });
export const DeleteRequest = z.object({ password: Password });
export const BackupRequest = z.object({ data: z.object({ app: z.literal("orion"), version: z.number(), exportedAt: z.string(), tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))) }) });
export const FeedbackRequest = z.object({ message: z.string().trim().min(3).max(2000), page: z.string().max(200).optional(), kind: z.enum(["idea", "problem", "other"]).default("other") });
export const ClientErrorRequest = z.object({ message: z.string().max(500), page: z.string().max(200).optional(), version: z.string().max(40).optional() });

/**
 * Why a password is not acceptable, or null, in the given language. Length and not-being-guessable matter; character
 * classes do not.
 */
export function passwordProblem(password: string, email: string, locale: Locale = "en"): string | null {
  if (password.length < MIN_PASSWORD) return tIn(locale, "Use at least {n} characters. A few unrelated words work well.", { n: MIN_PASSWORD });
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return tIn(locale, "That password is too easy to guess. Try a few unrelated words.");
  const name = normalizeEmail(email).split("@")[0];
  if (name.length >= 4 && lower.includes(name)) return tIn(locale, "Do not use your email address in your password.");
  return null;
}

function hashPassword(password: string, cost: number, salt = randomBytes(16)): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, 64, { N: cost, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(`scrypt$${cost}$${salt.toString("base64url")}$${key.toString("base64url")}`));
  });
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = (await hashPassword(password, Number(cost), Buffer.from(salt, "base64url"))).split("$")[3];
  const a = Buffer.from(candidate), b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Twenty characters from an alphabet without look-alikes (no 0/O, 1/I/L), in groups of five. */
export function newRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return chars.match(/.{5}/g)!.join("-");
}
const recoveryHash = (code: string) => sha(code.toUpperCase().replace(/[^A-Z0-9]/g, ""));

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
const COOKIE = "orion_session";
/** `__Host-` binds the cookie to this exact host over HTTPS; plain http is only ever localhost. */
const cookieName = (secure: boolean) => (secure ? `__Host-${COOKIE}` : COOKIE);
export const isSecure = (req: IncomingMessage) => !/^(localhost|127\.0\.0\.1)(:|$)/.test(String(req.headers?.host ?? ""));

export function sessionCookie(token: string | null, secure: boolean): string {
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return token ? `${cookieName(secure)}=${token}; Max-Age=${SESSION_TTL}; ${attributes}` : `${cookieName(secure)}=; Max-Age=0; ${attributes}`;
}
function readCookie(req: IncomingMessage): string | null {
  const header = String(req.headers?.cookie ?? "");
  const name = cookieName(isSecure(req));
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

async function startSession(config: AuthConfig, user: User): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  // Only a hash of the token is stored: reading the store does not hand out working sessions.
  await config.store.set(`session:${sha(token)}`, JSON.stringify({ key: userKey(user.email), id: user.id, version: user.version }), SESSION_TTL);
  return token;
}

/** The signed-in user for this request, or null. */
export async function currentUser(config: AuthConfig, req: IncomingMessage): Promise<User | null> {
  const token = readCookie(req);
  if (!token || token.length > 200) return null;
  const session = await config.store.get(`session:${sha(token)}`);
  if (!session) return null;
  const { key, id, version } = JSON.parse(session) as { key: string; id?: string; version: number };
  const raw = await config.store.get(key);
  if (!raw) return null;
  const user = JSON.parse(raw) as User;
  // The id ties a session to one account: after an account is deleted, a new one made with the same email
  // must not be opened by the old one's cookies.
  return user.id === id && user.version === version ? user : null;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
async function throttle(config: AuthConfig, key: string, limit: number, message: string) {
  const count = Number(await config.store.get(key) ?? 0);
  if (count >= limit) throw new AuthError(429, message, "too_many_attempts", LOCK_SECONDS);
}

/** `locale` words a weak-password answer; every other message is translated where the response is sent. */
export async function signup(config: AuthConfig, input: z.infer<typeof SignupRequest>, client: string, locale: Locale = "en") {
  if (config.inviteCodes && !config.inviteCodes.has((input.inviteCode ?? "").toLowerCase())) {
    throw new AuthError(403, msg("ORION is in a closed beta. Enter a valid invite code to create an account."), "invite_required");
  }
  const problem = passwordProblem(input.password, input.email, locale);
  if (problem) throw new AuthError(400, problem, "weak_password");
  if (await config.store.incr(`signups:${client}`, 60 * 60) > MAX_SIGNUPS_PER_CLIENT) {
    throw new AuthError(429, msg("Too many new accounts from this network. Try again in an hour."), "too_many_attempts", 3600);
  }
  const recoveryCode = newRecoveryCode();
  const time = new Date(config.now()).toISOString();
  const user: User = {
    id: `usr_${randomBytes(12).toString("base64url")}`, email: normalizeEmail(input.email), username: input.username.trim(),
    password: await hashPassword(input.password, config.cost), recovery: recoveryHash(recoveryCode),
    version: 1, createdAt: time, acceptedTermsAt: time,
  };
  // The username is claimed first and given back if the email turns out to be taken.
  if (!await config.store.setIfAbsent(usernameKey(input.username), userKey(user.email))) {
    throw new AuthError(409, msg("That username is taken. Try another."), "username_taken");
  }
  // Without an email service an address cannot be confirmed privately, so signup has to say when it is taken.
  if (!await config.store.setIfAbsent(userKey(user.email), JSON.stringify(user))) {
    await config.store.del(usernameKey(input.username));
    throw new AuthError(409, msg("An account with this email already exists. Sign in instead."), "email_taken");
  }
  return { user: publicUser(user), recoveryCode, token: await startSession(config, user) };
}

const BAD_LOGIN = msg("That email or password is not right.");

export async function login(config: AuthConfig, input: z.infer<typeof LoginRequest>, client: string) {
  const key = userKey(input.email);
  const failures = `failures:${sha(key)}`;
  await throttle(config, failures, MAX_FAILURES_PER_EMAIL, msg("Too many attempts. Wait 15 minutes, or reset your password with your recovery code."));
  await throttle(config, `failures:client:${client}`, MAX_FAILURES_PER_CLIENT, msg("Too many attempts from this network. Wait 15 minutes."));
  const raw = await config.store.get(key);
  const user = raw ? JSON.parse(raw) as User : null;
  // Hash even when there is no such account, so the answer takes the same time either way.
  const ok = await verifyPassword(input.password, user?.password ?? `scrypt$${config.cost}$${"A".repeat(22)}$${"A".repeat(86)}`);
  if (!user || !ok) {
    await config.store.incr(failures, LOCK_SECONDS);
    await config.store.incr(`failures:client:${client}`, LOCK_SECONDS);
    throw new AuthError(401, BAD_LOGIN, "bad_credentials");
  }
  await config.store.del(failures);
  return { user: publicUser(user), token: await startSession(config, user) };
}

export async function logout(config: AuthConfig, req: IncomingMessage) {
  const token = readCookie(req);
  if (token) await config.store.del(`session:${sha(token)}`);
}

/** Sets a new password with the recovery code, signs every device out, and issues a new code. */
export async function recover(config: AuthConfig, input: z.infer<typeof RecoverRequest>, client: string, locale: Locale = "en") {
  const key = userKey(input.email);
  const failures = `recover:${sha(key)}`;
  await throttle(config, failures, MAX_FAILURES_PER_EMAIL, msg("Too many attempts. Wait 15 minutes."));
  await throttle(config, `failures:client:${client}`, MAX_FAILURES_PER_CLIENT, msg("Too many attempts from this network. Wait 15 minutes."));
  const raw = await config.store.get(key);
  const user = raw ? JSON.parse(raw) as User : null;
  const given = Buffer.from(recoveryHash(input.recoveryCode)), expected = Buffer.from(user?.recovery ?? sha("none"));
  if (!user || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    await config.store.incr(failures, LOCK_SECONDS);
    await config.store.incr(`failures:client:${client}`, LOCK_SECONDS);
    throw new AuthError(401, msg("That email or recovery code is not right."), "bad_credentials");
  }
  const problem = passwordProblem(input.newPassword, user.email, locale);
  if (problem) throw new AuthError(400, problem, "weak_password");
  const recoveryCode = newRecoveryCode();
  const updated: User = { ...user, password: await hashPassword(input.newPassword, config.cost), recovery: recoveryHash(recoveryCode), version: user.version + 1 };
  await config.store.set(key, JSON.stringify(updated));
  await config.store.del(failures, `failures:${sha(key)}`);
  return { user: publicUser(updated), recoveryCode, token: await startSession(config, updated) };
}

export async function deleteAccount(config: AuthConfig, user: User, password: string) {
  if (!await verifyPassword(password, user.password)) throw new AuthError(401, msg("That password is not right."), "bad_credentials");
  // The user record goes first: every session depends on it, so they all stop working at once.
  await config.store.del(userKey(user.email), backupKey(user, "app"), backupKey(user, "web"), ...(user.username ? [usernameKey(user.username)] : []));
}

/** "app": the Expo app's device data. "web": the web app's, kept apart so neither overwrites the other. */
export type BackupSlot = "app" | "web";
const backupKey = (user: User, slot: BackupSlot) => (slot === "web" ? `backup:web:${user.id}` : `backup:${user.id}`);

export async function saveBackup(config: AuthConfig, user: User, data: unknown, slot: BackupSlot = "app") {
  const text = JSON.stringify(data);
  if (Buffer.byteLength(text) > MAX_BACKUP_BYTES) throw new AuthError(413, msg("Your history is too large to back up right now."), "backup_too_large");
  await config.store.set(backupKey(user, slot), text);
  return { savedAt: new Date(config.now()).toISOString() };
}
export async function readBackup(config: AuthConfig, user: User, slot: BackupSlot = "app"): Promise<unknown | null> {
  const raw = await config.store.get(backupKey(user, slot));
  return raw ? JSON.parse(raw) : null;
}

/**
 * Records that a purchase belongs to this account. False when another account already holds it, so one payment
 * cannot be passed around to unlock several accounts.
 */
export async function claimPurchase(config: AuthConfig, user: User, purchase: string): Promise<boolean> {
  const key = `purchase:${sha(purchase)}`;
  return await config.store.setIfAbsent(key, user.id) || await config.store.get(key) === user.id;
}

/** The account for an email address, or null. Used where no session exists, such as a payment webhook. */
export async function userByEmail(config: AuthConfig, email: string): Promise<User | null> {
  const raw = await config.store.get(userKey(email));
  return raw ? JSON.parse(raw) as User : null;
}

/** Links a paid subscription to the account, so the plan follows the person to any device. */
export async function attachPlan(config: AuthConfig, user: User, plan: { customer: string; subscription: string; until?: number }) {
  await config.store.set(userKey(user.email), JSON.stringify({ ...user, plan }));
}

/** Remembers a one-time pass on the account, so it works on any device the person signs in on. */
export async function attachPass(config: AuthConfig, user: User, decisionId: string) {
  if (user.passes?.includes(decisionId)) return;
  await config.store.set(userKey(user.email), JSON.stringify({ ...user, passes: [...(user.passes ?? []), decisionId].slice(-200) }));
}

export async function saveFeedback(config: AuthConfig, input: z.infer<typeof FeedbackRequest>, user: User | null) {
  await config.store.push("feedback", JSON.stringify({ at: new Date(config.now()).toISOString(), user: user?.id ?? null, ...input }), 1000);
}
