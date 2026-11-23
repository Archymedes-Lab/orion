// One factor, one tap: which option comes out ahead? JEV does the rest.
import { useEffect } from "react";
import { Platform, Pressable, View, type ViewStyle } from "react-native";
import { colors, elevation, radius, spacing } from "../theme/tokens";
import { t } from "../i18n";
import { AppButton, Card, Eyebrow, Reveal, Text, blur, ease, sink } from "./ui";

export function DuelCard({
  factor,
  options,
  step,
  total,
  onPick,
  onUndo,
}: {
  factor: string;
  options: { id: string; label: string }[];
  /** 1-based position among the questions JEV may still ask. */
  step: number;
  total: number;
  onPick: (optionId: string | null) => void;
  onUndo?: () => void;
}) {
  // Keyboard: 1–4 pick an option, 0 is "about equal", Backspace takes back the last tap.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      const n = Number(e.key);
      if (e.key === "0") onPick(null);
      else if (Number.isInteger(n) && n >= 1 && n <= options.length) onPick(options[n - 1].id);
      else if (e.key === "Backspace" && onUndo) onUndo();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [options, onPick, onUndo]);

  // The factor is highlighted inside the sentence, wherever the language puts it.
  const [before, after = ""] = t("Which comes out ahead on {factor}?").split("{factor}");
  return (
    <Reveal>
    <Card style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
        <Eyebrow>{t("Question {n} of {total}", { n: step, total })}</Eyebrow>
        <View accessibilityLabel={t("Question {n} of {total}", { n: step, total })} style={{ flexDirection: "row", gap: 6 }}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={{ width: i + 1 === step ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i + 1 <= step ? colors.accent : colors.frost }} />
          ))}
        </View>
      </View>
      <Text accessibilityRole="header" style={{ fontSize: 28, lineHeight: 36, fontWeight: "300", color: colors.white }}>
        {before}<Text style={{ fontWeight: "500", color: colors.accentBright }}>{factor.toLowerCase()}</Text>{after}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        {options.map((o, i) => (
          <Pressable
            key={o.id}
            onPress={() => onPick(o.id)}
            accessibilityRole="button"
            accessibilityLabel={t("{option} comes out ahead on {factor}", { option: o.label, factor })}
            style={(state) => {
              const hot = state.pressed || (state as { hovered?: boolean }).hovered;
              return [
                {
                  flexGrow: 1, flexBasis: 200, minHeight: 84, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1,
                  alignItems: "center", justifyContent: "center", gap: 4,
                  backgroundColor: hot ? colors.accentSoft : colors.frost, borderColor: hot ? colors.accentLine : colors.lineStrong,
                  ...(Platform.OS === "web" ? { boxShadow: hot ? elevation.glow : "none" } : {}),
                } as ViewStyle,
                blur,
                ease,
                sink(state.pressed),
              ];
            }}
          >
            <Text style={{ fontSize: 19, lineHeight: 26, fontWeight: "400", textAlign: "center", color: colors.white }}>{o.label}</Text>
            {Platform.OS === "web" && <Text style={{ fontSize: 11, letterSpacing: 1.6, color: colors.muted }}>{t("Press {n}", { n: i + 1 })}</Text>}
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
        <AppButton variant="secondary" title={t("About equal")} onPress={() => onPick(null)} />
        {onUndo && <AppButton variant="ghost" icon="arrow-undo" title={t("Back")} onPress={onUndo} />}
      </View>
    </Card>
    </Reveal>
  );
}
