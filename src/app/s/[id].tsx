// What a friend sees when someone shares a decision: pick an option, say what matters most, add a note.
// No account and nothing saved on the friend's device.
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { answerShared, openShared, type SharedDecision } from "../../share/client";
import { AppButton, Card, Chip, EmptyState, Eyebrow, LabeledField, Notice, PageHeader, Reveal, Screen, SectionTitle, Skeleton, Small } from "../../components/ui";
import { colors, layout, spacing } from "../../theme/tokens";
import { t } from "../../i18n";

export default function SharedDecisionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [decision, setDecision] = useState<SharedDecision | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let live = true;
    if (typeof id !== "string") return;
    void openShared(id).then((result) => {
      if (!live) return;
      if (result.ok) setDecision(result.value); else setLoadError(result.error);
    });
    return () => { live = false; };
  }, [id]);

  const send = async () => {
    if (!optionId || typeof id !== "string") { setError(t("Pick the option you would choose.")); return; }
    setBusy(true); setError(null);
    const result = await answerShared(id, { optionId, factorId, name: name.trim() || undefined, note: note.trim() || undefined });
    setBusy(false);
    if (result.ok) setSent(true); else setError(result.error);
  };

  const column = { width: "100%" as const, maxWidth: layout.column, alignSelf: "center" as const, gap: spacing.lg };
  if (loadError) {
    return (
      <Screen title={t("Shared decision")}>
        <EmptyState icon="link-outline" title={t("This link doesn't work any more")} action={<AppButton title={t("Make your own decision")} iconRight="arrow-forward" onPress={() => router.replace("/")} />}>
          {loadError}
        </EmptyState>
      </Screen>
    );
  }
  if (!decision) {
    return <Screen title={t("Shared decision")}><Card><Skeleton width="60%" height={24} /><Skeleton height={14} /><Skeleton width="80%" height={14} /></Card></Screen>;
  }
  if (sent) {
    const chosen = decision.options.find((o) => o.id === optionId)?.label;
    return (
      <Screen title={t("Thanks")}>
        <View style={column}>
          <PageHeader eyebrow={t("Sent")} title={t("Thanks for helping")} />
          <Notice tone="success">{chosen ? t("Your pick, “{option}”, is on its way. Only the person who asked can see it.", { option: chosen }) : t("Your pick is on its way. Only the person who asked can see it.")}</Notice>
          <Small>{t("Stuck on something yourself? ORION lays out any decision in a couple of minutes — big or small.")}</Small>
          <AppButton title={t("Try ORION")} iconRight="arrow-forward" onPress={() => router.replace("/")} style={{ alignSelf: "flex-start" }} />
        </View>
      </Screen>
    );
  }
  return (
    <Screen title={t("Help decide: {title}", { title: decision.title })}>
      <View style={column}>
        <PageHeader eyebrow={t("A friend asked for your opinion")} title={decision.title}>
          <Small>{t("No account needed. Your answer goes only to the person who sent you this link.")}</Small>
        </PageHeader>
        <Reveal>
          <Card style={{ gap: spacing.md }}>
            <SectionTitle>{t("Which would you pick?")}</SectionTitle>
            <View accessibilityRole="radiogroup" accessibilityLabel={t("Which would you pick?")} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {decision.options.map((o) => <Chip key={o.id} label={o.label} selected={optionId === o.id} onPress={() => { setOptionId(o.id); setError(null); }} />)}
            </View>
            {decision.factors.length > 1 && (
              <>
                <SectionTitle>{t("What should matter most? (optional)")}</SectionTitle>
                <View accessibilityRole="radiogroup" accessibilityLabel={t("What should matter most?")} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {decision.factors.map((f) => <Chip key={f.id} label={f.label} selected={factorId === f.id} onPress={() => setFactorId(factorId === f.id ? null : f.id)} />)}
                </View>
              </>
            )}
            <LabeledField label={t("Anything to add? (optional)")} value={note} onChangeText={setNote} maxLength={280} multiline placeholder={t("Why you would pick it, or what they might be missing")} />
            <LabeledField label={t("Your name (optional)")} value={name} onChangeText={setName} maxLength={40} autoComplete="name" />
            {error && <Notice tone="danger" alert>{error}</Notice>}
            <AppButton title={busy ? t("Sending…") : t("Send my answer")} iconRight="send" disabled={busy} onPress={() => void send()} style={{ alignSelf: "flex-start" }} />
          </Card>
        </Reveal>
        <Eyebrow color={colors.faint}>{t("ORION · better decisions, everyday life")}</Eyebrow>
      </View>
    </Screen>
  );
}
