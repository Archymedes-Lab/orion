// Home's Aftermath demo: one scripted decision, pictured live by the real engine. Switching the option or what
// matters most recomputes every diagram, and they re-animate (anime.js). It plays itself until someone touches it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { DecisionFactor, DecisionOption } from "../types";
import { aftermath, takeaways } from "../decision-engine/aftermath";
import { chart, colors, radius, spacing, type } from "../theme/tokens";
import { animate, stagger } from "animejs";
import { FanChart, FeltGrid, FuturesRiver } from "./FuturesChart";
import { mark, useAnime } from "./motion";
import { Card, Chip, Eyebrow, Icon, Small, Star, Text, Title, tabular, useLayout } from "./ui";
import { Illustration } from "./illustrations";
import { msg, t } from "../i18n";

const FACTORS: DecisionFactor[] = [
  { id: "inc", label: msg("Income"), weight: 0.3 },
  { id: "fr", label: msg("Friends"), weight: 0.3 },
  { id: "cost", label: msg("Moving cost"), weight: 0.15 },
  { id: "gr", label: msg("Career growth"), weight: 0.25 },
];
const option = (id: string, label: string, values: Record<string, number>, reversibility: number, confidence: number): DecisionOption => ({
  id, label, reversibility,
  outcomes: [{ id: `${id}-o`, label: "Expected", probability: 1, probabilityConfidence: confidence, factors: Object.entries(values).map(([factorId, value]) => ({ factorId, value })) }],
});
const OPTIONS: DecisionOption[] = [
  option("berlin", msg("Take the Berlin job"), { inc: 6, fr: -5, cost: -6, gr: 7 }, 0.3, 0.65),
  option("stay", msg("Stay where I am"), { inc: 0, fr: 4, cost: 0, gr: -2 }, 0.9, 0.75),
];
/** The scripted decision's labels are ORION's own words, so they are shown in the current language. */
const shown = <T extends { label: string }>(items: T[]): T[] => items.map((item) => ({ ...item, label: t(item.label) }));
/** The scripted decision pictured as-is, for other demos (the welcome page's "Aftermath" scene). */
export function demoPicture() {
  const base = { options: shown(OPTIONS), factors: shown(FACTORS), mode: "serious" as const, stakes: "major" as const, safety: "normal" as const, signal: true };
  const picture = aftermath({ ...base, optionId: "berlin" })!;
  return { picture, said: takeaways(picture, aftermath({ ...base, optionId: "stay" })) };
}

const PRIORITIES = [null, "inc", "fr", "gr"] as const;
// The tour it plays on its own: each option, then what changes when a different thing matters most.
const TOUR: { optionId: string; priority: (typeof PRIORITIES)[number] }[] = [
  { optionId: "berlin", priority: null },
  { optionId: "stay", priority: null },
  { optionId: "berlin", priority: "fr" },
  { optionId: "berlin", priority: "gr" },
];

export function AftermathDemo() {
  const { split } = useLayout();
  const [stop, setStop] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [choice, setChoice] = useState(TOUR[0]);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      const next = (stop + 1) % TOUR.length;
      setStop(next);
      setChoice(TOUR[next]);
    }, 9000);
    return () => clearTimeout(timer);
  }, [playing, stop]);
  const take = (c: typeof choice) => { setPlaying(false); setChoice(c); };

  // What matters most counts two and a half times as much.
  const factors = useMemo(() => shown(FACTORS).map((f) => ({ ...f, weight: f.id === choice.priority ? f.weight * 2.5 : f.weight })), [choice.priority]);
  const [picture, other] = useMemo(() => {
    const base = { options: shown(OPTIONS), factors, mode: "serious" as const, stakes: "major" as const, safety: "normal" as const, signal: true };
    return [aftermath({ ...base, optionId: choice.optionId })!, aftermath({ ...base, optionId: OPTIONS.find((o) => o.id !== choice.optionId)!.id })];
  }, [factors, choice.optionId]);
  const said = takeaways(picture, other);

  const root = useRef<View>(null);
  useAnime(root, () => {
    animate('[data-am="moment"]', { opacity: [0, 1], translateY: [14, 0], duration: 700, delay: stagger(140, { start: 200 }), ease: "outExpo" });
  }, [choice.optionId, choice.priority]);

  return (
    <Card style={{ width: "100%", gap: spacing.lg, padding: split ? 28 : spacing.lg }}>
      <View style={{ flexDirection: split ? "row" : "column", gap: spacing.lg, alignItems: split ? "center" : "flex-start" }}>
        <View style={{ flex: 1, gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Star size={13} />
            <Eyebrow color={colors.accentBright}>{t("New · Aftermath")}</Eyebrow>
          </View>
          <Title size={split ? 32 : 26}>{t("See where a choice leads, before you make it.")}</Title>
          <Small>
            {t("After ORION compares your options, it pictures what plausibly follows each one: the odds at each moment, how you could feel over the weeks, and the early signs that tell you which path you are on. Then it checks in on exactly those signs.")}
          </Small>
        </View>
        {split && <Illustration name="decide" width={260} />}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md }}>
        <View style={{ gap: 6, flexShrink: 1, maxWidth: "100%" }}>
          <Text style={{ fontSize: type.metadata, letterSpacing: 2, color: colors.muted }}>{t("PICTURE")}</Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {OPTIONS.map((o) => <Chip key={o.id} label={t(o.label)} selected={choice.optionId === o.id} onPress={() => take({ ...choice, optionId: o.id })} />)}
          </View>
        </View>
        <View style={{ gap: 6, flexShrink: 1, maxWidth: "100%" }}>
          <Text style={{ fontSize: type.metadata, letterSpacing: 2, color: colors.muted }}>{t("WHAT MATTERS MOST")}</Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {PRIORITIES.map((p) => (
              <Chip key={p ?? "even"} label={p ? t(FACTORS.find((f) => f.id === p)!.label) : t("All equal")} selected={choice.priority === p} onPress={() => take({ ...choice, priority: p })} />
            ))}
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? t("Pause the tour") : t("Play the tour")} onPress={() => setPlaying(!playing)}
          style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line }}>
          <Icon name={playing ? "pause" : "play"} size={14} color={colors.white} />
          <Text style={{ fontSize: type.metadata, color: colors.white }}>{playing ? t("Touring") : t("Play tour")}</Text>
        </Pressable>
      </View>

      <View ref={root} style={{ flexDirection: split ? "row" : "column", gap: split ? 32 : spacing.xl }}>
        <View style={{ flex: split ? 1.25 : undefined, gap: spacing.xl, minWidth: 0 }}>
          <FuturesRiver steps={picture.steps} headline={said.odds} />
          <FanChart
            headline={said.path}
            crossing={said.crossing}
            series={[
              { id: picture.optionId, label: picture.optionLabel, color: chart.pictured, steps: picture.steps, band: true },
              ...(other ? [{ id: other.optionId, label: other.optionLabel, color: chart.alternative, steps: other.steps }] : []),
            ]}
          />
        </View>
        <View style={{ flex: split ? 1 : undefined, gap: spacing.lg, minWidth: 0 }}>
          <View style={{ gap: spacing.sm }}>
            {picture.steps.map((s) => (
              <View key={`${choice.optionId}${choice.priority}${s.days}`} {...mark("moment")} style={{ padding: 14, gap: 6, borderRadius: radius.md, backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.line }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                  <Text style={{ fontSize: type.metadata, letterSpacing: 2, color: colors.white }}>{s.when.toUpperCase()}</Text>
                  <Text style={[{ fontSize: type.metadata, color: colors.muted }, tabular]}>{t("{well}% goes well · {hard}% hard", { well: Math.round(s.odds.well * 100), hard: Math.round(s.odds.hard * 100) })}</Text>
                </View>
                <Text style={{ fontSize: 14, lineHeight: 21, fontWeight: "300", color: colors.body }}>{s.likely}</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Icon name="eye-outline" size={14} color={colors.accentBright} style={{ marginTop: 3 }} />
                  <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color: colors.white }}>{t("Watch for: {sign}", { sign: s.sign })}</Text>
                </View>
              </View>
            ))}
          </View>
          <FeltGrid steps={picture.steps} headline={said.timing} />
        </View>
      </View>
      <Small style={{ color: colors.faint }}>{t("A scripted example run by the real engine. Your own decisions get their own picture after the comparison.")}</Small>
    </Card>
  );
}
