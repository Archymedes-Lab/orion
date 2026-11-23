import { useState } from "react";
import { View, TextInput } from "react-native";
import { Card, SectionTitle, Small, Body, AppButton } from "./ui";
import { type FollowUpStep } from "../decision-engine/followUp";
import { msg, t } from "../i18n";

/** The check-in's three answers: stored by id, shown in words. */
const RATING_LABEL = { better: msg("Better"), expected: msg("Expected"), worse: msg("Worse") } as const;

export function CheckInSchedule({ steps, onCheckIn }: { steps: FollowUpStep[]; onCheckIn: (step: FollowUpStep) => void }) {
  return (
    <Card>
      <SectionTitle>{t("Check-ins ahead")}</SectionTitle>
      <Small style={{ color: "#666", marginBottom: 8 }}>
        {t("ORION will prompt you at these intervals to review how the decision is unfolding.")}
      </Small>
      {steps.map((step, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: i < steps.length - 1 ? 1 : 0, borderColor: "#e5e7eb" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Body style={{ fontWeight: "500" }}>{step.prompt}</Body>
            <Small style={{ color: "#666" }}>
              {step.days === 1
                ? step.kind === "outcome" ? t("Due in 1 day (Outcome review)") : t("Due in 1 day (Still deciding?)")
                : step.kind === "outcome" ? t("Due in {n} days (Outcome review)", { n: step.days }) : t("Due in {n} days (Still deciding?)", { n: step.days })}
            </Small>
          </View>
          <AppButton variant="secondary" title={t("Open")} onPress={() => onCheckIn(step)} />
        </View>
      ))}
    </Card>
  );
}

export function CheckInForm({ step, onSubmit }: { step: FollowUpStep; onSubmit: (rating: "better" | "expected" | "worse", notes: string) => void }) {
  const [rating, setRating] = useState<"better" | "expected" | "worse">("expected");
  const [notes, setNotes] = useState("");

  return (
    <Card>
      <SectionTitle>{step.prompt}</SectionTitle>
      <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
        {(["better", "expected", "worse"] as const).map((r) => (
          <AppButton
            key={r}
            variant={rating === r ? "primary" : "ghost"}
            title={t(RATING_LABEL[r])}
            onPress={() => setRating(r)}
          />
        ))}
      </View>
      <TextInput
        multiline
        placeholder={t("What happened? Any surprises? What would you do differently?")}
        value={notes}
        onChangeText={setNotes}
        style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 12, minHeight: 100, fontSize: 16 }}
      />
      <AppButton title={t("Save Check-In")} onPress={() => onSubmit(rating, notes)} style={{ marginTop: 16 }} />
    </Card>
  );
}