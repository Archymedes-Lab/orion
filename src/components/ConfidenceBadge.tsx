import { View } from "react-native";
import { msg, t } from "../i18n";
import { Card, SectionTitle, Small, Tag, type Tone } from "./ui";
import { type ConfidenceFactors } from "../decision-engine/confidence";

const TONE: Record<string, Tone> = { high: "success", moderate: "warning", low: "danger" };

const LABEL: Record<string, string> = {
  high: msg("HIGH CONFIDENCE"),
  moderate: msg("MODERATE CONFIDENCE"),
  low: msg("LOW CONFIDENCE"),
};

const REASON_MAP: Record<string, string> = {
  scoreSeparation: msg("Score separation"),
  evidenceQuality: msg("Evidence quality"),
  assumptionCertainty: msg("Assumption certainty"),
  sensitivityStability: msg("Sensitivity stability"),
  unknownResolution: msg("Unknown resolution"),
  constraintCertainty: msg("Constraint certainty"),
  preferenceCertainty: msg("Preference certainty"),
};

export function ConfidenceBadge({ level, score, factors, reasons }: {
  level: "high" | "moderate" | "low";
  score: number;
  factors?: ConfidenceFactors;
  reasons: string[];
}) {
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <SectionTitle>{t("How strong is this recommendation?")}</SectionTitle>
        <Tag label={LABEL[level] ? t(LABEL[level]) : level.toUpperCase()} tone={TONE[level] ?? "neutral"} />
      </View>
      <Small style={{ marginTop: -4 }}>{Math.round(score * 100)}% — {reasons[0] ?? t("Assessed from multiple factors")}</Small>
      {factors && (
        <View style={{ gap: 4, marginTop: 8 }}>
          <Small style={{ color: "#666" }}>{t("Breakdown")}</Small>
          {(Object.entries(factors) as [keyof typeof factors, number][]).map(([key, value]) => (
            <View key={key} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
              <Small>{REASON_MAP[key] ? t(REASON_MAP[key]) : key}</Small>
              <Small style={{ fontWeight: "500", color: value >= 0.7 ? "#10b981" : value >= 0.4 ? "#f59e0b" : "#ef4444" }}>
                {Math.round(value * 100)}%
              </Small>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}