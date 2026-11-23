import { useEffect, useState } from "react";
import { Platform, View, type ViewStyle } from "react-native";
import { colors, motion, radius, type } from "../theme/tokens";
import { t } from "../i18n";
import { Text, tabular } from "./ui";

/** Accessible probability bar (never color-only, §50): the value is always printed. */
export function ProbabilityBar({ label, value, display }: { label: string; value: number; display?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  // Mount empty, then grow to the value so bars draw in (web transition; native shows the value).
  const [drawn, setDrawn] = useState(Platform.OS === "web" ? 0 : pct);
  useEffect(() => { const timer = setTimeout(() => setDrawn(pct), 30); return () => clearTimeout(timer); }, [pct]);
  const grow = (Platform.OS === "web" ? { transitionProperty: "width", transitionDuration: `${motion.slow}ms`, transitionTimingFunction: motion.easing } : {}) as ViewStyle;
  const shown = display ?? `${pct}%`;
  return (
    <View accessibilityLabel={display ? `${label}: ${display}` : t("{label}: {pct} percent", { label, pct })} style={{ gap: 7 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <Text style={{ fontSize: type.supporting, fontWeight: "300", color: colors.muted, flexShrink: 1 }}>{label}</Text>
        <Text style={[{ fontSize: type.supporting, fontWeight: "500", color: colors.ink }, tabular]}>{shown}</Text>
      </View>
      <View style={{ height: 5, borderRadius: radius.pill, backgroundColor: colors.sunken, overflow: "hidden" }}>
        <View style={[{ width: `${drawn}%`, height: 5, borderRadius: radius.pill, backgroundColor: colors.accentBright }, grow]} />
      </View>
    </View>
  );
}
