// "Change what matters to you, and watch your decision change." The result is not a verdict to accept or
// reject: each tap makes one factor matter more or less, the comparison re-ranks at once (the same engine,
// nothing re-asked of the AI), and ORION says whether the leader held or changed and why.
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { colors, radius, spacing, type } from "../theme/tokens";
import { t } from "../i18n";
import { Body, Card, Chip, Eyebrow, Notice, SectionTitle, Small, Text, tabular } from "./ui";

export interface WhatMattersFactor { id: string; label: string; weight: number }

export function WhatMatters({
  factors,
  leaderLabel,
  tied,
  disabled,
  onNudge,
}: {
  factors: WhatMattersFactor[];
  leaderLabel: string;
  tied: boolean;
  disabled?: boolean;
  onNudge: (factorId: string, direction: "more" | "less") => void;
}) {
  // The tap that is waiting for the re-ranked result, and what ORION says about it once it arrives.
  const pending = useRef<{ label: string; direction: "more" | "less"; before: string; beforeTied: boolean } | null>(null);
  const [said, setSaid] = useState<{ text: string; changed: boolean } | null>(null);

  useEffect(() => {
    const tap = pending.current;
    if (!tap) return;
    pending.current = null;
    // Whole sentences for each direction: the reason sits in a different place in each language.
    const vars = { factor: tap.label.toLowerCase(), leader: leaderLabel };
    const more = tap.direction === "more";
    if (tied && !tap.beforeTied) {
      setSaid({ text: more ? t("Now it's too close to call: when {factor} matters more to you, neither option comes out clearly ahead.", vars) : t("Now it's too close to call: when {factor} matters less to you, neither option comes out clearly ahead.", vars), changed: true });
    } else if (!tied && (tap.beforeTied || leaderLabel !== tap.before)) {
      setSaid({ text: more ? t("Now {leader} comes out ahead, because {factor} matters more to you.", vars) : t("Now {leader} comes out ahead, because {factor} matters less to you.", vars), changed: true });
    } else {
      setSaid({ text: tied ? t("Still too close to call.") : more ? t("{leader} still comes out ahead, even when {factor} matters more to you.", vars) : t("{leader} still comes out ahead, even when {factor} matters less to you.", vars), changed: false });
    }
  }, [factors, leaderLabel, tied]);

  // Rows stay where they are while the person taps; only the numbers move.
  const rows = factors;
  const nudge = (f: WhatMattersFactor, direction: "more" | "less") => {
    pending.current = { label: f.label, direction, before: leaderLabel, beforeTied: tied };
    onNudge(f.id, direction);
  };

  return (
    <Card>
      <View style={{ gap: spacing.xs }}>
        <Eyebrow>{t("Your call, your priorities")}</Eyebrow>
        <SectionTitle>{t("Change what matters, watch the answer change")}</SectionTitle>
        <Small>{t("Tap More or Less on anything below. ORION re-ranks the options straight away and tells you if the answer changes.")}</Small>
      </View>
      <View style={{ gap: spacing.md }}>
        {rows.map((f) => (
          <View key={f.id} style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
              <Text style={{ flex: 1, minWidth: 120, fontSize: type.body, fontWeight: "400", color: colors.ink }}>{f.label}</Text>
              <Text style={[{ fontSize: type.supporting, fontWeight: "500", color: colors.body }, tabular]}>{`${Math.round(f.weight * 100)}%`}</Text>
              <Chip compact quiet label={t("Less")} accessibilityLabel={t("{factor} matters less", { factor: f.label })} onPress={() => { if (!disabled) nudge(f, "less"); }} />
              <Chip compact label={t("More")} accessibilityLabel={t("{factor} matters more", { factor: f.label })} onPress={() => { if (!disabled) nudge(f, "more"); }} />
            </View>
            <View style={{ height: 5, borderRadius: radius.pill, backgroundColor: colors.sunken, overflow: "hidden" }}>
              <View style={{ width: `${Math.max(2, Math.round(f.weight * 100))}%`, height: 5, borderRadius: radius.pill, backgroundColor: colors.accent }} />
            </View>
          </View>
        ))}
      </View>
      {said && <Notice tone={said.changed ? "info" : "neutral"}>{said.text}</Notice>}
      {!said && <Body style={{ color: colors.muted }}>{tied ? t("Right now nothing separates the options.") : t("Right now {leader} comes out ahead.", { leader: leaderLabel })}</Body>}
    </Card>
  );
}
