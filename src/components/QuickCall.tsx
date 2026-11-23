// ORION's call: the decisive one-liner at the top of a result. For a fun decision it is the whole answer.
// For an everyday or serious one it also carries the two reasons and the one thing that would change it, so
// the first screen answers the question before any score, bar or percentage appears.
import type { ReactNode } from "react";
import { View } from "react-native";
import type { TheCall } from "../decision-engine/call";
import type { DecisionMode } from "../decision-engine/mode";
import { getLocale, listPhrase, msg, t } from "../i18n";
import { colors, radius, spacing } from "../theme/tokens";
import { AppButton, Body, Eyebrow, Icon, Reveal, Small, Title, blur } from "./ui";

const EYEBROW: Record<DecisionMode, string> = { playful: msg("Quick call"), everyday: msg("ORION's call"), serious: msg("Where it stands") };

const panel = [{ gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft }, blur];

/** Why, in at most two plain lines, and what would change the answer, in one. */
function Grounds({ reasons, change }: { reasons?: string[]; change?: string }) {
  const why = (reasons ?? []).slice(0, 2);
  if (why.length === 0 && !change) return null;
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
      {why.length > 0 && (
        <View style={{ gap: spacing.xs }}>
          <Eyebrow>{t("Why")}</Eyebrow>
          {why.map((reason) => (
            <View key={reason} style={{ flexDirection: "row", gap: 10 }}>
              <Icon name="checkmark-circle-outline" size={18} color={colors.success} style={{ marginTop: 2 }} />
              <Body style={{ flex: 1, color: colors.ink }}>{reason}</Body>
            </View>
          ))}
        </View>
      )}
      {change && (
        <View style={{ gap: spacing.xs }}>
          <Eyebrow>{t("What would change the answer")}</Eyebrow>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Icon name="swap-horizontal-outline" size={18} color={colors.accentBright} style={{ marginTop: 2 }} />
            <Body style={{ flex: 1, color: colors.ink }}>{change}</Body>
          </View>
        </View>
      )}
    </View>
  );
}

export function QuickCall({ call, mode, chosen, disabled, onGo, onFlip, onCompare, comparing, replay, reasons, change }: {
  call: TheCall;
  mode: DecisionMode;
  /** The option already committed, if any. */
  chosen: string | null;
  disabled?: boolean;
  onGo: (optionId: string) => void;
  /** Offered for a coin flip. */
  onFlip?: () => void;
  /** Shows or hides the full comparison under a fun call. */
  onCompare?: () => void;
  comparing?: boolean;
  /** Changes on every flip, so the card animates in again. */
  replay?: number;
  /** Why it leads, in plain sentences; at most two are shown. */
  reasons?: string[];
  /** What would change the answer, in one plain sentence. */
  change?: string;
}) {
  const done = chosen === call.optionId;
  return (
    <Reveal replay={replay}>
      <View accessibilityRole="summary" style={panel}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon name={call.kind === "coin" ? "sync-circle-outline" : mode === "playful" ? "sparkles-outline" : "compass-outline"} size={16} color={colors.white} />
          <Eyebrow color={colors.white}>{call.kind === "coin" ? t("Coin flip") : t(EYEBROW[mode])}</Eyebrow>
        </View>
        <Title size={32}>{call.headline}</Title>
        <Body style={{ color: colors.ink }}>{call.line}</Body>
        <Grounds reasons={reasons} change={change} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs }}>
          {mode !== "serious" && (
            <AppButton
              title={done ? t("Going with {option}", { option: call.label }) : t("Do it")}
              icon={done ? "checkmark" : undefined}
              iconRight={done ? undefined : "arrow-forward"}
              selected={done}
              disabled={disabled}
              onPress={() => onGo(call.optionId)}
            />
          )}
          {onFlip && <AppButton variant="secondary" icon="sync-outline" title={t("Flip again")} disabled={disabled} onPress={onFlip} />}
          {onCompare && (
            <AppButton variant="ghost" icon={comparing ? "chevron-up" : "stats-chart-outline"} title={comparing ? t("Hide the comparison") : t("Show me why")} expanded={comparing} onPress={onCompare} />
          )}
        </View>
        {call.kind !== "coin" && mode !== "serious" && <Small>{t("The choice is still yours — pick another option below if your gut says so.")}</Small>}
      </View>
    </Reveal>
  );
}

/**
 * The honest answer when nothing separates the options. It takes the place of the call: ORION says so in the
 * first line rather than inventing a winner. `children` is for the coin ORION offers on an everyday decision.
 */
export function TooCloseToCall({ labels, change, children }: { labels: string[]; change?: string; children?: ReactNode }) {
  // Korean names them with commas ("A, B 모두"); English reads "A and B".
  const names = getLocale() === "ko" ? labels.join(", ") : listPhrase(labels);
  return (
    <Reveal>
      <View accessibilityRole="summary" style={panel}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon name="git-compare-outline" size={16} color={colors.white} />
          <Eyebrow color={colors.white}>{t("Too close to call")}</Eyebrow>
        </View>
        <Title size={32}>{t("Nothing separates them.")}</Title>
        <Body style={{ color: colors.ink }}>{t("{options} come out level on what you weighed, so ORION is not picking one.", { options: names })}</Body>
        <Grounds change={change} />
        {children}
      </View>
    </Reveal>
  );
}
