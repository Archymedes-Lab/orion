import { View, Text } from "react-native";
import { msg, t } from "../i18n";
import { Card, SectionTitle, Small, Tag } from "./ui";
import { getModeProfile, type DecisionModeType } from "../decision-engine/decisionModes";

const MODE_ICONS: Record<string, string> = {
  BINARY: "⚖️",
  MULTI_OPTION: "🔘",
  TRADEOFF: "⚖️",
  RESOURCE_ALLOCATION: "📊",
  PRIORITIZATION: "📋",
  TIMING: "⏰",
  GO_NO_GO: "✅",
  SEQUENCE: "🔗",
  REVERSIBLE_EXPERIMENT: "🧪",
  UNCERTAINTY: "❓",
  VALUE_CONFLICT: "⚔️",
};

// The profile's strategy and emphasis are ids; these are their shown names.
const STRATEGY: Record<string, string> = {
  explicit: msg("EXPLICIT"), binary: msg("BINARY"), resource_allocation: msg("RESOURCE ALLOCATION"), prioritization: msg("PRIORITIZATION"),
  sequence: msg("SEQUENCE"), go_no_go: msg("GO NO_GO"), tradeoff: msg("TRADEOFF"), experiment: msg("EXPERIMENT"),
};
const EMPHASIS: Record<string, string> = {
  expected_value: msg("expected value"), downside: msg("downside"), constraint_satisfaction: msg("constraint satisfaction"), tradeoff: msg("tradeoff"),
};

export function DecisionModeBadge({ mode, obligationsCount, optionsCount }: {
  mode: DecisionModeType;
  obligationsCount: number;
  optionsCount: number;
}) {
  const profile = getModeProfile(mode);
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 24 }}>{MODE_ICONS[mode] ?? "📋"}</Text>
          <View>
            <SectionTitle>{profile.name}</SectionTitle>
            <Small>{profile.description}</Small>
          </View>
        </View>
        <Tag label={STRATEGY[profile.optionStrategy] ? t(STRATEGY[profile.optionStrategy]) : profile.optionStrategy.replace("_", " ").toUpperCase()} tone="neutral" />
      </View>
      <View style={{ marginTop: 8, gap: 4 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Small>{t("Options")}</Small>
          <Small style={{ fontWeight: "500" }}>{optionsCount}</Small>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Small>{t("Obligations/Needs")}</Small>
          <Small style={{ fontWeight: "500" }}>{obligationsCount}</Small>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Small>{t("Question budget")}</Small>
          <Small style={{ fontWeight: "500" }}>{t("{n}x base", { n: profile.questionBudgetMultiplier })}</Small>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Small>{t("Scoring emphasis")}</Small>
          <Small style={{ fontWeight: "500" }}>{EMPHASIS[profile.scoringEmphasis] ? t(EMPHASIS[profile.scoringEmphasis]) : profile.scoringEmphasis.replace("_", " ")}</Small>
        </View>
        {profile.includeWaitOption && (
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Small>{t("Includes wait/gather info")}</Small>
            <Small style={{ fontWeight: "500", color: "#10b981" }}>{t("Yes")}</Small>
          </View>
        )}
        {profile.includeCompromise && (
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Small>{t("Includes compromise")}</Small>
            <Small style={{ fontWeight: "500", color: "#10b981" }}>{t("Yes")}</Small>
          </View>
        )}
        {profile.includeExperiment && (
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Small>{t("Includes experiment")}</Small>
            <Small style={{ fontWeight: "500", color: "#10b981" }}>{t("Yes")}</Small>
          </View>
        )}
      </View>
    </Card>
  );
}