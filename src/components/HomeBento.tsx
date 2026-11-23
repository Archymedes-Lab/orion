// "Why ORION" on Home: four tiles of different sizes, each showing a real piece of the product (the input, a ranking,
// what would change the call, the two modes) rather than decoration. Copy follows the posters' four promises.
import type { ReactNode } from "react";
import { View } from "react-native";
import { colors, radius, spacing, type } from "../theme/tokens";
import { t } from "../i18n";
import { Card, Eyebrow, Icon, Small, Star, Text, Title, useLayout, type IconName } from "./ui";

function Tile({ icon, eyebrow, title, text, children, grow, aside }: {
  icon: IconName; eyebrow: string; title: string; text: string; children?: ReactNode; grow: number; /** Wide screens: the visual sits beside the words. */ aside?: boolean;
}) {
  const { split } = useLayout();
  const beside = aside && split;
  return (
    <Card style={{ flexGrow: grow, flexBasis: grow > 1 ? 520 : 300, minHeight: beside ? 0 : 280, padding: spacing.xl, gap: spacing.lg, justifyContent: "space-between", overflow: "hidden", ...(beside ? { flexDirection: "row", alignItems: "center" } : {}) }}>
      <View style={{ gap: spacing.sm, ...(beside ? { flex: 1 } : {}) }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine }}>
            <Icon name={icon} size={16} color={colors.white} />
          </View>
          <Eyebrow color={colors.accentBright}>{eyebrow}</Eyebrow>
        </View>
        <Text accessibilityRole="header" style={{ fontSize: 24, lineHeight: 30, fontWeight: "300", letterSpacing: -0.24, color: colors.ink }}>{title}</Text>
        <Small style={{ maxWidth: 440 }}>{text}</Small>
      </View>
      {beside ? <View style={{ flex: 1 }}>{children}</View> : children}
    </Card>
  );
}

const chip = (label: string, on = false) => (
  <View key={label} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: on ? colors.accentSoft : colors.frost, borderWidth: 1, borderColor: on ? colors.accentLine : "transparent" }}>
    <Text style={{ fontSize: 13, fontWeight: "300", color: colors.white }}>{label}</Text>
  </View>
);

function Bar({ label, value, lead }: { label: string; value: number; lead?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 14, fontWeight: lead ? "500" : "300", color: lead ? colors.white : colors.body }}>{label}</Text>
        <Text style={{ fontSize: 14, fontWeight: "300", color: colors.muted, fontVariant: ["tabular-nums"] }}>{value.toFixed(1)}</Text>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.sunken }}>
        <View style={{ width: `${value * 10}%`, height: 4, borderRadius: 2, backgroundColor: lead ? colors.accent : colors.lineStrong }} />
      </View>
    </View>
  );
}

export function HomeBento() {
  const { shell } = useLayout();
  return (
    <View accessibilityLabel={t("Why ORION")} style={{ width: "100%", gap: spacing.xl, marginTop: spacing.xxl }}>
      <View style={{ gap: spacing.md, maxWidth: 760 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Star size={14} /><Eyebrow color={colors.body}>{t("Why ORION")}</Eyebrow></View>
        <Title size={shell ? type.hero : 36} weight="200">{t("Clear questions.")}{"\n"}{t("Deeper insights.")}</Title>
        <Small style={{ fontSize: 16, lineHeight: 25, maxWidth: 560 }}>
          {t("ORION turns a choice you are stuck on into options, what matters, and a clear call, and shows you exactly why.")}
        </Small>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        <Tile grow={2} icon="chatbox-ellipses-outline" eyebrow={t("Natural conversation")} title={t("Describe it the way you'd tell a friend.")}
          text={t("No forms. ORION reads the options and what matters from your own words, and shows what it understood so you can correct it.")}>
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.frost, borderWidth: 1, borderColor: colors.lineStrong }}>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: "300", color: colors.white }}>{t("Take the offer in Lisbon or stay where I am?")}</Text>
              <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent }}><Icon name="arrow-forward" size={15} color={colors.white} /></View>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {chip(t("Take the offer"), true)}{chip(t("Stay"), true)}{chip(t("Pay"))}{chip(t("Growth"))}{chip(t("Friends"))}
            </View>
          </View>
        </Tile>
        <Tile grow={1} icon="stats-chart-outline" eyebrow={t("Clear insights")} title={t("See which way it leans.")}
          text={t("Every option scored on every factor, with the uncertainty shown, not hidden.")}>
          <View style={{ gap: spacing.md }}>
            <Bar label={t("Take the offer")} value={6.8} lead />
            <Bar label={t("Stay")} value={5.1} />
          </View>
        </Tile>
        <Tile grow={1} icon="bulb-outline" eyebrow={t("Actionable guidance")} title={t("Know what would change it.")}
          text={t("ORION names the one thing worth finding out before you commit.")}>
          <View style={{ gap: 10 }}>
            {[t("If pay matters less than friends, it flips."), t("Worth asking: is remote work possible?")].map((line) => (
              <View key={line} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 7, backgroundColor: colors.accentBright }} />
                <Text style={{ flex: 1, fontSize: 14, lineHeight: 21, fontWeight: "300", color: colors.body }}>{line}</Text>
              </View>
            ))}
          </View>
        </Tile>
        <Tile grow={2} aside icon="business-outline" eyebrow={t("For life and business")} title={t("From pizza or tacos to who to hire next.")}
          text={t("Quick calls for small choices, the full comparison for big ones, and a business mode that weighs cash, risk and what can be undone.")}>
          <View style={{ gap: spacing.md }}>
            {([[t("For you"), [t("Pizza or tacos?"), t("Gym now or tonight?"), t("Move city?")], false], [t("For a business"), [t("Raise our prices?"), t("Hire or contract?"), t("Build or buy?")], true]] as const).map(([label, items, on]) => (
              <View key={label} style={{ gap: spacing.sm }}>
                <Eyebrow>{label}</Eyebrow>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{items.map((q) => chip(q, on))}</View>
              </View>
            ))}
          </View>
        </Tile>
      </View>
    </View>
  );
}
