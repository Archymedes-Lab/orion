// English / 한국어. Each language is named in itself, so someone who reads only one of them can still find it.
import { Pressable, View } from "react-native";
import { LOCALES, setLocale, t } from "../i18n";
import { useLocale } from "../i18n/useLocale";
import { colors, radius } from "../theme/tokens";
import { Text } from "./ui";

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t("Language")} style={{ flexDirection: "row", gap: 4, padding: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, alignSelf: "flex-start" }}>
      {LOCALES.map((l) => {
        const on = l.id === locale;
        return (
          <Pressable
            key={l.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLanguage={l.id}
            onPress={() => setLocale(l.id)}
            style={{ paddingHorizontal: compact ? 10 : 14, paddingVertical: compact ? 4 : 6, borderRadius: radius.pill, backgroundColor: on ? colors.accent : "transparent" }}
          >
            <Text style={{ fontSize: compact ? 12 : 14, color: colors.white }}>{l.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
