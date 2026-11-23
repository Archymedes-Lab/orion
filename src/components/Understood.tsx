// "What ORION understood": the options and factors it read out of the question, and a way to correct them.
// A vague question still gets a reading; this is where the person sees it and puts it right.
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { getLocale, listPhrase, t } from "../i18n";
import { colors, spacing, type } from "../theme/tokens";
import { AppButton, Card, Field, IconButton, Notice, SectionTitle, Small, Text } from "./ui";

const MAX_OPTIONS = 4;
const MAX_FACTORS = 6;


/**
 * One line saying what ORION read: the options, and what matters most important first. No numbers: the first
 * screen gives the answer, and the weights are in the analysis where they can be changed.
 */
export function understoodLine(options: string[], factors: { label: string }[]): string {
  // Korean lists the options with commas ("A, B 중"), which reads more naturally there than "A 및 B 중".
  const choices = getLocale() === "ko" ? options.join(", ") : listPhrase(options);
  return t("comparing {options} on {factors}.", { options: choices, factors: listPhrase(factors.map((f) => f.label.toLowerCase())) });
}

export function Understood({ options, factors, guessed, suggested = false, startOpen, openSignal, onApply, disabled }: {
  options: string[];
  /** Label and share of the weight (0–1), most important first. */
  factors: { label: string; weight: number }[];
  /** ORION suggested the options because the question did not name any. */
  suggested?: boolean;
  /** ORION could not find the options in the question and fell back to a generic pair. */
  guessed: boolean;
  startOpen?: boolean;
  /** Bump this to open the editor from elsewhere on the page ("something is missing from the list"). */
  openSignal?: number;
  onApply: (options: string[], factors: string[]) => Promise<boolean>;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(Boolean(startOpen));
  const [optionDraft, setOptionDraft] = useState(guessed ? ["", ""] : options);
  const [factorDraft, setFactorDraft] = useState(factors.map((f) => f.label));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (openSignal) setEditing(true); }, [openSignal]);

  const filled = (list: string[]) => [...new Set(list.map((v) => v.trim()).filter(Boolean).map((v) => v.toLowerCase()))].length;
  const apply = async () => {
    if (filled(optionDraft) < 2) { setError(t("Name at least two different options to compare.")); return; }
    if (filled(factorDraft) < 1) { setError(t("Keep at least one thing that matters.")); return; }
    setError(null);
    setBusy(true);
    const ok = await onApply(optionDraft, factorDraft);
    setBusy(false);
    if (!ok) setError(t("Could not re-run the comparison. Try again."));
  };
  const list = (values: string[], set: (v: string[]) => void, max: number, min: number, placeholder: (i: number) => string, kind: "option" | "factor") => (
    <View style={{ gap: spacing.sm }}>
      {values.map((value, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Field
            value={value}
            onChangeText={(text) => set(values.map((v, j) => (j === i ? text : v)))}
            placeholder={placeholder(i)}
            accessibilityLabel={kind === "option" ? t("Option {n}", { n: i + 1 }) : t("Factor {n}", { n: i + 1 })}
            maxLength={kind === "option" ? 80 : 40}
            style={{ flex: 1 }}
          />
          <IconButton icon="close" accessibilityLabel={kind === "option" ? t("Remove option {n}", { n: i + 1 }) : t("Remove factor {n}", { n: i + 1 })} disabled={values.length <= min} onPress={() => set(values.filter((_, j) => j !== i))} />
        </View>
      ))}
      {values.length < max && <AppButton variant="ghost" icon="add" title={kind === "option" ? t("Add an option") : t("Add something that matters")} onPress={() => set([...values, ""])} style={{ alignSelf: "flex-start", marginLeft: -18 }} />}
    </View>
  );

  if (!editing) {
    const line = understoodLine(options, factors);
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.md, rowGap: spacing.xs }}>
        <Text accessibilityLabel={t("What ORION understood: {line}", { line })} style={{ flexShrink: 1, fontSize: type.supporting, lineHeight: 21, color: colors.body }}>
          <Text style={{ color: colors.muted }}>{suggested ? t("You did not name options, so ORION suggested some: ") : t("ORION understood: ")}</Text>
          {line}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Edit the options and what matters")} disabled={disabled} onPress={() => setEditing(true)}>
          <Text style={{ fontSize: type.supporting, color: colors.accentBright, textDecorationLine: "underline" }}>{t("Not right? Edit")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Card style={{ gap: spacing.lg, borderColor: colors.accentLine }}>
      <View style={{ gap: spacing.xs }}>
        <SectionTitle>{guessed ? t("What are you choosing between?") : t("Correct what ORION understood")}</SectionTitle>
        <Small>
          {guessed
            ? t("Your question did not name the options, so ORION could not tell what to compare. Type them here; two is enough. A rough idea is fine.")
            : t("Change, add or remove anything ORION got wrong, then run the comparison again.")}
        </Small>
      </View>
      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: type.supporting, fontWeight: "500", color: colors.ink }}>{t("Options (2 to {max})", { max: MAX_OPTIONS })}</Text>
        {list(optionDraft, setOptionDraft, MAX_OPTIONS, 2, (i) => [t("e.g. Stay in my job"), t("e.g. Look for a new one"), t("Another option"), t("Another option")][i], "option")}
      </View>
      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: type.supporting, fontWeight: "500", color: colors.ink }}>{t("What matters when you choose")}</Text>
        {list(factorDraft, setFactorDraft, MAX_FACTORS, 1, () => t("e.g. Cost, Time, Stress"), "factor")}
      </View>
      {error && <Notice tone="danger" alert>{error}</Notice>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        <AppButton title={busy ? t("Comparing…") : t("Compare these")} iconRight="arrow-forward" disabled={busy} onPress={() => void apply()} />
        {!guessed && <AppButton variant="ghost" title={t("Cancel")} disabled={busy} onPress={() => { setEditing(false); setError(null); setOptionDraft(options); setFactorDraft(factors.map((f) => f.label)); }} />}
      </View>
    </Card>
  );
}
