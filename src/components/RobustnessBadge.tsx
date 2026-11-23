import { View } from "react-native";
import { msg, t } from "../i18n";
import { Card, SectionTitle, Small, Tag, type Tone, Body } from "./ui";
import { type RobustnessResult } from "../decision-engine/robustness";

const TONE: Record<string, Tone> = { robust: "success", tossup: "warning", fragile: "danger" };

const LABEL: Record<string, string> = {
  robust: msg("ROBUST"),
  tossup: msg("TOSS-UP"),
  fragile: msg("FRAGILE"),
};

export function RobustnessBadge({ result }: {
  result: RobustnessResult;
}) {
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <SectionTitle>{t("Would the answer change?")}</SectionTitle>
        <Tag label={LABEL[result.level] ? t(LABEL[result.level]) : result.level.toUpperCase()} tone={TONE[result.level] ?? "neutral"} />
      </View>
      <Body style={{ marginTop: 4 }}>{result.summary}</Body>
      {result.whatWouldChange.length > 0 && (
        <View style={{ marginTop: 8, gap: 4 }}>
          <Small style={{ color: "#666", fontWeight: "500" }}>{t("What would change the result:")}</Small>
          {result.whatWouldChange.map((item, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
              <Small style={{ color: "#666" }}>{String.fromCharCode(9679)}</Small>
              <Small style={{ flex: 1 }}>{item}</Small>
            </View>
          ))}
        </View>
      )}
      {result.flipConditions.length > 0 && (
        <View style={{ marginTop: 8, gap: 4 }}>
          <Small style={{ color: "#666", fontWeight: "500" }}>{t("Factor flip conditions:")}</Small>
          {result.flipConditions.filter(f => f.reachable).slice(0, 3).map((f, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
              <Small style={{ color: "#666" }}>{String.fromCharCode(9679)}</Small>
              <Small style={{ flex: 1 }}>{f.description}</Small>
            </View>
          ))}
        </View>
      )}
      {result.assumptionSensitivity.length > 0 && (
        <View style={{ marginTop: 8, gap: 4 }}>
          <Small style={{ color: "#666", fontWeight: "500" }}>{t("Assumption sensitivity:")}</Small>
          {result.assumptionSensitivity.filter(a => a.reachable).slice(0, 2).map((a, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
              <Small style={{ color: "#666" }}>{String.fromCharCode(9679)}</Small>
              <Small style={{ flex: 1 }}>{a.description}</Small>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}