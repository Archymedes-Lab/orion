// Pay by phone: MTN MoMo or Airtel Money in Rwanda, through Paypack (server/paypack.ts). ORION sends a
// payment prompt to the number; the person approves it on their phone with their PIN; ORION checks until
// Paypack reports the result. Mobile money is prepaid: a month or a year, and it does not renew by itself.
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { PlanId } from "../billing/plans";
import { formatPrice, usePlan } from "../billing/plan";
import { colors, spacing } from "../theme/tokens";
import { AppButton, Chip, Eyebrow, Icon, LabeledField, Notice, Small } from "./ui";
import { msg, t } from "../i18n";

const LABEL: Record<PlanId, string> = { monthly: msg("1 month of Pro"), yearly: msg("1 year of Pro"), pass: msg("This decision only") };
const POLL_MS = 4_000;
/** About three minutes: long enough to find the phone and type a PIN. */
const POLLS = 45;

type Phase = "idle" | "sending" | "waiting" | "paid" | "failed" | "slow";

export function MobileMoneyPay({ plans, decisionId, onPaid }: { plans: PlanId[]; decisionId?: string | null; onPaid?: () => void }) {
  const prices = usePlan((p) => p.mobileMoney);
  const start = usePlan((p) => p.startMobileMoney);
  const check = usePlan((p) => p.checkMobileMoney);
  const offered = plans.filter((id) => prices?.[id] && (id !== "pass" || !!decisionId));
  const [plan, setPlan] = useState<PlanId | null>(offered[0] ?? null);
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!prices || offered.length === 0 || !plan) return null;

  const poll = (left: number) => {
    timer.current = setTimeout(async () => {
      if (!ticket.current) return;
      const result = await check(ticket.current);
      if (result === "paid") { setPhase("paid"); onPaid?.(); return; }
      if (result === "failed") { setPhase("failed"); return; }
      if (left <= 1) { setPhase("slow"); return; }
      poll(left - 1);
    }, POLL_MS);
  };
  const pay = async () => {
    setError(null);
    setPhase("sending");
    const started = await start(plan, phone, decisionId);
    if ("error" in started) { setError(started.error); setPhase("idle"); return; }
    ticket.current = started.ticket;
    setPhase("waiting");
    poll(POLLS);
  };
  const again = () => { if (ticket.current) { setPhase("waiting"); poll(POLLS); } };
  const busy = phase === "sending" || phase === "waiting";

  if (phase === "paid") {
    return <Notice tone="success">{plan === "pass" ? t("Paid. This decision's full analysis is open for good.") : plan === "yearly" ? t("Paid. ORION Pro is open for a year. Thank you.") : t("Paid. ORION Pro is open for 30 days. Thank you.")}</Notice>;
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name="phone-portrait-outline" size={15} color={colors.accentBright} />
        <Eyebrow color={colors.accentBright}>{t("Pay with mobile money")}</Eyebrow>
      </View>
      {offered.length > 1 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {offered.map((id) => (
            <Chip key={id} selected={plan === id} label={t("{plan}: {price}", { plan: t(LABEL[id]), price: formatPrice({ ...prices[id]!, interval: null }) })} onPress={() => { if (!busy) setPlan(id); }} />
          ))}
        </View>
      )}
      <LabeledField
        label={t("MTN or Airtel number")}
        placeholder="078 123 4567"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
        editable={!busy}
        error={error}
        hint={t("You will get a prompt on this phone. Approve it with your mobile money PIN.")}
      />
      <AppButton
        title={phase === "sending" ? t("Sending the prompt…") : phase === "waiting" ? t("Waiting for you to approve…") : t("Pay {price}", { price: formatPrice({ ...prices[plan]!, interval: null }) })}
        icon="phone-portrait-outline"
        disabled={busy || phone.trim().length < 9}
        onPress={() => void pay()}
        style={{ alignSelf: "flex-start" }}
      />
      {phase === "waiting" && <Small>{t("Check your phone now. If no prompt appears within a minute, check the number and try again.")}</Small>}
      {phase === "failed" && <Notice tone="warning">{t("The payment was declined or cancelled, so nothing was charged. You can try again.")}</Notice>}
      {phase === "slow" && (
        <View style={{ gap: spacing.sm }}>
          <Notice tone="info">{t("No answer from mobile money yet. If you approved the payment, ORION will pick it up, even if you close this page.")}</Notice>
          <AppButton variant="secondary" title={t("Check again")} onPress={again} style={{ alignSelf: "flex-start" }} />
        </View>
      )}
      <Small>{plan === "pass" ? t("One payment for this decision. Nothing renews.") : t("Prepaid: it does not renew by itself. Pay again when it ends if you want to keep Pro.")}</Small>
    </View>
  );
}
