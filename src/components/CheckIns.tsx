// Check-ins that have come due, shown on Home: ORION following up on what it promised to ask about.
import { View } from "react-native";
import { RATINGS, type DueFollowUp } from "../db/followups";
import { colors, spacing } from "../theme/tokens";
import { AppButton, Card, Chip, Eyebrow, Icon, Reveal, Small, Text } from "./ui";
import { msg, t } from "../i18n";

/** Ratings are stored in English (History and calibration read them); this is how each is shown. */
const RATING_LABEL: Record<(typeof RATINGS)[number], string> = {
  Great: msg("Great"), Good: msg("Good"), Neutral: msg("Neutral"), Bad: msg("Bad"), "Very bad": msg("Very bad"),
};

export function CheckIns({ items, onRate, onSnooze, onResume, onDrop }: {
  items: DueFollowUp[];
  onRate: (item: DueFollowUp, rating: string) => void;
  onSnooze: (item: DueFollowUp) => void;
  onResume: (item: DueFollowUp) => void;
  onDrop: (item: DueFollowUp) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ width: "100%", maxWidth: 780, gap: spacing.sm }}>
      <Eyebrow color={colors.body}>{items.length === 1 ? t("A quick check-in") : t("{n} quick check-ins", { n: items.length })}</Eyebrow>
      {items.slice(0, 3).map((item, i) => (
        <Reveal key={item.id} index={i}>
          <Card style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Icon name={item.kind === "open" ? "time-outline" : "chatbubble-ellipses-outline"} size={18} color={colors.accentBright} />
              <Text style={{ flex: 1, fontSize: 16, color: colors.white }} numberOfLines={2}>{item.title}</Text>
            </View>
            <Small>{item.kind === "outcome" && item.chosen ? t("You chose “{choice}”. {prompt}", { choice: item.chosen, prompt: item.prompt }) : item.prompt}</Small>
            {item.kind === "outcome" ? (
              <View accessibilityRole="radiogroup" accessibilityLabel={t("How did \"{title}\" turn out?", { title: item.title })} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {RATINGS.map((rating) => <Chip key={rating} label={t(RATING_LABEL[rating])} onPress={() => onRate(item, rating)} />)}
                <Chip quiet label={t("Too early — ask me later")} onPress={() => onSnooze(item)} />
              </View>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                <AppButton variant="secondary" icon="play-outline" title={t("Pick it up")} onPress={() => onResume(item)} />
                <AppButton variant="ghost" title={t("Ask me later")} onPress={() => onSnooze(item)} />
                <AppButton variant="ghost" title={t("No longer deciding")} onPress={() => onDrop(item)} />
              </View>
            )}
          </Card>
        </Reveal>
      ))}
    </View>
  );
}
