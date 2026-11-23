// Desktop top bar: wordmark, sections in tracked capitals, and the blue "new decision" pill.
import { Pressable, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../store/session";
import { useAccount } from "../account/store";
import { colors, layout } from "../theme/tokens";
import { AppButton, Text, Wordmark, blur, css, ease, useLayout } from "./ui";
import { AccountMenu } from "./AccountMenu";
import { useScrolled } from "./scroll";
import { LanguageSwitch } from "./LanguageSwitch";
import { stageLabel } from "./SiteFooter";
import { getLocale, msg, t } from "../i18n";

export const SECTIONS = [
  { href: "/", label: msg("Home") },
  { href: "/history", label: msg("My decisions") },
  { href: "/insights", label: msg("Insights") },
  { href: "/you", label: msg("Profile") },
] as const;

export function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  // An analysis page belongs to no section, so nothing is marked there.
  const current = ["/decision", "/design", "/account", "/terms", "/privacy"].some((p) => pathname.startsWith(p)) ? null : SECTIONS.find((n) => n.href !== "/" && pathname.startsWith(n.href))?.href ?? "/";
  const home = () => { useSession.getState().reset(); router.navigate("/"); };
  const account = useAccount();
  const { split } = useLayout();
  // Clear over the sky at the top of a page; frosted and solid once content passes underneath.
  const scrolled = useScrolled((s) => s.scrolled);

  return (
    <View
      style={[
        {
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, height: layout.nav + insets.top, paddingTop: insets.top,
          alignItems: "center", borderBottomWidth: 1,
          backgroundColor: scrolled ? "rgba(8,12,19,0.72)" : "rgba(11,16,21,0.0)",
          borderColor: scrolled ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0)",
        },
        scrolled && blur,
        css({ boxShadow: scrolled ? "0 12px 40px rgba(3,6,12,0.35)" : "none", transitionProperty: "background-color, border-color, box-shadow", transitionDuration: "320ms" }),
      ]}
    >
      <View style={{ flex: 1, width: "100%", maxWidth: layout.page + 80, paddingHorizontal: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Pressable onPress={() => router.navigate("/")} accessibilityRole="link" accessibilityLabel={t("ORION home")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Wordmark size={24} />
            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: colors.lineStrong }}>
              <Text style={{ fontSize: 10, fontWeight: "500", letterSpacing: 1.8, textTransform: "uppercase", color: colors.body }}>{stageLabel()}</Text>
            </View>
          </View>
        </Pressable>
        <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 16 }}>
          {SECTIONS.map((n) => {
            const active = current === n.href;
            return (
              <Pressable
                key={n.href}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => router.navigate(n.href)}
                style={(state) => [{ alignItems: "center", gap: 6, paddingTop: 12, paddingBottom: 6, paddingHorizontal: 12, borderRadius: 10 },
                  (state as { hovered?: boolean }).hovered && !active && { backgroundColor: "rgba(255,255,255,0.05)" }, ease]}
              >
                {(state) => (
                  <>
                    <Text style={[{ fontSize: getLocale() === "ko" ? 14 : 12, fontWeight: active ? "500" : "400", letterSpacing: getLocale() === "ko" ? 0.4 : 2.6, textTransform: "uppercase", color: active || (state as { hovered?: boolean }).hovered ? colors.white : colors.muted }, css({ transitionProperty: "color", transitionDuration: "140ms" }) as object]}>
                      {t(n.label)}
                    </Text>
                    <View style={[{ width: 5, height: 5, borderRadius: 3, backgroundColor: active ? colors.accent : "transparent" }, ease]} />
                  </>
                )}
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {account.enabled && account.ready && !account.user && pathname !== "/account" && (
            <AppButton variant="ghost" title={t("Sign in")} onPress={() => router.navigate("/account")} />
          )}
          <LanguageSwitch compact />
          {account.user && <AccountMenu compact={!split} />}
          <AppButton title={t("New decision")} iconRight="arrow-forward" onPress={home} />
        </View>
      </View>
    </View>
  );
}
