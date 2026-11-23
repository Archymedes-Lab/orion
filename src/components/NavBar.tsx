import type { ComponentProps } from "react";
import { Pressable, View } from "react-native";
import type { Tabs } from "expo-router";
import { colors } from "../theme/tokens";
import { Icon, Text, ease, type IconName } from "./ui";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];
const ICONS: Record<string, [IconName, IconName]> = {
  index: ["home", "home-outline"],
  history: ["time", "time-outline"],
  insights: ["stats-chart", "stats-chart-outline"],
  you: ["person", "person-outline"],
};

/** Phone tab bar. Wider windows use the TopNav instead. */
export function NavBar({ state, descriptors, navigation, insets }: TabBarProps) {
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: "row", backgroundColor: "#0E141D", borderTopWidth: 1, borderColor: colors.line, paddingBottom: insets.bottom }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const [filled, outline] = ICONS[route.name] ?? ["ellipse", "ellipse-outline"];
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            }}
            style={{ flex: 1, alignItems: "center", gap: 4, paddingTop: 12, paddingBottom: 8 }}
          >
            <Icon name={focused ? filled : outline} size={21} color={focused ? colors.white : colors.muted} />
            <Text style={{ fontSize: 11, fontWeight: focused ? "500" : "300", color: focused ? colors.white : colors.muted }}>
              {descriptors[route.key].options.title ?? route.name}
            </Text>
            <View style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: focused ? colors.accent : "transparent" }, ease]} />
          </Pressable>
        );
      })}
    </View>
  );
}
