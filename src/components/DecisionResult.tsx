// §11 result screen. Analysis is not the decision; the choice stays the person's.
//
// Three levels, in one card. What is always on screen answers the four questions somebody actually has:
// what does ORION suggest, why does it fit what I said matters, what does it cost me, and what do I do
// next. Everything that explains *how* — the score, the confidence readings, the per-factor arithmetic —
// lives under "See the reasoning", because it is the working, not the answer. What would change the answer
// stays on screen: it is the part of the reasoning a person acts on.
//
// `whyItLeads` is the sensitivity model's attribution: how much each factor favours the leader over the
// runner-up. A positive entry is a reason it leads; a negative one is what you give up by taking it over
// the next-best option. That makes the trade-off a reading, not an invention.
import { View } from "react-native";
import { colors, radius, spacing, type } from "../theme/tokens";
import { ProbabilityBar } from "./ProbabilityBar";
import { confidencePlain, reversibilityPlain, robustnessPlain, ESTIMATE_CAVEAT, SCORE_MEANING } from "../copy/plain";
import { t } from "../i18n";
import { Body, Disclosure, Eyebrow, Reveal, Icon, SectionTitle, Small, Star, Tag, Text, Title, blur, tabular } from "./ui";

export function DecisionResult({
  leaderLabel,
  leaderJev,
  explanation,
  confidence,
  reversibility,
  stability,
  whyItLeads,
  flipNote,
  nextAction,
  signal,
  tied,
  runnerUpLabel,
  compact,
  reasoningOpen,
}: {
  leaderLabel: string;
  leaderJev: number;
  explanation: string;
  confidence: number;
  reversibility: number;
  stability: string;
  /** Per-factor advantage of the leader over the runner-up. Negative means the runner-up does better. */
  whyItLeads: { label: string; impact: number }[];
  flipNote: string;
  nextAction: string;
  signal: boolean;
  tied: boolean;
  /** Named so a trade-off can say who does better, rather than just "this is the weak spot". */
  runnerUpLabel?: string;
  /** The call, its reasons and what would change it are already on screen above this card; do not repeat them. */
  compact?: boolean;
  /** Inside "the full analysis" the working starts open, so everything asked for is one tap away. */
  reasoningOpen?: boolean;
}) {
  const bar = (v: number) => `${Math.round(v * 10)}/10`;
  const largest = Math.max(...whyItLeads.map((w) => Math.abs(w.impact)), 0.01);
  const strengths = whyItLeads.filter((w) => w.impact > 0).slice(0, 3);
  const tradeOffs = whyItLeads.filter((w) => w.impact < 0).slice(0, 2);
  const sure = confidencePlain(confidence);
  const solid = robustnessPlain(stability);
  const undo = reversibilityPlain(reversibility);

  return (
    <Reveal>
    <View style={[{ borderRadius: radius.lg, borderWidth: 1, borderColor: signal ? colors.accentLine : colors.line, backgroundColor: colors.glass, overflow: "hidden" }, blur]}>
      {/* Level 1 — the answer. */}
      <View style={{ padding: spacing.lg, paddingBottom: signal ? spacing.lg : 0, gap: spacing.sm, backgroundColor: signal ? colors.accentSoft : "transparent" }}>
        {signal && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Star size={13} />
            <Eyebrow color={colors.white}>{tied ? t("Too close to call") : t("Your best fit")}</Eyebrow>
          </View>
        )}
        <Title size={signal ? 34 : type.screenTitle}>{!signal ? t("No comparison yet") : tied ? t("The options are tied") : leaderLabel}</Title>
      </View>

      <View style={{ padding: spacing.lg, paddingTop: signal ? spacing.lg : spacing.sm, gap: spacing.lg }}>
        <Body>{explanation}</Body>

        {signal && !compact && strengths.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <SectionTitle>{t("Why it stands out")}</SectionTitle>
            {strengths.map((w) => (
              <View key={w.label} style={{ flexDirection: "row", gap: 10 }}>
                <Icon name="checkmark-circle-outline" size={18} color={colors.success} style={{ marginTop: 2 }} />
                <Body style={{ flex: 1 }}>{runnerUpLabel
                  ? t("It does better on {factor} than {runner}.", { factor: w.label.toLowerCase(), runner: runnerUpLabel.toLowerCase() })
                  : t("It does better on {factor}.", { factor: w.label.toLowerCase() })}</Body>
              </View>
            ))}
          </View>
        )}

        {signal && (
          <View style={{ gap: spacing.sm }}>
            <SectionTitle>{t("What to think about")}</SectionTitle>
            {tradeOffs.length > 0 ? tradeOffs.map((w) => (
              <View key={w.label} style={{ flexDirection: "row", gap: 10 }}>
                <Icon name="alert-circle-outline" size={18} color={colors.warning} style={{ marginTop: 2 }} />
                <Body style={{ flex: 1 }}>
                  {runnerUpLabel
                    ? t("You give up {factor}: {runner} does better there.", { factor: w.label.toLowerCase(), runner: runnerUpLabel })
                    : t("{factor} is where this option is weakest.", { factor: w.label })}
                </Body>
              </View>
            )) : (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Icon name="help-circle-outline" size={18} color={colors.muted} style={{ marginTop: 2 }} />
                <Body style={{ flex: 1 }}>
                  {t("Nothing you listed counts against it. That often means something that matters to you is missing — add it and see if the answer holds.")}
                </Body>
              </View>
            )}
          </View>
        )}

        {/* What would flip it sits with the answer, not behind "See the reasoning": it is what a chat reply does not give. */}
        {signal && !compact && flipNote !== "" && (
          <View style={{ gap: spacing.sm }}>
            <SectionTitle>{t("What would change the answer")}</SectionTitle>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Icon name="swap-horizontal-outline" size={18} color={colors.accentBright} style={{ marginTop: 2 }} />
              <Body style={{ flex: 1 }}>{flipNote}</Body>
            </View>
          </View>
        )}

        <View style={{ flexDirection: "row", gap: 12, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.sunken }}>
          <Icon name="arrow-forward-circle-outline" size={20} color={colors.accentBright} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Eyebrow color={colors.accentBright}>{t("Your next step")}</Eyebrow>
            <Body>{nextAction}</Body>
          </View>
        </View>

        {/* Level 2 — the working, for anyone who wants it. */}
        {signal && (
          <Disclosure summary={t("See the reasoning")} hint={t("The score, how sure ORION is, and what would change the answer.")} tone="accent" defaultOpen={reasoningOpen}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md }}>
              <Small style={{ flex: 1 }}>{t(SCORE_MEANING)}</Small>
              <View accessibilityLabel={t("Score {score}", { score: leaderJev })} style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: type.metadata, fontWeight: "500", letterSpacing: 2.4, color: colors.muted }}>{t("SCORE")}</Text>
                <Text style={[{ fontSize: 32, lineHeight: 38, fontWeight: "200", color: colors.white }, tabular]}>{leaderJev}</Text>
              </View>
            </View>

            <View style={{ gap: spacing.md }}>
              {[sure, solid, undo].map((readout) => (
                <View key={readout.technical} style={{ gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm }}>
                    <Text style={{ fontSize: type.supporting, fontWeight: "400", color: colors.body }}>{readout.question}</Text>
                    <Tag label={readout.answer} tone={readout.tone} />
                  </View>
                  <Small>{readout.detail}</Small>
                </View>
              ))}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.lg }}>
                <View style={{ flexGrow: 1, flexBasis: 160 }}>
                  <ProbabilityBar label={t("Confidence")} value={confidence} display={bar(confidence)} />
                </View>
                <View style={{ flexGrow: 1, flexBasis: 160 }}>
                  <ProbabilityBar label={t("Reversibility")} value={reversibility} display={bar(reversibility)} />
                </View>
              </View>
            </View>

            <View style={{ gap: 12 }}>
              <SectionTitle>{tied ? t("Key trade-offs") : t("What helps or hurts each option")}</SectionTitle>
              <Small>{runnerUpLabel
                ? t("How much each thing you weighed favours {leader} over {runner}.", { leader: leaderLabel, runner: runnerUpLabel })
                : t("How much each thing you weighed favours {leader}.", { leader: leaderLabel })}</Small>
              {whyItLeads.map((w) => (
                <View key={w.label} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <Text style={{ width: 104, fontSize: type.supporting, fontWeight: "300", color: colors.body }}>{w.label}</Text>
                  <View style={{ flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: colors.sunken, overflow: "hidden" }}>
                    <View
                      style={{
                        width: `${Math.round((Math.abs(w.impact) / largest) * 100)}%`, height: 5, borderRadius: radius.pill,
                        backgroundColor: w.impact >= 0 ? colors.success : colors.danger,
                      }}
                    />
                  </View>
                  <Text style={[{ width: 56, textAlign: "right", fontSize: type.supporting, fontWeight: "500", color: w.impact >= 0 ? colors.success : colors.danger }, tabular]}>
                    {w.impact >= 0 ? "+" : "−"} {Math.abs(w.impact).toFixed(1)}
                  </Text>
                </View>
              ))}
            </View>

            <Small>{t(ESTIMATE_CAVEAT)}</Small>
          </Disclosure>
        )}
      </View>
    </View>
    </Reveal>
  );
}
