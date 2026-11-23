// The signed-in account on this device. The session itself is an HttpOnly cookie the app cannot read;
// this store only mirrors who the server says is signed in.
import { create } from "zustand";
import { apiEnabled, onSignedOut, request } from "../ai/http.ts";
import { acceptLicence, acceptPasses, forgetPlan } from "../billing/plan.ts";
import { eraseAllData, exportData, importData } from "../db/decisions.ts";
import { useBusiness } from "../business/profile.ts";
import { msg, t } from "../i18n/index.ts";
import { serverMessage } from "./serverMessage.ts";

export interface AccountUser { id: string; email: string; username: string; createdAt: string; pro: boolean }
export type Result = { ok: true; recoveryCode?: string } | { ok: false; error: string; code?: string };

export interface AccountState {
  /** The server has accounts set up. Then ORION is only for people who are signed in. When false there is no sign-in at all. */
  enabled: boolean;
  ready: boolean;
  /** The server did not answer, so it is not known whether someone is signed in. Nothing is opened on a guess. */
  unreachable: boolean;
  inviteRequired: boolean;
  minPassword: number;
  user: AccountUser | null;
  lastBackupAt: string | null;
  /** In English, as a key: shown through t(). */
  backupError: string | null;
  load: () => Promise<void>;
  signup: (input: { username: string; email: string; password: string; acceptTerms: boolean; inviteCode?: string }) => Promise<Result>;
  login: (input: { email: string; password: string }) => Promise<Result>;
  recover: (input: { email: string; recoveryCode: string; newPassword: string }) => Promise<Result>;
  logout: () => Promise<void>;
  remove: (password: string) => Promise<Result>;
  /** Copies what is on this device to the account. */
  backupNow: () => Promise<boolean>;
  /** The same, shortly after a change, so several quick changes make one upload. */
  backupSoon: () => void;
  sendFeedback: (input: { message: string; kind: "idea" | "problem" | "other"; page?: string }) => Promise<boolean>;
}

const OFFLINE = msg("Could not reach ORION. Check your connection and try again.");
const failure = (status: number, body: Record<string, unknown>): Result => ({
  ok: false,
  error: status === 0 ? t(OFFLINE) : serverMessage(body, t("Something went wrong. Try again.")),
  code: typeof body.code === "string" ? body.code : undefined,
});
let pending: ReturnType<typeof setTimeout> | null = null;

// Whose decisions are on this device. A browser can be shared: one person's history must never be merged into
// the next person's account, so data left by a different account is erased before theirs is brought in.
const OWNER_KEY = "orion.owner.v1";
const owner = {
  get: (): string | null => { try { return typeof localStorage !== "undefined" ? localStorage.getItem(OWNER_KEY) : null; } catch { return null; } },
  set: (id: string | null) => {
    try {
      if (typeof localStorage === "undefined") return;
      if (id) localStorage.setItem(OWNER_KEY, id); else localStorage.removeItem(OWNER_KEY);
    } catch { /* not remembered; signing out still erases */ }
  },
};
/** Takes one account's data off this device. */
const clearDevice = async () => { forgetPlan(); await eraseAllData().catch(() => {}); owner.set(null); };

export const useAccount = create<AccountState>((set, get) => {
  /** After any sign-in: fetch the plan, bring the account's backup onto this device, then save the merged result. */
  const signedIn = async (user: AccountUser) => {
    const previous = owner.get();
    if (previous && previous !== user.id) await clearDevice();
    owner.set(user.id);
    set({ user });
    const me = await request("GET", "/auth/me");
    if (me.status === 200) {
      if (me.body.user) set({ user: me.body.user as AccountUser });
      if (me.body.licence) acceptLicence(me.body.licence);
      acceptPasses(me.body.passes);
    }
    const backup = await request("GET", "/account/backup");
    if (backup.status === 200 && backup.body.data) await importData(backup.body.data).catch(() => 0);
    // The company profile lives in that backup too.
    await useBusiness.getState().load();
    await get().backupNow();
  };
  const enter = async (path: string, input: unknown): Promise<Result> => {
    const { status, body } = await request("POST", path, input);
    if ((status !== 200 && status !== 201) || !body.user) return failure(status, body);
    await signedIn(body.user as AccountUser);
    return { ok: true, recoveryCode: typeof body.recoveryCode === "string" ? body.recoveryCode : undefined };
  };

  return {
    enabled: false,
    ready: false,
    unreachable: false,
    inviteRequired: false,
    minPassword: 10,
    user: null,
    lastBackupAt: null,
    backupError: null,

    load: async () => {
      if (!apiEnabled()) { set({ ready: true }); return; }
      const config = await request("GET", "/auth/config");
      if (config.status !== 200) { set({ unreachable: true, ready: true }); return; }
      if (config.body.enabled !== true) { set({ enabled: false, unreachable: false, ready: true }); return; }
      set({ enabled: true, inviteRequired: config.body.inviteRequired === true, minPassword: Number(config.body.minPassword) || 10 });
      const me = await request("GET", "/auth/me");
      if (me.status !== 200) { set({ unreachable: true, ready: true }); return; }
      set({ unreachable: false });
      if (me.body.user) {
        set({ user: me.body.user as AccountUser });
        if (me.body.licence) acceptLicence(me.body.licence);
        acceptPasses(me.body.passes);
      }
      set({ ready: true });
    },

    signup: (input) => enter("/auth/signup", input),
    login: (input) => enter("/auth/login", input),
    recover: (input) => enter("/auth/recover", input),

    logout: async () => {
      // The account keeps the decisions; this device does not, once they are safely backed up. If the backup did
      // not go through they stay here for the same person to sign back in to (anyone else's sign-in erases them).
      if (pending) { clearTimeout(pending); pending = null; }
      const safe = await get().backupNow();
      await request("POST", "/auth/logout", {});
      if (safe) await clearDevice();
      else forgetPlan();
      set({ user: null, lastBackupAt: null, backupError: null });
    },

    remove: async (password) => {
      const { status, body } = await request("POST", "/auth/delete", { password });
      if (status !== 200) return failure(status, body);
      forgetPlan();
      set({ user: null, lastBackupAt: null, backupError: null });
      return { ok: true };
    },

    backupNow: async () => {
      if (!get().user) return false;
      try {
        const { status, body } = await request("POST", "/account/backup", { data: await exportData() });
        if (status === 200) { set({ lastBackupAt: typeof body.savedAt === "string" ? body.savedAt : new Date().toISOString(), backupError: null }); return true; }
        if (status === 401) set({ user: null });
        set({ backupError: status === 413 ? msg("Your history is too large to back up.") : msg("The last backup did not go through. It will be tried again after your next change.") });
      } catch { set({ backupError: msg("The last backup did not go through.") }); }
      return false;
    },

    backupSoon: () => {
      if (!get().user) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => { pending = null; void get().backupNow(); }, 1500);
    },

    sendFeedback: async (input) => (await request("POST", "/feedback", input)).status === 200,
  };
});

// The session ended on the server (expired, or the password was reset elsewhere): show the sign-in page.
onSignedOut(() => { if (useAccount.getState().user) useAccount.setState({ user: null }); });
