// The company ORION weighs business decisions for. Shown on the You screen; every field optional and explained.
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { GOALS, RISK, STAGES, TEAM_SIZES, profileSummary, teamLabel, useBusiness, type BusinessProfile } from "../business/profile";
import { t } from "../i18n";
import { apiEnabled } from "../ai/client";
import { useAccount } from "../account/store";
import { colors, spacing } from "../theme/tokens";
import { AppButton, Card, Chip, LabeledField, SectionTitle, Small, Tag, Text } from "./ui";

function Choices<K extends string>({ label, values, value, onChange, show }: {
  label: string; values: readonly K[] | Record<K, string>; value: K | undefined; onChange: (v: K | undefined) => void; show: (text: string) => string;
}) {
  const entries: [K, string][] = (Array.isArray(values) ? values.map((v) => [v, v]) : Object.entries(values) as [K, string][])
    .map(([key, text]) => [key, show(text)]);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 14, fontWeight: "500", color: colors.ink }}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {entries.map(([key, text]) => (
          <Chip key={key} label={text} compact selected={value === key} onPress={() => onChange(value === key ? undefined : key)} />
        ))}
      </View>
    </View>
  );
}

/** Two fields side by side when there is room, stacked on phones. */
function Pair({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.lg }}>{children}</View>;
}
const half = { flexGrow: 1, flexBasis: 320 } as const;

export function BusinessProfileCard() {
  const { lens, profile, save, clear, setLens } = useBusiness();
  const [draft, setDraft] = useState<BusinessProfile>(profile);
  const [runway, setRunway] = useState(profile.runwayMonths != null ? String(profile.runwayMonths) : "");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  useEffect(() => { setDraft(profile); setRunway(profile.runwayMonths != null ? String(profile.runwayMonths) : ""); }, [profile]);

  const set = (patch: Partial<BusinessProfile>) => { setDraft((d) => ({ ...d, ...patch })); setStatus("idle"); };
  const months = runway.trim() === "" ? null : Number(runway.replace(",", "."));
  const runwayError = months !== null && (!Number.isFinite(months) || months < 0 || months > 120) ? t("Months, from 0 to 120. Leave empty if profitable or unknown.") : null;
  const onSave = async () => {
    if (runwayError) return;
    // Empty strings become "not given", so nothing blank is sent to the model as if it were a fact.
    const clean = Object.fromEntries(Object.entries({ ...draft, runwayMonths: months })
      .filter(([, v]) => v !== undefined && v !== "" && !(typeof v === "string" && !v.trim()))) as BusinessProfile;
    try { await save(clean); setStatus("saved"); useAccount.getState().backupSoon(); } catch { setStatus("error"); }
  };

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" }}>
        <SectionTitle>{t("Your business")}</SectionTitle>
        <Tag label={lens === "business" ? t("Business mode on") : t("Business mode off")} tone={lens === "business" ? "info" : "neutral"} />
      </View>
      <Small>
        {apiEnabled()
          ? t("Deciding for a company? In business mode ORION treats questions as company decisions: it weighs cash and runway, revenue, execution risk, focus, what can be undone, and the people affected, using the details below. They are sent with each business question, never shared, and every field is optional.")
          : t("Deciding for a company? In business mode ORION treats questions as company decisions: it weighs cash and runway, revenue, execution risk, focus, what can be undone, and the people affected, using the details below. They are used when an ORION server scores options; every field is optional.")}
      </Small>
      <Pair>
        <View style={half}><LabeledField label={t("Company name")} value={draft.name ?? ""} onChangeText={(name) => set({ name })} maxLength={80} placeholder={t("Optional")} /></View>
        <View style={half}><LabeledField label={t("What it does")} value={draft.industry ?? ""} onChangeText={(industry) => set({ industry })} maxLength={80} placeholder={t("e.g. B2B software for dental clinics, a coffee shop")} /></View>
      </Pair>
      <Pair>
        <View style={half}><Choices label={t("Stage")} values={STAGES} value={draft.stage} onChange={(stage) => set({ stage })} show={t} /></View>
        <View style={half}><Choices label={t("Team size")} values={TEAM_SIZES} value={draft.team} onChange={(team) => set({ team })} show={(team) => teamLabel(team as (typeof TEAM_SIZES)[number])} /></View>
      </Pair>
      <Pair>
        <View style={half}>
          <LabeledField
            label={t("Cash runway (months)")} value={runway} onChangeText={(text) => { setRunway(text); setStatus("idle"); }} keyboardType="numeric" maxLength={5}
            placeholder={t("e.g. 9")} error={runwayError} hint={t("How long the cash lasts at today's spending. Under a year, ORION weighs cash much more heavily.")}
          />
        </View>
        <View style={half}><Choices label={t("Appetite for risk")} values={RISK} value={draft.risk} onChange={(risk) => set({ risk })} show={t} /></View>
      </Pair>
      <Choices label={t("Priority this year")} values={GOALS} value={draft.goal} onChange={(goal) => set({ goal })} show={t} />
      <LabeledField
        label={t("Anything else ORION should know")} value={draft.notes ?? ""} onChangeText={(notes) => set({ notes })} maxLength={600} multiline
        placeholder={t("e.g. 60 customers, two make up half of revenue; we are hiring our first salesperson")}
      />
      {profileSummary(profile) !== "" && <Small style={{ color: colors.faint }}>{t("Saved: {summary}", { summary: profileSummary(profile) })}</Small>}
      {status === "saved" && <Small style={{ color: colors.success }}>{t("Saved. Business questions now use these details.")}</Small>}
      {status === "error" && <Small style={{ color: colors.danger }}>{t("Could not save. Check the fields and try again.")}</Small>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        <AppButton title={t("Save")} icon="checkmark" onPress={() => void onSave()} disabled={Boolean(runwayError)} />
        <AppButton variant="secondary" icon={lens === "business" ? "person-outline" : "business-outline"}
          title={lens === "business" ? t("Switch to personal mode") : t("Switch to business mode")}
          onPress={() => void setLens(lens === "business" ? "personal" : "business")} />
        {profileSummary(profile) !== "" && <AppButton variant="secondary" icon="trash-outline" title={t("Clear details")} onPress={() => void clear().then(() => useAccount.getState().backupSoon())} />}
      </View>
    </Card>
  );
}
