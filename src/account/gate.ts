// The welcome gate: the first time someone opens ORION signed out, they land on the sign-in / sign-up page with
// the demo beside it. Choosing "continue without an account" is remembered on this device, so the gate shows once.
// Some pages never wait behind it: the legal pages and a link a friend was sent.
import { create } from "zustand";

const KEY = "orion.welcome";

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

interface GateState {
  /** The person chose to use ORION without an account on this device. */
  guest: boolean;
  continueAsGuest: () => void;
  /** After signing out: show the welcome page again next time. */
  reset: () => void;
}

export const useGate = create<GateState>((set) => ({
  guest: (() => { try { return storage()?.getItem(KEY) === "guest"; } catch { return false; } })(),
  continueAsGuest: () => { try { storage()?.setItem(KEY, "guest"); } catch { /* remembered for this visit only */ } set({ guest: true }); },
  reset: () => { try { storage()?.removeItem(KEY); } catch { /* nothing stored */ } set({ guest: false }); },
}));

/** Pages that open without the welcome gate. */
export function bypassesGate(pathname: string): boolean {
  return pathname === "/account" || pathname === "/terms" || pathname === "/privacy" || pathname.startsWith("/s/");
}

/** Whether to send this visitor to the welcome page now. */
export function shouldWelcome(input: { pathname: string; ready: boolean; signedIn: boolean; guest: boolean }): boolean {
  return input.ready && !input.signedIn && !input.guest && !bypassesGate(input.pathname);
}
