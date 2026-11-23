// Plain-language pages: one heading, short sections, a way back.
import type { ReactNode } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { AppButton, Body, Card, PageHeader, Screen, SectionTitle, Small } from "./ui";
import { layout, spacing } from "../theme/tokens";
import { t } from "../i18n";

export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: [string, ReactNode][] }) {
  const router = useRouter();
  return (
    <Screen title={title}>
      <View style={{ width: "100%", maxWidth: layout.column + 80, alignSelf: "center", gap: spacing.lg }}>
        <AppButton variant="ghost" icon="arrow-back" title={t("Back")} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={{ alignSelf: "flex-start", marginLeft: -18 }} />
        <PageHeader eyebrow={t("Last updated {date}", { date: updated })} title={title}><Small>{intro}</Small></PageHeader>
        <Card style={{ gap: spacing.lg }}>
          {sections.map(([heading, text]) => (
            <View key={heading} style={{ gap: spacing.xs }}>
              <SectionTitle>{heading}</SectionTitle>
              <Body style={{ fontSize: 15, lineHeight: 24 }}>{text}</Body>
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}
