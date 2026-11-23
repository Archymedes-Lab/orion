import { useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import type { DecisionFactor, DecisionOption, ScenarioScore } from "../types";
import type { FactorScore } from "../ai/client";
import { colors, layout, radius, spacing, type } from "../theme/tokens";
import { msg, t } from "../i18n";
import { AppButton, Card, Chip, Divider, Field, Notice, SectionTitle, Small, Text, ease, sink } from "./ui";

// Five taps cover the −10..10 scale; exact numbers remain available for anyone who wants them.
const STEPS = [
  { value: -10, mark: "−−", name: msg("much worse") },
  { value: -5, mark: "−", name: msg("worse") },
  { value: 0, mark: "0", name: msg("no effect") },
  { value: 5, mark: "+", name: msg("better") },
  { value: 10, mark: "++", name: msg("much better") },
];

/**
 * User estimates use the same option × factor model as online scoring.
 *
 * The optional downside column turns a single expected impact into two real
 * outcomes — "usually" and "if it goes badly" — which is what gives scenarios,
 * sensitivity and uncertainty bands something to work with. It is opt-in and
 * per option, because a user who genuinely sees no risk should be able to say
 * so rather than be made to invent a bad case.
 */
export function OfflineForm({ options, factors, onDone }: {
  options: DecisionOption[];
  factors: DecisionFactor[];
  onDone: (scores: FactorScore[], scenarios?: ScenarioScore[]) => boolean;
}) {
  // Untouched cells count as 0 (no effect), so only the differences need a tap.
  const [values, setValues] = useState<Record<string, string>>({});
  const [downside, setDownside] = useState<Record<string, string>>({});
  const [riskOn, setRiskOn] = useState<Record<string, boolean>>({});
  const [likelihood, setLikelihood] = useState<Record<string, number>>({});
  const [exact, setExact] = useState(false);
  const [confidence, setConfidence] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  // Side-by-side columns only when every option fits; otherwise one block per option.
  const grid = useWindowDimensions().width >= layout.tablet && options.length <= 3;
  const key = (o: string, f: string) => JSON.stringify([o, f]);
  const read = (o: string, f: string) => values[key(o, f)] ?? "0";
  const write = (o: string, f: string, value: string) => setValues((old) => ({ ...old, [key(o, f)]: value }));
  const impact = (o: string, f: string) => Number(read(o, f).replace("−", "-"));

  /** Risk cases are only usable when every option has one, or none do. */
  const riskyCount = options.filter((o) => riskOn[o.id]).length;
  const partialRisk = riskyCount > 0 && riskyCount < options.length;
  const downsideValue = (o: string, f: string) => {
    const raw = (downside[key(o, f)] ?? "").trim();
    const n = Number(raw.replace("−", "-"));
    return raw !== "" && Number.isFinite(n) && n >= -10 && n <= 10 ? n : null;
  };

  const apply = () => {
    const scores = options.flatMap((o) => factors.map((f) => ({
      optionId: o.id,
      factorId: f.id,
      value: read(o.id, f.id).trim() ? impact(o.id, f.id) : NaN,
      probabilityConfidence: confidence,
    })));
    if (scores.some((s) => !Number.isFinite(s.value) || s.value < -10 || s.value > 10)) {
      setError(t("Enter an impact from −10 to 10 for every factor. Use 0 for neutral."));
      return;
    }

    const risky = options.filter((o) => riskOn[o.id]);
    if (risky.some((o) => factors.some((f) => downsideValue(o.id, f.id) === null))) {
      setError(t("Fill in the downside impact from −10 to 10 for every factor, or turn the risk off."));
      return;
    }

    const scenarios: ScenarioScore[] = [];
    for (const o of risky) {
      const share = Math.max(0, Math.min(0.95, likelihood[o.id] ?? 0.3));
      scenarios.push({
        optionId: o.id,
        label: t("{option} — if it goes badly", { option: o.label }),
        probability: share,
        probabilityConfidence: confidence,
        values: Object.fromEntries(
          factors.map((f) => [f.id, downsideValue(o.id, f.id) ?? 0])
        ),
      });
      scenarios.push({
        optionId: o.id,
        label: t("{option} — as expected", { option: o.label }),
        probability: 1 - share,
        probabilityConfidence: confidence,
        values: Object.fromEntries(factors.map((f) => [f.id, impact(o.id, f.id)])),
      });
    }

    // Scenarios must cover every option to be comparable, so a partial set is
    // not used. The UI says so rather than silently dropping what was entered.
    const scenariosForAll = partialRisk || scenarios.length === 0 ? null : scenarios;

    setError(onDone(scores, scenariosForAll ?? undefined)
      ? null
      : t("Could not apply these estimates. Try again."));
  };

  const input = (o: DecisionOption, f: DecisionFactor) => exact ? (
    <Field
      accessibilityLabel={t("{option}: {factor} impact from minus 10 to 10", { option: o.label, factor: f.label })}
      keyboardType="numbers-and-punctuation"
      value={read(o.id, f.id)}
      placeholder={t("−10 to 10")}
      onChangeText={(value) => write(o.id, f.id, value)}
      style={{ width: grid ? "100%" : 112, textAlign: "center" }}
    />
  ) : (
    <View accessibilityRole="radiogroup" accessibilityLabel={`${o.label}: ${f.label}`} style={{ flexDirection: "row", gap: 4, justifyContent: grid ? "center" : "flex-end" }}>
      {STEPS.map((step) => {
        const selected = Number(read(o.id, f.id)) === step.value;
        return (
          <Pressable
            key={step.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={t("{option}: {factor} {effect}", { option: o.label, factor: f.label, effect: t(step.name) })}
            onPress={() => write(o.id, f.id, String(step.value))}
            hitSlop={8}
            style={(state) => ({
              width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, alignItems: "center", justifyContent: "center",
              borderColor: selected ? colors.accentLine : "transparent",
              backgroundColor: selected ? colors.accent : (state as { hovered?: boolean }).hovered || state.pressed ? colors.frostHover : colors.sunken,
              ...ease,
              ...sink(state.pressed),
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: selected ? "600" : "400", color: selected ? colors.white : colors.muted }}>{step.mark}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const downsideInput = (o: DecisionOption, f: DecisionFactor) => riskOn[o.id] ? (
    <Field
      accessibilityLabel={t("{option}: {factor} downside impact if it goes badly", { option: o.label, factor: f.label })}
      keyboardType="numbers-and-punctuation"
      value={downside[key(o.id, f.id)] ?? ""}
      placeholder={t("downside")}
      onChangeText={(value) => setDownside((old) => ({ ...old, [key(o.id, f.id)]: value }))}
      style={{ width: grid ? "100%" : 112, textAlign: "center" }}
    />
  ) : null;

  const riskControls = (o: DecisionOption) => (
    <View style={{ gap: spacing.xs }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: !!riskOn[o.id] }}
        onPress={() => setRiskOn((old) => ({ ...old, [o.id]: !old[o.id] }))}
      >
        <Text style={{ color: colors.accentLine }}>
          {riskOn[o.id] ? t("☑ This could go badly — add a downside case") : t("☐ This could go badly — add a downside case")}
        </Text>
      </Pressable>
      {riskOn[o.id] && (
        <View style={{ gap: spacing.xs }}>
          <Small>{t("How likely is the bad case?")}</Small>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {([[msg("Rarely"), 0.1], [msg("Sometimes"), 0.3], [msg("Often"), 0.5]] as const).map(([label, share]) => (
              <Chip
                key={label}
                label={t(label)}
                selected={(likelihood[o.id] ?? 0.3) === share}
                onPress={() => setLikelihood((old) => ({ ...old, [o.id]: share }))}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );

  return (
    <Card>
      <View style={{ gap: spacing.xs }}>
        <SectionTitle>{t("Compare with your own estimates")}</SectionTitle>
        <Small>
          {exact
            ? t("For each option, rate its expected impact on what matters: −10 is very harmful, 0 is neutral, and 10 is very helpful. These are your estimates.")
            : t("For each option, tap how it affects what matters, from much worse (−−) to much better (++). Leave 0 where it makes no difference. These are your estimates.")}
        </Small>
      </View>
      {grid ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.md }}>
            <View style={{ flex: 1 }} />
            {options.map((o) => (
              <Text key={o.id} style={{ flex: 1.4, textAlign: "center", fontSize: type.supporting, fontWeight: "500", color: colors.ink }}>{o.label}</Text>
            ))}
          </View>
          <Divider />
          {factors.map((f) => (
            <View key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Text style={{ flex: 1, fontSize: type.body, fontWeight: "300", color: colors.body }}>{f.label}</Text>
              {options.map((o) => (
                <View key={o.id} style={{ flex: 1.4, gap: spacing.xs }}>
                  {input(o, f)}
                  {downsideInput(o, f)}
                </View>
              ))}
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }} />
            {options.map((o) => (
              <View key={o.id} style={{ flex: 1.4 }}>{riskControls(o)}</View>
            ))}
          </View>
        </View>
      ) : (
        options.map((o) => (
          <View key={o.id} style={{ gap: spacing.sm }}>
            <Divider />
            <Text style={{ fontSize: 17, fontWeight: "500", color: colors.ink, paddingTop: spacing.xs }}>{o.label}</Text>
            {factors.map((f) => (
              <View key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ flex: 1, fontSize: type.body, fontWeight: "300", color: colors.body }}>{f.label}</Text>
                <View style={{ gap: spacing.xs, alignItems: "flex-end" }}>
                  {input(o, f)}
                  {downsideInput(o, f)}
                </View>
              </View>
            ))}
            {riskControls(o)}
          </View>
        ))
      )}
      <Divider />
      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: type.supporting, fontWeight: "500", color: colors.ink }}>{t("How confident are you in these estimates?")}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {([[msg("Low"), 0.25], [msg("Medium"), 0.5], [msg("High"), 0.85]] as const).map(([label, value]) => (
            <Chip key={label} label={t(label)} selected={confidence === value} onPress={() => setConfidence(value)} />
          ))}
        </View>
      </View>
      {partialRisk && (
        <Notice>
          {t("Risk cases are only used when every option has one. Until then ORION compares the expected impacts alone.")}
        </Notice>
      )}
      {error && <Notice tone="danger" alert>{error}</Notice>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
        <AppButton title={t("Apply my estimates")} onPress={apply} />
        <AppButton variant="ghost" title={exact ? t("Use quick scale") : t("Use exact numbers")} onPress={() => setExact(!exact)} />
      </View>
    </Card>
  );
}
