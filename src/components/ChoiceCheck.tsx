// Shown after someone commits to an option the comparison does not rank first.
// It does not argue. It says what the choice costs on the numbers, what would have to be true for it to be the
// better option, and asks what is behind it, because that answer is usually what the comparison was missing.
import { View } from "react-native";
import type { Divergence } from "../decision-engine/divergence";
import type { ChoiceReason } from "../store/session";
import { msg, t } from "../i18n";
import { colors, radius, spacing, type } from "../theme/tokens";
import { AppButton, Body, Eyebrow, Icon, SectionTitle, Small, Text, tabular } from "./ui";

/** Whole percentages that never round two different shares to the same number. */
export function shares(from: number, to: number): [number, number] {
  const a = Math.round(from * 100);
  let b = Math.round(to * 100);
  if (a === b) b += to > from ? 1 : -1;
  return [a, Math.max(0, Math.min(100, b))];
}

type Sure = "very" | "fairly" | "somewhat";
const SURE: [number, Sure][] = [[2, "very"], [1.25, "fairly"], [0, "somewhat"]];
const sureLevel = (certainty: number) => SURE.find(([min]) => certainty >= min)![1];
const SURE_LABEL: Record<Sure, string> = { very: msg("very sure"), fairly: msg("fairly sure"), somewhat: msg("only somewhat sure") };
const sureness = (certainty: number) => t(SURE_LABEL[sureLevel(certainty)]);

/** The cost of the choice, as one sentence per sureness and strength: each language words them its own way. */
function costLine(sure: Sure, strongly: boolean, vars: { chosen: string; leader: string; gap: string }): string {
  if (strongly) {
    if (sure === "very") return t("You chose {chosen}. On these estimates {leader} comes out {gap} points ahead, and the comparison is very sure of that, so this is well against the numbers. The choice is yours, and people often have a good reason the numbers missed.", vars);
    if (sure === "fairly") return t("You chose {chosen}. On these estimates {leader} comes out {gap} points ahead, and the comparison is fairly sure of that, so this is well against the numbers. The choice is yours, and people often have a good reason the numbers missed.", vars);
    return t("You chose {chosen}. On these estimates {leader} comes out {gap} points ahead, and the comparison is only somewhat sure of that, so this is well against the numbers. The choice is yours, and people often have a good reason the numbers missed.", vars);
  }
  if (sure === "very") return t("You chose {chosen}. On these estimates {leader} comes out {gap} points ahead, and the comparison is very sure of that. The choice is yours, and people often have a good reason the numbers missed.", vars);
  if (sure === "fairly") return t("You chose {chosen}. On these estimates {leader} comes out {gap} points ahead, and the comparison is fairly sure of that. The choice is yours, and people often have a good reason the numbers missed.", vars);
  return t("You chose {chosen}. On these estimates {leader} comes out {gap} points ahead, and the comparison is only somewhat sure of that. The choice is yours, and people often have a good reason the numbers missed.", vars);
}

const AFTER: Record<ChoiceReason, string> = {
  priority: msg("Updated. The comparison now weighs that the way you do, and ORION will remember it for next time."),
  missing: msg("Add what is missing under “What ORION understood” above, and the comparison will include it."),
  scores: msg("Adjust the estimates in the table below and the ranking will follow."),
  deliberate: msg("Noted as a deliberate choice. Rate how it turns out in History, and Insights will show how your calls like this go."),
};

export function ChoiceCheck({ assessment, chosenLabel, leaderLabel, reason, hardToUndo, onReason, disabled, readOnly, locked, onUnlock }: {
  assessment: Divergence;
  chosenLabel: string;
  leaderLabel: string;
  reason: ChoiceReason | null;
  /** The chosen option is hard to reverse and the stakes are high: worth saying once. */
  hardToUndo?: boolean;
  onReason?: (reason: ChoiceReason) => void;
  disabled?: boolean;
  /** Analysis page: show the assessment without asking again. */
  readOnly?: boolean;
  /** "What would justify it" is a paid feature and this person does not have it. The cost and the question stay free. */
  locked?: boolean;
  onUnlock?: () => void;
}) {
  const { level, gap, certainty, implied, dominated } = assessment;
  if (level === "none" || level === "aligned") {
    // After "it matters more than I said" the choice leads; keep the acknowledgement on screen.
    return reason ? <Small style={{ color: colors.success }}>{t(AFTER[reason])}</Small> : null;
  }
  if (level === "tossup") {
    return <Small>{t("{leader} scores slightly higher, but by less than the estimates can tell apart. Either is a reasonable choice.", { leader: leaderLabel })}</Small>;
  }

  const [from, to] = implied ? shares(implied.from, implied.to) : [0, 0];
  const justify = implied
    ? t("This is the better choice if {factor} carries about {to}% of the decision, not {from}%.", { factor: implied.label.toLowerCase(), to, from })
    : dominated
      ? t("Nothing on the list favours it: {leader} does at least as well on every factor. So something that is not on the list must be worth at least {gap} points to you.", { leader: leaderLabel, gap: gap.toFixed(1) })
      : t("No single change to what matters puts it first. Something that is not on the list must be worth at least {gap} points to you.", { gap: gap.toFixed(1) });
  const figures: [string, string][] = [
    [t("Given up"), t("{gap} points", { gap: gap.toFixed(1) })],
    [t("The comparison is"), sureness(certainty)],
    ...(locked ? [] : [[t("To justify it"), implied ? `${implied.label} ${from}% → ${to}%` : t("Something unlisted")] as [string, string]]),
  ];

  return (
    <View accessibilityRole="summary" style={{ gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warningLine, backgroundColor: colors.warningSoft }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name="git-compare-outline" size={17} color={colors.warning} />
        <Eyebrow color={colors.warning}>{t("Your call")}</Eyebrow>
      </View>
      <Body style={{ fontSize: 15, lineHeight: 23, color: colors.ink }}>
        {costLine(sureLevel(certainty), level === "strongly_against", { chosen: chosenLabel, leader: leaderLabel, gap: gap.toFixed(1) })}
      </Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        {figures.map(([label, value]) => (
          <View key={label} style={{ flexGrow: 1, flexBasis: 110, gap: 2 }}>
            <Text style={{ fontSize: type.metadata, color: colors.muted }}>{label}</Text>
            <Text style={[{ fontSize: type.supporting, fontWeight: "500", color: colors.white }, tabular]}>{value}</Text>
          </View>
        ))}
      </View>
      {!locked && <Small style={{ color: colors.body }}>{justify}</Small>}
      {locked && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
          <Small style={{ color: colors.body, flexShrink: 1 }}>{t("What would have to matter more for this to be the better choice is part of ORION Pro.")}</Small>
          {onUnlock && <AppButton variant="ghost" title={t("See how to unlock")} onPress={onUnlock} style={{ minHeight: 32, paddingHorizontal: 10 }} />}
        </View>
      )}
      {hardToUndo && <Small style={{ color: colors.body }}>{t("This one is hard to undo, so it is worth a minute before you act on it.")}</Small>}
      {!readOnly && !reason && onReason && (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>{t("What is behind it?")}</SectionTitle>
          <View style={{ gap: spacing.sm }}>
            {implied && !locked && <AppButton variant="secondary" disabled={disabled} title={implied.to > implied.from ? t("{factor} matters more than I said", { factor: implied.label }) : t("{factor} matters less than I said", { factor: implied.label })} onPress={() => onReason("priority")} />}
            <AppButton variant="secondary" disabled={disabled} title={t("Something is missing from the list")} onPress={() => onReason("missing")} />
            <AppButton variant="secondary" disabled={disabled} title={t("I do not agree with the scores")} onPress={() => onReason("scores")} />
            <AppButton variant="ghost" disabled={disabled} title={t("I know. I am choosing it anyway")} onPress={() => onReason("deliberate")} />
          </View>
        </View>
      )}
      {reason && <Small style={{ color: colors.success }}>{t(AFTER[reason])}</Small>}
    </View>
  );
}
