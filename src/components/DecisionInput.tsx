import { useEffect, useRef, useState } from "react";
import { Platform, TextInput, View } from "react-native";
import { t } from "../i18n";
import { colors, spacing } from "../theme/tokens";
import { AppButton, blur, ease, focusRing, noOutline, sans, useLayout } from "./ui";

/**
 * Stage 1 — Capture (§3). One frosted bar; opening ORION is starting a decision.
 *
 * The action is named rather than drawn as a bare arrow: a first-time visitor should not have to work out
 * what the chevron does. On a phone the button moves below the field, where it is full width and easy to hit.
 */
export function DecisionInput({
  onSubmit,
  initial = "",
  placeholder,
}: {
  onSubmit: (text: string) => void;
  initial?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(initial);
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  const { shell } = useLayout();
  // "/" jumps to the input from anywhere on the page, as on most web apps.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const submit = () => text.trim() && onSubmit(text.trim());
  const action = (
    <AppButton
      title={t("Help me decide")}
      iconRight="arrow-forward"
      onPress={submit}
      disabled={!text.trim()}
      accessibilityLabel={t("Help me decide")}
    />
  );
  return (
    <View style={{ gap: spacing.sm }}>
      <View
        style={[
          {
            flexDirection: "row", alignItems: "center", gap: 12, minHeight: 68, paddingLeft: 28, paddingRight: 12, borderRadius: 28,
            backgroundColor: colors.frost, borderWidth: 1, borderColor: focused ? colors.accentLine : colors.lineStrong,
          },
          blur,
          ease,
          focused && focusRing,
        ]}
      >
        <TextInput
          ref={input}
          autoFocus={initial !== ""}
          value={text}
          onChangeText={setText}
          placeholder={placeholder ?? t("Should I accept this job offer or keep looking?")}
          placeholderTextColor={colors.muted}
          maxLength={4000}
          accessibilityLabel={t("Describe your decision")}
          style={[{ flex: 1, minHeight: 44, fontFamily: sans, fontSize: 18, fontWeight: "300", color: colors.white }, noOutline]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        {shell && action}
      </View>
      {!shell && action}
    </View>
  );
}
