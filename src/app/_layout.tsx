import { Slot, usePathname, useRouter, type ErrorBoundaryProps } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { TopNav } from "../components/TopNav";
import { AppButton, Body, Title, Wordmark, useLayout } from "../components/ui";
import { usePlan } from "../billing/plan";
import { useAccount } from "../account/store";
import { shouldWelcome, useGate } from "../account/gate";
import { apiEnabled, request } from "../ai/http";
import { VERSION } from "../release";
import { colors, layout, spacing } from "../theme/tokens";
import { loadWebFont, loadWebStyles } from "../theme/webFont";
import { useBusiness } from "../business/profile";
import { t } from "../i18n";
import { useLocale } from "../i18n/useLocale";
import { useFonts, Outfit_200ExtraLight, Outfit_300Light, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from "@expo-google-fonts/outfit";

if (Platform.OS === "web") {
  loadWebFont();
  loadWebStyles();
}

export default function RootLayout() {
  const [client] = useState(() => new QueryClient());
  // Web gets Outfit from Google Fonts (theme/webFont); native bundles it. Rendering waits for the native faces.
  const [fontsReady] = useFonts(Platform.OS === "web" ? {} : { Outfit_200ExtraLight, Outfit_300Light, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold });
  const { shell } = useLayout();
  // Switching language remounts the screens, so every string is read again in the new language.
  const locale = useLocale();
  useEffect(() => { if (typeof document !== "undefined") document.documentElement.lang = locale; }, [locale]);
  // Which plan this device is on; also renews a licence that is about to lapse.
  // The account goes second: signing in can bring a subscription with it.
  useEffect(() => { void usePlan.getState().load().then(() => useAccount.getState().load()).then(() => useBusiness.getState().load()); }, []);
  // First visit, signed out: the welcome page (sign in / sign up beside the demo) comes before anything else.
  const pathname = usePathname();
  const router = useRouter();
  const ready = useAccount((a) => a.ready);
  const signedIn = useAccount((a) => a.user !== null);
  const guest = useGate((g) => g.guest);
  const welcome = shouldWelcome({ pathname, ready, signedIn, guest });
  useEffect(() => { if (welcome) router.replace("/account"); }, [welcome, router]);
  if (Platform.OS !== "web" && !fontsReady) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return (
    <QueryClientProvider client={client}>
      <View key={locale} style={{ flex: 1, backgroundColor: colors.bg }}>
        <Slot />
        {/* Floats over the sky; screens leave room for it. Not on the welcome page, which is its own front door. */}
        {shell && pathname !== "/account" && <TopNav />}
      </View>
    </QueryClientProvider>
  );
}

/** Shown instead of a blank page when a screen throws. Saved decisions are untouched. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  if (typeof console !== "undefined") console.error(error);
  // Tell us a page crashed: the error text and the page only, never what the person was deciding.
  useEffect(() => {
    if (!apiEnabled()) return;
    const page = typeof window !== "undefined" ? window.location.pathname : undefined;
    void request("POST", "/client-error", { message: String(error?.message ?? error).slice(0, 500), page, version: VERSION });
  }, [error]);
  return (
    <View accessibilityRole="alert" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: colors.bg }}>
      <View style={{ width: "100%", maxWidth: layout.column, gap: spacing.md, alignItems: "flex-start" }}>
        <Wordmark />
        <Title>{t("Something went wrong on this page.")}</Title>
        <Body>{t("Your saved decisions are safe on this device. Try again; if it keeps happening, reload the page.")}</Body>
        <AppButton title={t("Try again")} icon="refresh" onPress={() => void retry()} />
      </View>
    </View>
  );
}
