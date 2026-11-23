import { useRouter } from "expo-router";
import { AppButton, EmptyState, Screen } from "../components/ui";
import { t } from "../i18n";

/** Any address that is not a screen. */
export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <Screen title={t("Page not found")}>
      <EmptyState icon="compass-outline" title={t("This page does not exist")} action={<AppButton title={t("Go to Home")} iconRight="arrow-forward" onPress={() => router.replace("/")} />}>
        {t("The address may be mistyped, or the link is out of date.")}
      </EmptyState>
    </Screen>
  );
}
