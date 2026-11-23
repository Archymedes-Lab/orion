// Where a paid feature would be: what it is, and the ways to get it. Shown only when billing is set up.
import { useState } from "react";
import { Linking, Platform, View } from "react-native";
import { PAID_FEATURES, PLANS, type PaidFeature, type PlanId } from "../billing/plans";
import { formatPrice, usePlan } from "../billing/plan";
import { colors, spacing } from "../theme/tokens";
import { AppButton, Card, Eyebrow, Icon, Notice, SectionTitle, Small } from "./ui";
import { MobileMoneyPay } from "./MobileMoneyPay";
import { t } from "../i18n";

/** Opens a Stripe page. Returns false when it could not be created. */
export async function goToStripe(url: Promise<string | null>): Promise<boolean> {
  const target = await url;
  if (!target) return false;
  if (Platform.OS === "web" && typeof window !== "undefined") window.location.assign(target);
  else void Linking.openURL(target);
  return true;
}

export function Paywall({ feature, decisionId }: { feature: PaidFeature; decisionId?: string | null }) {
  const plan = usePlan();
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [failed, setFailed] = useState(false);
  const info = PAID_FEATURES[feature];
  const buy = async (id: PlanId) => {
    setBusy(id);
    setFailed(false);
    if (!await goToStripe(plan.checkoutUrl(id, decisionId))) { setFailed(true); setBusy(null); }
  };
  const priced = (id: PlanId) => (plan.prices[id] ? formatPrice(plan.prices[id]!) : null);
  const passOffered = info.inPass && !!decisionId && !!plan.prices.pass;
  const pro: PlanId | null = plan.prices.yearly ? "yearly" : plan.prices.monthly ? "monthly" : null;

  return (
    <Card style={{ borderColor: colors.accentLine }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name="lock-closed-outline" size={15} color={colors.accentBright} />
        <Eyebrow color={colors.accentBright}>{t("Part of ORION Pro")}</Eyebrow>
      </View>
      <View style={{ gap: spacing.xs }}>
        <SectionTitle>{t(info.name)}</SectionTitle>
        <Small>{t(info.what)}</Small>
      </View>
      {failed && <Notice tone="danger" alert>{t("Could not start checkout. Try again in a moment.")}</Notice>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {pro && <AppButton title={busy === pro ? t("Opening checkout…") : priced(pro) ? `ORION Pro: ${priced(pro)}` : "ORION Pro"} iconRight="arrow-forward" disabled={busy !== null} onPress={() => void buy(pro)} />}
        {passOffered && <AppButton variant="secondary" title={busy === "pass" ? t("Opening checkout…") : priced("pass") ? t("Just this decision: {price}", { price: priced("pass")! }) : t("Just this decision")} disabled={busy !== null} onPress={() => void buy("pass")} />}
      </View>
      {plan.mobileMoney && <MobileMoneyPay plans={info.inPass ? ["monthly", "yearly", "pass"] : ["monthly", "yearly"]} decisionId={decisionId} />}
      <Small>{passOffered ? `${t(PLANS.pass.blurb)} ${t("Your answer, ranking and history stay free either way.")}` : t("Your answer, ranking and history stay free either way.")}</Small>
    </Card>
  );
}
