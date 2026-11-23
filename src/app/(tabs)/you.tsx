import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Share, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { apiEnabled, fetchHealth, type ServiceHealth } from "../../ai/client";
import { formatPrice, usePlan } from "../../billing/plan";
import { MobileMoneyPay } from "../../components/MobileMoneyPay";
import { PAID_FEATURES, PLANS } from "../../billing/plans";
import { useAccount } from "../../account/store";
import { useSignOut } from "../../account/signOut";
import { VERSION } from "../../release";
import { eraseAllData, exportData } from "../../db/decisions";
import { archiveFilename, archivePdf, archiveWorkbook } from "../../export/archive";
import { PDF_TYPE, saveBytes, saveFile, XLSX_TYPE } from "../../export/download";
import { stopAllSharing } from "../../share/client";
import { db } from "../../db/database";
import { useSession } from "../../store/session";
import {
  addFact,
  clearAffinities,
  getAffinities,
  getFacts,
  removeFact,
  type ContextFact,
} from "../../db/preferences";
import { ProbabilityBar } from "../../components/ProbabilityBar";
import { BusinessProfileCard } from "../../components/BusinessProfileCard";
import { LanguageSwitch } from "../../components/LanguageSwitch";
import { stageLabel } from "../../components/SiteFooter";
import { getLocale, intlLocale, msg, t } from "../../i18n";
import { AppButton, Card, Chip, ConfirmButton, Field, Icon, IconButton, LabeledField, Notice, PageHeader, Reveal, Screen, SectionTitle, Small, Tag, Text, sentenceCase, useLayout, type Tone } from "../../components/ui";
import { colors, spacing, type } from "../../theme/tokens";

/** Checkout results already acted on, so a re-render never activates twice. */
const handledCheckouts = new Set<string>();

/** What "Export everything" can hand back, and what each one is for. */
const EXPORTS = {
  pdf: {
    title: "PDF",
    icon: "document-text-outline" as const,
    done: msg("PDF downloaded. It reads as a document: a summary, then a chapter for every decision."),
  },
  excel: {
    title: "Excel",
    icon: "grid-outline" as const,
    done: msg("Excel workbook downloaded. One tab per kind of record, each one filtered and ready to sort."),
  },
  json: {
    title: msg("JSON backup"),
    icon: "code-slash-outline" as const,
    done: msg("JSON downloaded. This is the complete copy, and the only one ORION can import back."),
  },
};

/** §16–17: learned affinities + persisted context. Visible, editable, deletable. */
export default function YouScreen() {
  const [facts, setFacts] = useState<ContextFact[]>([]);
  const [affinities, setAffinities] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(0);
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const privateMode = useSession((s) => s.privateMode);
  const plan = usePlan();
  const account = useAccount();
  const signOut = useSignOut();
  const [feedback, setFeedback] = useState("");
  const [kind, setKind] = useState<"idea" | "problem" | "other">("idea");
  const [sent, setSent] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const send = async () => {
    if (feedback.trim().length < 3 || sent === "sending") return;
    setSent("sending");
    const ok = await account.sendFeedback({ message: feedback.trim(), kind, page: "/you" });
    setSent(ok ? "sent" : "failed");
    if (ok) setFeedback("");
  };
  const removeAccount = async () => {
    const result = await account.remove(deletePassword);
    if (!result.ok) { setDeleteError(result.error); return; }
    setDeleting(false);
    setDeletePassword("");
    setMessage({ tone: "success", text: t("Your account and its backup are deleted. What is on this device is untouched; erase it below if you want that gone too.") });
  };
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { checkout } = useLocalSearchParams<{ checkout?: string }>();

  // Stripe sends the person back here with the checkout session in the address.
  useEffect(() => {
    // Only the two values ORION's own return links carry; anything else in the address is ignored.
    if (typeof checkout !== "string" || !(checkout === "cancelled" || checkout.startsWith("cs_")) || handledCheckouts.has(checkout)) return;
    handledCheckouts.add(checkout);
    // Take the session id out of the address so a reload or a shared link does not carry it.
    // Deferred: on a fresh page load the router is not ready to navigate during the first effect.
    setTimeout(() => { try { router.setParams({ checkout: undefined }); } catch { /* the address keeps the parameter; harmless */ } }, 400);
    if (checkout === "cancelled") {
      handledCheckouts.delete(checkout); // cancelling twice should say so twice
      setMessage({ tone: "neutral", text: t("Checkout was cancelled. Nothing was charged.") });
      return;
    }
    void usePlan.getState().activate(checkout).then((ok) => setMessage(ok
      ? { tone: "success", text: t("ORION Pro is active on this device. Thank you.") }
      : { tone: "danger", text: t("The payment could not be confirmed. If you were charged, open the link from Stripe again in a moment.") }));
  }, [checkout, router]);

  const leave = async (target: () => Promise<string | null>, failure: string) => {
    setBusy(true);
    const url = await target();
    if (!url) { setBusy(false); setMessage({ tone: "danger", text: failure }); return; }
    if (Platform.OS === "web" && typeof window !== "undefined") window.location.assign(url);
    else { setBusy(false); void Linking.openURL(url); }
  };
  const { split } = useLayout();
  // Dates and times in the interface language; English keeps the device's own format, as it always has.
  const locale = getLocale() === "en" ? undefined : intlLocale();
  const refresh = useCallback(() => {
    (async () => {
      setFacts(await getFacts().catch(() => []));
      setAffinities(await getAffinities().catch(() => ({})));
      setSaved(await db.init().then(() => db.list("decisions")).then((rows) => rows.length).catch(() => 0));
      if (apiEnabled()) setHealth(await fetchHealth());
    })();
  }, []);
  useFocusEffect(refresh);

  const total = Object.values(affinities).reduce((a, n) => a + n, 0);
  const ranked = Object.entries(affinities).sort((a, b) => b[1] - a[1]);
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void addFact(text).then(refresh).then(() => account.backupSoon());
  };

  const download = async (kind: keyof typeof EXPORTS) => {
    try {
      const data = await exportData();
      const name = archiveFilename(data, kind === "excel" ? "xlsx" : kind);
      if (Platform.OS !== "web") {
        // No file system to download into: the summary goes to the share sheet, as it always has.
        await Share.share({ title: name, message: JSON.stringify(data, null, 2) });
        setMessage({ tone: "success", text: t("Export ready. It holds every decision, outcome and preference saved on this device.") });
        return;
      }
      const ok = kind === "pdf" ? saveBytes(name, archivePdf(data), PDF_TYPE)
        : kind === "excel" ? saveBytes(name, archiveWorkbook(data), XLSX_TYPE)
        : saveFile(name, JSON.stringify(data, null, 2), "application/json");
      setMessage(ok
        ? { tone: "success", text: t(EXPORTS[kind].done) }
        : { tone: "danger", text: t("Your browser blocked the download. Allow downloads for ORION and try again.") });
    } catch { setMessage({ tone: "danger", text: t("Could not export your data.") }); }
  };
  const erase = async () => {
    try {
      // Links friends could still open go first, while this device still holds the keys that remove them.
      await stopAllSharing().catch(() => {});
      await eraseAllData();
      useSession.getState().reset();
      refresh();
      // The backup mirrors the device, so erasing here empties it too.
      account.backupSoon();
      setMessage({ tone: "success", text: account.user ? t("Everything saved on this device, and the backup in your account, has been erased.") : t("Everything saved on this device has been erased.") });
    } catch { setMessage({ tone: "danger", text: t("Could not erase your data. Nothing was removed.") }); }
  };
  // What analyses a decision right now, in words.
  const service: { tone: Tone; label: string; text: string } = !apiEnabled()
    ? { tone: "neutral", label: t("On this device"), text: t("This build has no ORION server set, so your decisions are analysed on this device and never leave it. ORION asks a few quick questions instead of scoring the options for you.") }
    : health === null
      ? { tone: "neutral", label: t("Checking"), text: t("Checking the ORION server…") }
      : !health.online
        ? { tone: "warning", label: t("Server unreachable"), text: t("The ORION server is not answering, so decisions are analysed on this device for now. Nothing is lost; scoring returns when the server does.") }
        : health.aiConfigured
          ? { tone: "success", label: t("Online"), text: health.jev
            ? t("Connected. ORION's scoring model scores each option for you, and your decision text is sent to the server to do it.")
            : t("Connected. An AI provider scores each option for you, and your decision text is sent to the server to do it.") }
          : { tone: "warning", label: t("No scoring provider"), text: t("The server is reachable but has no scoring key, so ORION asks a few quick questions instead of scoring the options for you.") };

  return (
    <Screen title={t("Profile")}>
      <PageHeader title={t("Profile")}>
        <Small>{t("Everything here is stored on your device, visible, editable and deletable.")}</Small>
      </PageHeader>
      {message && <Notice tone={message.tone} alert={message.tone === "danger"}>{message.text}</Notice>}
      {account.enabled && account.ready && (
        <Reveal>
        <Card>
          {account.user ? (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
                <View style={{ gap: 2, flexShrink: 1 }}>
                  <SectionTitle>{account.user.username || t("Your account")}</SectionTitle>
                  <Text selectable style={{ fontSize: type.body, color: colors.body }}>{account.user.email}</Text>
                </View>
                <AppButton variant="secondary" icon="log-out-outline" title={t("Sign out")} onPress={() => void signOut()} />
              </View>
              <Small>
                {account.backupError
                  ? t(account.backupError)
                  : account.lastBackupAt
                    ? t("Backed up to your account at {time}. Sign in on another browser and your decisions come with you.", { time: new Date(account.lastBackupAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })
                    : t("Your decisions are backed up to your account after each change.")}
              </Small>
              <Small>{t("Signing out leaves your decisions on this device. Forgot your password? Sign out and use “Forgot your password?” with your recovery code.")}</Small>
              {!deleting ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginLeft: -18 }}>
                  <AppButton variant="ghost" icon="cloud-upload-outline" title={t("Back up now")} onPress={() => void account.backupNow()} />
                  <AppButton variant="ghost" icon="trash-outline" title={t("Delete account")} onPress={() => { setDeleting(true); setDeleteError(null); }} />
                </View>
              ) : (
                <View style={{ gap: spacing.sm, maxWidth: 460 }}>
                  <LabeledField
                    label={t("Enter your password to delete your account")}
                    hint={t("This removes your email, password and backup from ORION for good. It cannot be undone.")}
                    error={deleteError}
                    value={deletePassword}
                    onChangeText={setDeletePassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="current-password"
                    onSubmitEditing={() => void removeAccount()}
                  />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                    <AppButton variant="danger" icon="alert-circle-outline" title={t("Delete my account")} disabled={!deletePassword} onPress={() => void removeAccount()} />
                    <AppButton variant="ghost" title={t("Cancel")} onPress={() => { setDeleting(false); setDeletePassword(""); }} />
                  </View>
                </View>
              )}
            </>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
              <View style={{ gap: spacing.xs, flexGrow: 1, flexShrink: 1, flexBasis: 320 }}>
                <SectionTitle>{t("You are using ORION without an account")}</SectionTitle>
                <Small>{t("That works: everything stays on this device. A free account backs your decisions up and brings them to any browser you sign in on.")}</Small>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                <AppButton title={t("Create account")} iconRight="arrow-forward" onPress={() => router.navigate("/account?mode=signup")} />
                <AppButton variant="secondary" title={t("Sign in")} onPress={() => router.navigate("/account")} />
              </View>
            </View>
          )}
        </Card>
        </Reveal>
      )}
      <View style={split ? { flexDirection: "row", alignItems: "flex-start", gap: 28 } : { gap: spacing.lg }}>
        <Reveal index={1} style={split ? { flex: 1 } : undefined}>
        <Card>
          <View style={{ gap: spacing.xs }}>
            <SectionTitle>{t("What matters to you")}</SectionTitle>
            <Small>
              {t("Learned from your own “X matters most” answers — no personality quiz, no invisible profiling.")}
            </Small>
          </View>
          {ranked.length === 0 && (
            <Small style={{ color: colors.faint }}>
              {t("Nothing yet. Answer a question on the Home tab and it will show up here.")}
            </Small>
          )}
          {ranked.map(([label, n]) => (
            <ProbabilityBar key={label} label={sentenceCase(label)} value={total > 0 ? n / total : 0} display={`${n}×`} />
          ))}
          {ranked.length > 0 && (
            <View style={{ alignSelf: "flex-start", marginLeft: -18 }}>
              <ConfirmButton icon="refresh" title={t("Forget what ORION learned")} confirmTitle={t("Forget these preferences?")} onConfirm={() => void clearAffinities().then(refresh).then(() => account.backupSoon())} />
            </View>
          )}
        </Card>
        </Reveal>
        <Reveal index={2} style={split ? { flex: 1 } : undefined}>
        <Card>
          <View style={{ gap: spacing.xs }}>
            <SectionTitle>{t("Personal context")}</SectionTitle>
            <Small>{apiEnabled() ? t("These lines are sent with each question, so the options are scored for your situation.") : t("These lines are used when ORION scores options for you; that needs an ORION server.")}</Small>
          </View>
          {facts.length === 0 && <Small style={{ color: colors.faint }}>{t("Nothing saved. Add a line ORION should remember, like how you like to travel.")}</Small>}
          {facts.map((f) => (
            <View key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderColor: colors.line }}>
              <Text style={{ flex: 1, fontSize: type.body, lineHeight: 24, fontWeight: "300", color: colors.body }}>{f.text}</Text>
              <IconButton icon="trash-outline" size={44} accessibilityLabel={t("Delete: {text}", { text: f.text })} onPress={() => { void removeFact(f.id).then(refresh).then(() => account.backupSoon()); }} />
            </View>
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            <Field
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={add}
              accessibilityLabel={t("Add personal context")}
              placeholder={t("Add context, e.g. I prefer walking when I have time.")}
              style={{ flexGrow: 1, flexBasis: 240 }}
            />
            <AppButton title={t("Add")} icon="add" onPress={add} disabled={!draft.trim()} />
          </View>
        </Card>
        </Reveal>
      </View>
      <Reveal index={3}><BusinessProfileCard /></Reveal>
      <View style={split ? { flexDirection: "row", alignItems: "flex-start", gap: 28 } : { gap: spacing.lg }}>
        <Reveal index={3} style={split ? { flex: 1 } : undefined}>
        <View style={{ gap: spacing.lg }}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
            <SectionTitle>{t("How ORION is running")}</SectionTitle>
            <Tag label={service.label} tone={service.tone} />
          </View>
          <Small>{service.text}</Small>
          <Small>{privateMode ? t("Private mode is on: new decisions are not saved to History.") : t("Private mode is off: decisions you commit are saved to History on this device.")}</Small>
          <AppButton variant="secondary" icon={privateMode ? "lock-open-outline" : "lock-closed-outline"} title={privateMode ? t("Turn private mode off") : t("Turn private mode on")} onPress={useSession.getState().togglePrivate} style={{ alignSelf: "flex-start" }} />
        </Card>
        <Card>
          <SectionTitle>{t("Language")}</SectionTitle>
          <Small>{t("ORION speaks English and Korean. Decisions you already saved stay in the language they were made in.")}</Small>
          <LanguageSwitch />
        </Card>
        </View>
        </Reveal>
        <Reveal index={4} style={split ? { flex: 1 } : undefined}>
        <View style={{ gap: spacing.lg }}>
        {!plan.enabled && plan.ready && (
          <Card>
            <SectionTitle>{t("Your plan")}</SectionTitle>
            <Small>
              {t("Payments are not set up on this copy of ORION, so there is nothing to buy and nothing is locked: every feature is open to you. If you were expecting a paid plan here, the server has no payment configuration (Stripe or mobile money).")}
            </Small>
          </Card>
        )}
        {plan.enabled && (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
              <SectionTitle>{t("Your plan")}</SectionTitle>
              <Tag label={plan.pro ? "ORION Pro" : t("Free")} tone={plan.pro ? "success" : "neutral"} />
            </View>
            <Small>
              {plan.pro && plan.until
                ? t("Every paid feature is open on every decision until {date}. You paid with mobile money, so nothing renews by itself.", { date: new Date(plan.until).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) })
                : plan.pro
                ? t("Every paid feature is open on every decision. Billing is handled by Stripe; you can change your card or cancel there at any time.")
                : t("Free is a whole decision, not a trial: the recommendation, why it fits what you said matters, what it costs you, your next step, and your history. Pro is for when you want to see the working.")}
            </Small>
            {!plan.pro && (
              <View style={{ gap: 6 }}>
                {Object.values(PAID_FEATURES).map((feature) => (
                  <View key={feature.name} style={{ flexDirection: "row", gap: 10 }}>
                    <Icon name="checkmark" size={15} color={colors.accentBright} style={{ marginTop: 3 }} />
                    <Small style={{ flex: 1 }}><Text style={{ color: colors.ink, fontWeight: "500" }}>{t(feature.name)}. </Text>{t(feature.what)}</Small>
                  </View>
                ))}
              </View>
            )}
            {plan.pro && plan.until
              ? null
              : plan.pro
              ? <AppButton variant="secondary" icon="card-outline" title={busy ? t("Opening Stripe…") : t("Manage subscription")} disabled={busy} onPress={() => void leave(plan.portalUrl, t("Could not open the billing page. Try again in a moment."))} style={{ alignSelf: "flex-start" }} />
              : (
                <View style={{ gap: spacing.sm }}>
                  {(["yearly", "monthly"] as const).filter((id) => plan.prices[id]).map((id) => (
                    <View key={id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md }}>
                      <AppButton
                        variant={PLANS[id].recommended ? "primary" : "secondary"}
                        iconRight="arrow-forward"
                        title={busy ? t("Opening checkout…") : id === "yearly" ? t("Yearly: {price}", { price: formatPrice(plan.prices[id]!) }) : t("Monthly: {price}", { price: formatPrice(plan.prices[id]!) })}
                        disabled={busy}
                        onPress={() => void leave(() => plan.checkoutUrl(id), t("Could not start checkout. Try again in a moment."))}
                      />
                      {PLANS[id].recommended && <Tag label={t("Best value")} tone="info" />}
                    </View>
                  ))}
                  {plan.prices.pass && <Small>{t("Or unlock a single decision for {price}, once, from that decision's analysis page.", { price: formatPrice(plan.prices.pass) })}</Small>}
                  {plan.mobileMoney && <MobileMoneyPay plans={["monthly", "yearly"]} />}
                </View>
              )}
            {plan.passes.length > 0 && !plan.pro && <Small>{plan.passes.length === 1 ? t("You have a pass for 1 decision.") : t("You have a pass for {n} decisions.", { n: plan.passes.length })}</Small>}
            {!plan.pro && !account.user && <Small>{t("Without an account a purchase stays on this device. Create an account first and it follows you.")}</Small>}
          </Card>
        )}
        <Card>
          <SectionTitle>{t("Your data")}</SectionTitle>
          <Small>{getLocale() === "en"
            ? `${saved} saved ${saved === 1 ? "decision" : "decisions"}, ${facts.length} context ${facts.length === 1 ? "line" : "lines"}, ${ranked.length} learned ${ranked.length === 1 ? "preference" : "preferences"}. There is no account and no copy on a server.`
            : t("Saved decisions: {decisions}, context lines: {lines}, learned preferences: {preferences}. There is no account and no copy on a server.", { decisions: saved, lines: facts.length, preferences: ranked.length })}</Small>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
            {Platform.OS === "web" ? (
              (Object.keys(EXPORTS) as (keyof typeof EXPORTS)[]).map((kind) => (
                <AppButton
                  key={kind}
                  variant={kind === "json" ? "ghost" : "secondary"}
                  icon={EXPORTS[kind].icon}
                  title={t(EXPORTS[kind].title)}
                  onPress={() => void download(kind)}
                />
              ))
            ) : (
              <AppButton variant="secondary" icon="download-outline" title={t("Export everything")} onPress={() => void download("json")} />
            )}
            <ConfirmButton title={t("Erase everything")} confirmTitle={t("Erase all data on this device?")} onConfirm={() => void erase()} />
          </View>
          {Platform.OS === "web" && <Small>{t("Export everything you have saved: a PDF to read or keep, a workbook to sort, or the JSON backup ORION can import back.")}</Small>}
        </Card>
        </View>
        </Reveal>
      </View>
      {apiEnabled() && (
        <Card>
          <View style={{ gap: spacing.xs }}>
            <SectionTitle>{t("Send feedback")}</SectionTitle>
            <Small>{t("ORION is in beta. Tell us what confused you, what broke, or what you wish it did.")} {account.user ? t("It is sent with your account so we can follow up.") : t("It is sent without your name.")}</Small>
          </View>
          <View accessibilityRole="radiogroup" accessibilityLabel={t("Kind of feedback")} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {([["idea", t("An idea")], ["problem", t("Something is wrong")], ["other", t("Something else")]] as const).map(([value, label]) => (
              <Chip key={value} label={label} selected={kind === value} onPress={() => setKind(value)} />
            ))}
          </View>
          <Field
            value={feedback}
            onChangeText={(text) => { setFeedback(text); if (sent !== "sending") setSent("idle"); }}
            placeholder={t("What happened, or what would make ORION better?")}
            accessibilityLabel={t("Your feedback")}
            multiline
            maxLength={2000}
            style={{ minHeight: 96, textAlignVertical: "top" }}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md }}>
            <AppButton variant="secondary" icon="send-outline" title={sent === "sending" ? t("Sending…") : t("Send feedback")} disabled={feedback.trim().length < 3 || sent === "sending"} onPress={() => void send()} />
            {sent === "sent" && <Small style={{ color: colors.success }}>{t("Thank you. It has been sent.")}</Small>}
            {sent === "failed" && <Small style={{ color: colors.danger }}>{t("That did not go through. Try again in a moment.")}</Small>}
          </View>
        </Card>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md }}>
        <Small>{t("ORION {version} · {stage}: unfinished software, so things may change or break.", { version: VERSION, stage: stageLabel() })}</Small>
        <AppButton variant="ghost" title={t("Beta terms")} onPress={() => router.navigate("/terms")} style={{ minHeight: 32, paddingHorizontal: 10 }} />
        <AppButton variant="ghost" title={t("Privacy")} onPress={() => router.navigate("/privacy")} style={{ minHeight: 32, paddingHorizontal: 10 }} />
      </View>
      <AppButton variant="ghost" icon="color-palette-outline" title={t("Design system")} onPress={() => router.navigate("/design")} style={{ alignSelf: "flex-start" }} />
    </Screen>
  );
}
