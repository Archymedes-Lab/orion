// What follows from a choice, as a short story first and a model second.
//
// The engine already writes plain sentences for each step — `likely`, `goodTurn`, `hardTurn`, `sign` — so
// the default view is those, one line per moment in time, and nothing else. The net values, the ranges and
// the odds are real output and worth keeping, but they are the working: they live under "See the numbers",
// and they are labelled as ORION's estimates rather than printed as if they were measurements.
import { View } from "react-native";
import { colors, radius, spacing, type } from "../theme/tokens";
import { type Aftermath } from "../decision-engine/aftermath";
import { ESTIMATE_CAVEAT } from "../copy/plain";
import { Body, Card, Disclosure, Divider, Eyebrow, Icon, SectionTitle, Small, Text, tabular } from "./ui";
import { getLocale, listPhrase, t } from "../i18n";

export function AftermathTimeline({ aftermath, label, detailed = false }: {
  aftermath: Aftermath;
  label: string;
  /** Pro: also offer the per-step numbers. Without it the plain story is the whole view. */
  detailed?: boolean;
}) {
  const steps = aftermath.steps;
  // The sign worth watching first is the one attached to the earliest step that has one.
  const watch = steps.find((s) => s.sign)?.sign ?? "";
  // Option and factor names sit mid-sentence: lower case in English, as written in Korean.
  const inline = (text: string) => (getLocale() === "en" ? text.toLowerCase() : text);
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;

  return (
    <Card>
      <SectionTitle>{t("What could happen if you {option}?", { option: inline(label) })}</SectionTitle>
      {aftermath.caution && (
        <View style={{ flexDirection: "row", gap: 10, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft }}>
          <Icon name="warning-outline" size={18} color={colors.warning} style={{ marginTop: 2 }} />
          <Body style={{ flex: 1 }}>{aftermath.caution}</Body>
        </View>
      )}

      {/* Level 1 — the story, in the order it would happen. */}
      <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
        {steps.map((step) => (
          <View key={step.days} style={{ flexDirection: "row", gap: spacing.md }}>
            <Text style={{ width: 104, fontSize: type.supporting, fontWeight: "500", color: colors.white }}>{step.when}</Text>
            <Body style={{ flex: 1 }}>{step.likely}</Body>
          </View>
        ))}
      </View>

      {watch !== "" && (
        <View style={{ flexDirection: "row", gap: 12, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.sunken }}>
          <Icon name="eye-outline" size={20} color={colors.accentBright} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Eyebrow color={colors.accentBright}>{t("Watch for")}</Eyebrow>
            <Body>{watch}</Body>
          </View>
        </View>
      )}

      {/* Level 2 — still plain, for anyone who wants more of the picture. */}
      <View style={{ marginTop: spacing.md }}>
        <Disclosure summary={t("If it goes well, or badly")} hint={t("The better and worse version of each stage.")}>
          {steps.map((step) => (
            <View key={step.days} style={{ gap: spacing.xs }}>
              <Text style={{ fontSize: type.supporting, fontWeight: "500", color: colors.white }}>{step.when}</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Icon name="trending-up-outline" size={16} color={colors.success} style={{ marginTop: 3 }} />
                <Small style={{ flex: 1 }}>{step.goodTurn}</Small>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Icon name="trending-down-outline" size={16} color={colors.danger} style={{ marginTop: 3 }} />
                <Small style={{ flex: 1 }}>{step.hardTurn}</Small>
              </View>
            </View>
          ))}
        </Disclosure>

        {aftermath.earlyWarningSignals.length > 0 && (
          <Disclosure summary={t("What would tell you it is going wrong")} hint={t("Signs worth checking before they become expensive.")}>
            {aftermath.earlyWarningSignals.map((signal) => (
              <View key={signal} style={{ flexDirection: "row", gap: 10 }}>
                <Icon name="alert-circle-outline" size={16} color={colors.warning} style={{ marginTop: 3 }} />
                <Small style={{ flex: 1 }}>{signal}</Small>
              </View>
            ))}
          </Disclosure>
        )}

        {/* Level 3 — the model's own numbers. */}
        {detailed && (
          <Disclosure summary={t("See the numbers")} hint={t("Net effect, likely range and how each stage could land.")}>
            <Small>
              {t("{caveat} The net effect is on ORION's −10 to +10 scale, not a sum of money or a probability of success.", { caveat: t(ESTIMATE_CAVEAT) })}
            </Small>
            {steps.map((step, i) => (
              <View key={step.days} style={{ gap: spacing.xs }}>
                {i > 0 && <Divider />}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                  <Text style={{ fontSize: type.supporting, fontWeight: "500", color: colors.white }}>{step.when}</Text>
                  <Text style={[{ fontSize: type.supporting, fontWeight: "500", color: step.value >= 0 ? colors.success : colors.danger }, tabular]}>
                    {t("Net {value}", { value: signed(step.value) })}
                  </Text>
                </View>
                <Small>{t("Likely between {low} and {high}.", { low: step.range[0].toFixed(1), high: step.range[1].toFixed(1) })}</Small>
                <Small>
                  {t("ORION's estimate of how this stage lands: {well}% well, {mixed}% mixed, {hard}% hard.", { well: Math.round(step.odds.well * 100), mixed: Math.round(step.odds.mixed * 100), hard: Math.round(step.odds.hard * 100) })}
                </Small>
                {step.featured.length > 0 && (
                  <Small>
                    {t("Driven by {factors}.", { factors: listPhrase(step.featured.map((f) => `${inline(f.label)} (${signed(f.value)})`)) })}
                  </Small>
                )}
              </View>
            ))}
          </Disclosure>
        )}
      </View>
    </Card>
  );
}
