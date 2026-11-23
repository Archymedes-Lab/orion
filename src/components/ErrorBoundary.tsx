import { router } from "expo-router";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { t } from "../i18n";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A render crash inside a decision screen otherwise produces a blank screen
 * with no explanation, which for a tool that makes decisions under uncertainty is
 * the worst possible failure. This shows what broke and offers a way out, and
 * never silently discards a saved decision.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console rather than a reporting service: ORION has no
    // telemetry, and a user's decision text must not leave the device.
    console.error("ORION render error", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <ScrollView style={{ flex: 1, backgroundColor: "#0B0B0F", padding: 24 }}>
        <Text style={{ color: "#F9FAFB", fontSize: 20, fontWeight: "700", marginBottom: 12 }}>
          {t("Something broke")}
        </Text>
        <Text style={{ color: "#D1D5DB", marginBottom: 12 }}>
          {t("This screen hit an error. Your saved decisions are untouched.")}
        </Text>
        <Text style={{ color: "#9CA3AF", marginBottom: 20 }}>{error.message}</Text>
        <View style={{ gap: 10 }}>
          <Pressable accessibilityRole="button" onPress={this.reset}>
            <Text style={{ color: "#60A5FA" }}>{t("Try again")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.replace("/")}>
            <Text style={{ color: "#60A5FA" }}>{t("Back to decisions")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }
}