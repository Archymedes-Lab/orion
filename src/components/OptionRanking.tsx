// Every option on one scale: where its JEV sits and how wide the likely range is.
import { View } from "react-native";
import type { ScoredOption } from "../types";
import { colors, radius, spacing, type } from "../theme/tokens";
import { t } from "../i18n";
import { Card, SectionTitle, Small, Star, Text, tabular } from "./ui";

const signed = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${Math.abs(n).toFixed(1)}`;

export function OptionRanking({ scored, labels, chosenId }: {
  /** Sorted, strongest first. */
  scored: ScoredOption[];
  labels: Record<string, string>;
  /** The option the person committed to, if any. */
  chosenId?: string | null;
}) {
  // One shared axis that always includes 0, so "better than doing nothing" is visible.
  const min = Math.min(0, ...scored.map((s) => s.low));
  const max = Math.max(0, ...scored.map((s) => s.high));
  const span = max - min || 1;
  const at = (value: number) => `${Math.max(0, Math.min(100, ((value - min) / span) * 100))}%` as const;
  const tied = scored.length > 1 && scored[0].jev === scored[1].jev;

  return (
    <Card>
      <View style={{ gap: spacing.xs }}>
        <SectionTitle>{t("How the options compare")}</SectionTitle>
        <Small>{t("The score is each option’s expected effect on what matters to you, from −10 to +10. The band is the likely range; a wide band means low confidence.")}</Small>
      </View>
      {scored.map((s, i) => {
        const lead = i === 0 && !tied;
        const label = labels[s.optionId] ?? s.optionId;
        return (
          <View key={s.optionId} accessibilityLabel={t("{option}: score {score}, likely between {low} and {high}", { option: label, score: signed(s.jev), low: signed(s.low), high: signed(s.high) })} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Text style={[{ width: 18, fontSize: type.supporting, color: colors.muted }, tabular]}>{i + 1}</Text>
              <Text numberOfLines={2} style={{ flex: 1, fontSize: type.body, fontWeight: lead ? "500" : "300", color: lead ? colors.white : colors.body }}>{label}</Text>
              {lead && <Star size={11} />}
              {chosenId === s.optionId && <Text style={{ fontSize: type.metadata, fontWeight: "500", color: colors.success }}>{t("Your choice")}</Text>}
              <Text style={[{ minWidth: 48, textAlign: "right", fontSize: type.body, fontWeight: "500", color: colors.white }, tabular]}>{signed(s.jev)}</Text>
            </View>
            <View style={{ marginLeft: 26, height: 14, justifyContent: "center" }}>
              <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: colors.sunken }} />
              <View style={{ position: "absolute", left: at(0), top: 0, bottom: 0, width: 1, backgroundColor: colors.lineStrong }} />
              <View
                style={{
                  position: "absolute", left: at(s.low), width: `${Math.max(1, ((s.high - s.low) / span) * 100)}%`, height: 8, borderRadius: radius.pill,
                  backgroundColor: lead ? colors.accentSoft : colors.frost, borderWidth: 1, borderColor: lead ? colors.accentLine : colors.line,
                }}
              />
              <View style={{ position: "absolute", left: at(s.jev), marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: lead ? colors.accentBright : colors.white, borderWidth: 2, borderColor: colors.bg }} />
            </View>
          </View>
        );
      })}
      <View style={{ marginLeft: 26, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={[{ fontSize: type.metadata, color: colors.muted }, tabular]}>{signed(min)}</Text>
        <Text style={[{ fontSize: type.metadata, color: colors.muted }, tabular]}>{signed(max)}</Text>
      </View>
    </Card>
  );
}
