// Aftermath: "if you choose this, here is roughly what follows". A timeline from the first days to years out: the
// moments ORION will check in (up to a year), then projections, each with the most likely picture, a good and a hard
// turn with rough odds, and the early sign to watch for.
// The numbers are ORION's (decision-engine/aftermath.ts); an AI only rewords the text when it is online.
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import type { DecisionFactor, DecisionOption, SafetyClass, Stakes } from "../types";
import type { DecisionMode } from "../decision-engine/mode";
import { aftermath, takeaways, type AftermathStep } from "../decision-engine/aftermath";
import { fetchAftermathWording } from "../ai/client";
import { loadSpreadCalibration } from "../db/spread";
import type { Calibration } from "../decision-engine/spreadCalibration";
import { chart, colors, radius, spacing, type } from "../theme/tokens";
import { Body, Card, Chip, Eyebrow, Icon, Notice, Reveal, SectionTitle, Small, Star, Text, Title, tabular, type IconName } from "./ui";
import { FanChart, FeltGrid, FuturesRiver } from "./FuturesChart";
import { t } from "../i18n";

type Wording = { likely: string; goodTurn: string; hardTurn: string }[];
const pct = (n: number) => `${Math.round(n * 100)}%`;
/** Below this many rated outcomes the fit is left unused: it would be the prior talking. */
const MIN_OUTCOMES = 3;
let calibrationOnce: Promise<Calibration> | null = null;

export function Aftermath({ title, options, factors, mode, stakes, safety, signal, leaderId, chosenId, checkIns, active = true }: {
  title: string;
  options: DecisionOption[];
  factors: DecisionFactor[];
  mode: DecisionMode;
  stakes: Stakes;
  safety: SafetyClass;
  signal: boolean;
  leaderId: string;
  chosenId: string | null;
  /** The picture's early signs are what the check-ins will ask about. */
  checkIns: boolean;
  /** False while the card is mounted but hidden: the AI wording is not asked for until it is on screen. */
  active?: boolean;
}) {
  const [optionId, setOptionId] = useState(chosenId ?? leaderId);
  // Fitted to how this person's past decisions turned out; only the width of the ranges, and said on screen.
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  useEffect(() => {
    calibrationOnce ??= loadSpreadCalibration().catch(() => ({ spread: 1, n: 0, brierBefore: null, brierAfter: null }));
    void calibrationOnce.then(setCalibration);
  }, []);
  const spread = calibration && calibration.n >= MIN_OUTCOMES ? calibration.spread : 1;
  // Choosing an option shows its future; until then the leader's.
  useEffect(() => { setOptionId(chosenId ?? leaderId); }, [chosenId, leaderId]);
  const picture = useMemo(
    () => aftermath({ options, factors, optionId, mode, stakes, safety, signal, spread }),
    [options, factors, optionId, mode, stakes, safety, signal, spread],
  );

  // The strongest alternative: the other option whose own picture ends best. It is what this choice gives up.
  const alternative = useMemo(() => {
    const others = options.filter((o) => o.id !== optionId)
      .map((o) => aftermath({ options, factors, optionId: o.id, mode, stakes, safety, signal, spread }))
      .filter((a): a is NonNullable<typeof a> => a !== null);
    return others.sort((a, b) => b.steps[b.steps.length - 1].value - a.steps[a.steps.length - 1].value)[0] ?? null;
  }, [options, factors, optionId, mode, stakes, safety, signal, spread]);

  // AI wording per exact model, so re-weighting a factor asks again and switching back is instant.
  const key = JSON.stringify([optionId, factors.map((f) => [f.id, f.weight]), options.map((o) => o.outcomes)]);
  const cache = useRef(new Map<string, Wording | null>());
  const [wording, setWording] = useState<{ key: string; steps: Wording | null } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!picture || !active) return;
    if (cache.current.has(key)) { setWording({ key, steps: cache.current.get(key) ?? null }); return; }
    let live = true;
    setLoading(true);
    void fetchAftermathWording({ title, options, factors, safety, optionId, mode, stakes }).then((steps) => {
      const usable = steps && steps.length === picture.steps.length ? steps : null;
      cache.current.set(key, usable);
      if (live) { setWording({ key, steps: usable }); setLoading(false); }
    });
    return () => { live = false; };
  // `key` captures the whole model this effect depends on.
  }, [key, picture?.steps.length, active]);

  if (!picture) return null;
  const said = takeaways(picture, alternative);
  const words = wording?.key === key ? wording.steps : null;
  const isChosen = chosenId === picture.optionId;

  return (
    <Reveal>
      <Card style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Star size={13} />
            <Eyebrow color={colors.accentBright}>{t("Aftermath")}</Eyebrow>
          </View>
          <Title size={type.screenTitle - 4}>{t("If you choose {option}", { option: picture.optionLabel })}</Title>
          <Small>{t("A possible future drawn from ORION's estimates, not a prediction: from the first days to years out, so you can picture living with the choice, not just making it.")}</Small>
        </View>

        {options.length > 1 && (
          <View accessibilityRole="radiogroup" accessibilityLabel={t("Picture the aftermath of")} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {options.map((o) => (
              <Chip key={o.id} label={o.label} selected={o.id === optionId} icon={o.id === chosenId ? "checkmark" : undefined} onPress={() => setOptionId(o.id)} />
            ))}
          </View>
        )}

        {picture.caution && <Notice tone="warning" icon="alert-circle-outline">{picture.caution}</Notice>}

        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{t("Where the futures go")}</SectionTitle>
          <FuturesRiver steps={picture.steps} headline={said.odds} />
          {spread !== 1 && calibration && (
            <Small>
              {spread > 1
                ? t("Ranges widened to fit how your last {n} rated decisions turned out (×{spread}). Only the spread changes, never which option leads.", { n: calibration.n, spread: spread.toFixed(2) })
                : t("Ranges narrowed to fit how your last {n} rated decisions turned out (×{spread}). Only the spread changes, never which option leads.", { n: calibration.n, spread: spread.toFixed(2) })}
            </Small>
          )}
        </View>

        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{t("How it could unfold")}</SectionTitle>
          <FanChart
            headline={said.path}
            crossing={said.crossing}
            series={[
              { id: picture.optionId, label: picture.optionLabel, color: chart.pictured, steps: picture.steps, band: true },
              ...(alternative ? [{ id: alternative.optionId, label: alternative.optionLabel, color: chart.alternative, steps: alternative.steps }] : []),
            ]}
          />
        </View>

        <SectionTitle>{t("Step by step")}</SectionTitle>
        <View accessibilityRole="list">
          {picture.steps.map((step, i) => (
            <View key={`${picture.optionId}:${step.days}`}>
              {/* Where the picture stops being checkable and becomes a projection, say so once. */}
              {step.horizon === "far" && picture.steps[i - 1]?.horizon === "near" && (
                <View style={{ flexDirection: "row", gap: spacing.md, paddingBottom: spacing.lg }}>
                  <View style={{ width: 22, alignItems: "center" }}><View style={{ flex: 1, width: 1, backgroundColor: colors.line }} /></View>
                  <View style={{ flex: 1, gap: 4, padding: 14, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.lineStrong }}>
                    <Eyebrow color={colors.accentBright}>{t("Looking further ahead")}</Eyebrow>
                    <Small>
                      {t("From here the picture reaches past the next season. Effects that build or compound have had time to show, early strain has mostly faded, and the odds widen because nobody sees years out as clearly as next month. Read it as a direction, not a forecast.")}
                    </Small>
                  </View>
                </View>
              )}
              <Moment
                step={step}
                text={words?.[i] ?? step}
                last={i === picture.steps.length - 1}
                asked={isChosen && checkIns && step.checkIn}
                index={i}
              />
            </View>
          ))}
        </View>

        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{t("When each effect is felt")}</SectionTitle>
          <FeltGrid steps={picture.steps} headline={said.timing} />
        </View>

        <Small style={{ color: colors.faint }}>
          {loading && !words ? `${t("Putting it into words…")} ` : ""}
          {t("Odds are how likely the effect so far is clearly good, mixed, or clearly hard, given how sure the estimates are. They widen the further out you look, and the timeline stretches: each step is further from the last, from days to years.")}
        </Small>
      </Card>
    </Reveal>
  );
}

function Moment({ step, text, last, asked, index }: {
  step: AftermathStep;
  text: { likely: string; goodTurn: string; hardTurn: string };
  last: boolean;
  asked: boolean;
  index: number;
}) {
  return (
    <Reveal index={index}>
      <View accessibilityRole="none" style={{ flexDirection: "row", gap: spacing.md }}>
        {/* The rail: a star for each moment, joined by a hairline orbit; the farthest moment is the blue star. */}
        <View style={{ width: 22, alignItems: "center" }}>
          <View style={{ height: 22, alignItems: "center", justifyContent: "center" }}>
            {last ? <Star size={18} /> : <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 1.5, borderColor: colors.white }} />}
          </View>
          {!last && <View style={{ flex: 1, width: 1, backgroundColor: step.horizon === "far" ? colors.line : colors.lineStrong, marginVertical: 4 }} />}
        </View>
        <View style={{ flex: 1, gap: spacing.sm, paddingBottom: last ? 0 : spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
            <Eyebrow color={colors.white}>{step.when}</Eyebrow>
            {!step.checkIn && step.horizon === "far" && <Text style={{ fontSize: 11, color: colors.faint, letterSpacing: 0.4 }}>{t("projection")}</Text>}
          </View>
          <Body>{text.likely}</Body>
          <Odds odds={step.odds} />
          <Turn icon="trending-up" color={chart.helps} label={t("Good turn")} text={text.goodTurn} />
          <Turn icon="trending-down" color={chart.hurts} label={t("Hard turn")} text={text.hardTurn} />
          <View style={{ flexDirection: "row", gap: spacing.sm, padding: 12, borderRadius: radius.md, backgroundColor: colors.sunken }}>
            <Icon name="eye-outline" size={17} color={colors.accentBright} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: type.supporting, color: colors.white }}>{t("Watch for: {sign}", { sign: step.sign })}</Text>
              {asked && <Small>{t("ORION will ask you this when it checks in.")}</Small>}
            </View>
          </View>
        </View>
      </View>
    </Reveal>
  );
}

function Odds({ odds }: { odds: AftermathStep["odds"] }) {
  // [id, label, share, colour]: the id keys and styles; only the label is shown.
  const parts: [string, string, number, string][] = [
    ["well", t("Goes well"), odds.well, chart.helps],
    ["mixed", t("Mixed"), odds.mixed, colors.faint],
    ["hard", t("Hard"), odds.hard, chart.hurts],
  ];
  return (
    <View accessibilityLabel={t("Odds: Goes well {well}, Mixed {mixed}, Hard {hard}", { well: pct(odds.well), mixed: pct(odds.mixed), hard: pct(odds.hard) })} style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", height: 6, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.sunken, gap: 2 }}>
        {parts.map(([id, , v, c]) => v > 0 && <View key={id} style={{ flex: v, backgroundColor: c, opacity: id === "mixed" ? 0.5 : 0.9 }} />)}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        {parts.map(([id, l, v, c]) => (
          <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
            <Text style={[{ fontSize: type.metadata, color: colors.muted }, tabular]}>{`${l} ${pct(v)}`}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Turn({ icon, color, label, text }: { icon: IconName; color: string; label: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      <Icon name={icon} size={16} color={color} style={{ marginTop: 3 }} />
      <Text style={{ flex: 1, fontSize: type.supporting, lineHeight: 21, fontWeight: "300", color: colors.body }}>
        <Text style={{ fontSize: type.supporting, fontWeight: "500", color: colors.white }}>{`${label}: `}</Text>
        {text}
      </Text>
    </View>
  );
}
