// Start from a template: pick a kind of decision, name your options, and ORION brings the factors.
import { useState } from "react";
import { View } from "react-native";
import { BUSINESS_TEMPLATES, TEMPLATES, templateOptions, type DecisionTemplate } from "../decision-engine/templates";
import { useBusiness } from "../business/profile";
import { msg, t } from "../i18n";
import { colors, spacing } from "../theme/tokens";
import { AppButton, Card, Chip, Eyebrow, LabeledField, Reveal, Small, Tag, type IconName } from "./ui";

const MODE_TAG = { playful: msg("Quick call"), everyday: msg("Everyday"), serious: msg("Big decision") } as const;

export function TemplatePicker({ onStart, disabled }: {
  onStart: (templateId: string, options: string[], details: string) => void;
  disabled?: boolean;
}) {
  const business = useBusiness((b) => b.lens === "business");
  const shown = business ? BUSINESS_TEMPLATES : TEMPLATES;
  const [open, setOpen] = useState<DecisionTemplate | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const choose = (template: DecisionTemplate) => {
    if (open?.id === template.id) { setOpen(null); return; }
    setOpen(template);
    setNames(template.options.map((o) => o.value));
    setDetails("");
    setError(null);
  };
  const start = () => {
    if (!open) return;
    const clean = templateOptions(names);
    if (!clean) { setError(t("Name at least two different options.")); return; }
    onStart(open.id, clean, details);
  };
  return (
    <View style={{ width: "100%", maxWidth: 780, gap: spacing.sm }}>
      <Eyebrow color={colors.body}>{business ? t("Or start from a business template") : t("Or start from a template")}</Eyebrow>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {shown.map((template) => (
          <Chip key={template.id} label={template.name} icon={template.icon as IconName} selected={open?.id === template.id} onPress={() => choose(template)} />
        ))}
      </View>
      {open && (
        <Reveal key={open.id}>
          <Card style={{ gap: spacing.md }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
              <Tag label={t(MODE_TAG[open.mode])} tone={open.mode === "serious" ? "info" : "neutral"} />
              <Small>{open.blurb}</Small>
            </View>
            {open.options.map((o, i) => (
              <LabeledField
                key={o.placeholder}
                label={o.placeholder}
                value={names[i] ?? ""}
                onChangeText={(text) => { setNames((old) => old.map((n, j) => (j === i ? text : n))); setError(null); }}
                maxLength={80}
                onSubmitEditing={start}
              />
            ))}
            <LabeledField
              label={t("Anything ORION should know? (optional)")}
              value={details}
              onChangeText={setDetails}
              placeholder={business ? t("e.g. 40 customers, most on annual plans; the contractor quoted for three months") : t("e.g. the offer pays 15% more but the commute doubles")}
              maxLength={1000}
              multiline
            />
            <Small>{t("It will weigh: {factors}. You can change these on the next screen.", { factors: open.factors.map((f) => f.label.toLowerCase()).join(", ") })}</Small>
            {error && <Small style={{ color: colors.danger }}>{error}</Small>}
            <AppButton title={t("Compare")} iconRight="arrow-forward" disabled={disabled} onPress={start} style={{ alignSelf: "flex-start" }} />
          </Card>
        </Reveal>
      )}
    </View>
  );
}
