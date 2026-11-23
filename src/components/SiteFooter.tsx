// The foot of every page: the brand, where to go next, the legal pages, and what this build is.
// It uses ./brand and plain react-native rather than ./ui, which renders it, so there is no import cycle.
import { Platform, Pressable, Text as RNText, View, type TextProps } from "react-native";
import { useRouter } from "expo-router";
import { STAGE, VERSION } from "../release";
import { colors, spacing, type } from "../theme/tokens";
import { Wordmark } from "./brand";
import { msg, t } from "../i18n";

/** The release stage as shown ("Beta" / "베타"). STAGE itself is an id and stays English. */
const STAGES: Record<string, string> = { Beta: msg("Beta") };
export const stageLabel = () => t(STAGES[STAGE] ?? STAGE);

const sans = Platform.OS === "web" ? 'Outfit, "Noto Sans KR", "Segoe UI", system-ui, -apple-system, sans-serif' : undefined;
const T = ({ style, ...props }: TextProps) => <RNText {...props} style={[{ fontFamily: sans, color: colors.muted, fontWeight: "300" }, style]} />;

const COLUMNS: { title: string; links: [string, string][] }[] = [
  { title: msg("Decide"), links: [[msg("New decision"), "/"], [msg("History"), "/history"], [msg("Insights"), "/insights"]] },
  { title: msg("You"), links: [[msg("Profile"), "/you"], [msg("Your business"), "/you"], [msg("Account"), "/account"]] },
  { title: msg("About"), links: [[msg("Terms"), "/terms"], [msg("Privacy"), "/privacy"], [msg("Design system"), "/design"]] },
];

function FooterLink({ label, href }: { label: string; href: string }) {
  const router = useRouter();
  return (
    <Pressable accessibilityRole="link" onPress={() => router.navigate(href)}>
      {(state) => (
        <T style={{ fontSize: type.supporting, lineHeight: 26, color: (state as { hovered?: boolean }).hovered ? colors.white : colors.muted }}>{t(label)}</T>
      )}
    </Pressable>
  );
}

export function SiteFooter() {
  return (
    <View {...(Platform.OS === "web" ? { role: "contentinfo" } : {}) as object} style={{ marginTop: spacing.xxl * 1.5, paddingTop: spacing.xl, borderTopWidth: 1, borderColor: colors.line, gap: spacing.xl }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.xl }}>
        <View style={{ gap: spacing.md, flexBasis: 280, flexGrow: 1, maxWidth: 380 }}>
          <Wordmark size={30} />
          <T style={{ fontSize: 11, letterSpacing: 3.6, textTransform: "uppercase", color: colors.body, lineHeight: 20 }}>
            {t("Make better decisions.\nLive a better life.")}
          </T>
          <View style={{ width: 32, height: 2, backgroundColor: colors.accent }} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xxl }}>
          {COLUMNS.map((c) => (
            <View key={c.title} style={{ gap: spacing.xs, minWidth: 120 }}>
              <T style={{ fontSize: 11, fontWeight: "500", letterSpacing: 2.4, textTransform: "uppercase", color: colors.faint, marginBottom: spacing.xs }}>{t(c.title)}</T>
              {c.links.map(([label, href]) => <FooterLink key={label} label={label} href={href} />)}
            </View>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingBottom: spacing.sm }}>
        <T style={{ fontSize: 12, color: colors.faint }}>{`© ${new Date().getFullYear()} Archymedes · ORION ${stageLabel()} ${VERSION}`}</T>
        <T style={{ fontSize: 12, color: colors.faint }}>{t("Scores are estimates, not facts. The choice is always yours.")}</T>
      </View>
    </View>
  );
}
