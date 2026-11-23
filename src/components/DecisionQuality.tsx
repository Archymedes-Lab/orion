import { View, Text } from "react-native";
import { msg, t } from "../i18n";
import { Card, SectionTitle, Small, Tag, type Tone, Body } from "./ui";
import { type DecisionRecord } from "../decision-engine/checkIns";

const LEVEL: Record<string, { label: string; tone: Tone }> = {
  strong: { label: msg("STRONG"), tone: "success" },
  moderate: { label: msg("MODERATE"), tone: "warning" },
  weak: { label: msg("WEAK"), tone: "danger" },
};

const LEVEL_NAME: Record<string, string> = { strong: msg("Strong"), moderate: msg("Moderate"), weak: msg("Weak") };
const OUTCOME: Record<string, string> = { better: msg("better"), expected: msg("expected"), worse: msg("worse") };

const ICONS = {
  met: "✅",
  unmet: "⚠️",
};

export function DecisionQuality({ record, scores }: { record: DecisionRecord; scores: { level: "strong" | "moderate" | "weak"; score: number; criteria: { name: string; met: boolean; detail: string }[] } }) {
  const level = LEVEL[scores.level];
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <SectionTitle>{t("How well was this decided?")}</SectionTitle>
        <Tag label={t(level.label)} tone={level.tone} />
      </View>
      <Small style={{ marginTop: -4, marginBottom: 8 }}>
        {t("Score: {pct}% — {level}", { pct: Math.round(scores.score * 100), level: LEVEL_NAME[scores.level] ? t(LEVEL_NAME[scores.level]) : scores.level })}
      </Small>
      <View style={{ gap: 6 }}>
        {scores.criteria.map((c, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 4 }}>
            <Text style={{ fontSize: 16 }}>{c.met ? ICONS.met : ICONS.unmet}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={{ fontWeight: c.met ? "500" : "400" }}>{c.name}</Body>
              <Small style={{ color: c.met ? "#10b981" : "#ef4444" }}>{c.detail}</Small>
            </View>
          </View>
        ))}
      </View>
      {record.outcomeRating && (
        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: "#e5e7eb", gap: 4 }}>
          <SectionTitle>{t("How did it turn out?")}</SectionTitle>
          <Small><Body style={{ fontWeight: "500" }}>{t("Result: ")}</Body>{OUTCOME[record.outcomeRating.overall] ? t(OUTCOME[record.outcomeRating.overall]) : record.outcomeRating.overall}</Small>
          {record.outcomeRating.surprises.length > 0 && (
            <Small><Body style={{ fontWeight: "500" }}>{t("Surprises: ")}</Body>{record.outcomeRating.surprises.join("; ")}</Small>
          )}
          {record.lesson && (
            <Small><Body style={{ fontWeight: "500" }}>{t("Lesson: ")}</Body>{record.lesson}</Small>
          )}
        </View>
      )}
    </Card>
  );
}