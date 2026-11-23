import { Tabs } from "expo-router";
import { Gate } from "../../components/Gate";
import { NavBar } from "../../components/NavBar";
import { useLayout } from "../../components/ui";
import { colors } from "../../theme/tokens";
import { t } from "../../i18n";

export default function TabsLayout() {
  // The root layout's TopNav replaces the tab bar once the window is wide enough.
  const { shell } = useLayout();
  return (
    <Gate>
    <Tabs
      tabBar={(props) => (shell ? null : <NavBar {...props} />)}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: t("Home") }} />
      <Tabs.Screen name="history" options={{ title: t("My decisions") }} />
      <Tabs.Screen name="insights" options={{ title: t("Insights") }} />
      <Tabs.Screen name="you" options={{ title: t("Profile") }} />
    </Tabs>
    </Gate>
  );
}
