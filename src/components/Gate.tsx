// ORION is for people who are signed in. Everything except the sign-in page, the terms and the privacy notice
// renders inside a Gate. This keeps the screens out of the way; the server refuses the same people on its own.
import { useEffect, useMemo, type ReactNode } from "react";
import { Platform } from "react-native";
import { Redirect, usePathname } from "expo-router";
import { useAccount } from "../account/store";
import { useSession } from "../store/session";
import { AppButton, Body, PageHeader, Screen, Skeleton } from "./ui";
import { t } from "../i18n";

/** Where to come back to after signing in: only ever a path inside the app. */
export const safeNext = (next: unknown): string =>
  typeof next === "string" && /^\/(?![/\\])/.test(next) && !next.startsWith("/account") ? next : "/";

/**
 * The address the page was opened on. While the Gate shows "Loading…" no navigator is mounted and the router
 * rewrites the address to "/", so the way in has to be read before that. It is used once, for the first lock.
 */
let entry: string | null = Platform.OS === "web" && typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : null;

/** Shown when the server did not say whether anyone is signed in. */
export function Unreachable() {
  const load = useAccount((a) => a.load);
  return (
    <Screen title={t("Offline")}>
      <PageHeader title={t("ORION could not be reached")} />
      <Body>{t("Signing in needs a connection. Check yours and try again; nothing saved on this device has been touched.")}</Body>
      <AppButton title={t("Try again")} icon="refresh" onPress={() => void load()} style={{ alignSelf: "flex-start" }} />
    </Screen>
  );
}

export function Gate({ children }: { children: ReactNode }) {
  const account = useAccount();
  const pathname = usePathname();
  const locked = account.ready && !account.unreachable && account.enabled && !account.user;
  // A decision in progress belongs to whoever was signed in; it does not wait for the next person.
  useEffect(() => { if (locked) useSession.getState().reset(); }, [locked]);
  // Where to come back to: the address the page was opened on the first time, the current screen after that.
  // The query is kept too (Stripe returns to /you?checkout=…), where the platform has one to read.
  const next = useMemo(
    () => safeNext(entry ?? (Platform.OS === "web" && typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : pathname)),
    [locked]
  );
  useEffect(() => { if (account.ready) entry = null; }, [account.ready]);
  if (!account.ready) return <Screen title={t("Loading")}><Skeleton height={30} width="60%" /><Skeleton height={16} /><Skeleton height={16} width="80%" /></Screen>;
  if (account.unreachable) return <Unreachable />;
  if (locked) return <Redirect href={next === "/" ? "/account" : `/account?next=${encodeURIComponent(next)}`} />;
  return <>{children}</>;
}
