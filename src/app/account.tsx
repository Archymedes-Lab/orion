// The welcome page: sign in, create an account, or reset a password with the recovery code, beside a live demo of
// how ORION works. One screen, three modes, so a person who picked the wrong one switches without losing what they
// typed. First-time visitors land here (src/account/gate.ts); "continue without an account" is always offered.
import { useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAccount } from "../account/store";
import { useGate } from "../account/gate";
import { HowItWorksDemo } from "../components/HowItWorksDemo";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { msg, t } from "../i18n";
import { AppButton, Body, Card, CheckRow, Eyebrow, Icon, LabeledField, Notice, PageHeader, Reveal, Screen, SectionTitle, Small, Text, Wordmark, blur, tabular, useLayout } from "../components/ui";
import { colors, layout, radius, spacing, type } from "../theme/tokens";

type Mode = "signin" | "signup" | "recover";
const TITLES: Record<Mode, [string, string]> = {
  signin: [msg("Welcome back"), msg("Sign in to pick up your decisions on any device.")],
  signup: [msg("Create your account"), msg("Free during the beta. It takes a minute.")],
  recover: [msg("Reset your password"), msg("Use the recovery code you saved when you created your account.")],
};
const BENEFITS: [React.ComponentProps<typeof Icon>["name"], string][] = [
  ["cloud-done-outline", msg("Your decisions are backed up to your account and come with you to another browser.")],
  ["card-outline", msg("A subscription belongs to your account, not to one device.")],
  ["chatbubbles-outline", msg("Your feedback reaches us with a way to follow up.")],
];
const USERNAME_RULE = msg("3–24 characters: letters, numbers, dots, dashes or underscores.");
const link = { fontSize: type.supporting, fontWeight: "400" as const, color: colors.accentBright, textDecorationLine: "underline" as const };

export default function AccountScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const account = useAccount();
  const gate = useGate();
  const { shell } = useLayout();
  const asGuest = () => { gate.continueAsGuest(); router.replace("/"); };
  const [mode, setMode] = useState<Mode>(params.mode === "signup" ? "signup" : params.mode === "recover" ? "recover" : "signin");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [invite, setInvite] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ username?: string; email?: string; password?: string; code?: string; terms?: string }>({});
  // The recovery code is shown exactly once, after signup or a reset.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Already signed in and nothing to show: this page has no purpose, go to Profile.
  useEffect(() => {
    if (account.ready && account.user && !recoveryCode && !busy) router.replace("/");
  }, [account.ready, account.user, recoveryCode, busy, router]);

  // An error is about what was typed; once that changes it no longer applies.
  const typing = (key: "username" | "email" | "password" | "code", set: (text: string) => void) => (text: string) => {
    set(text);
    if (fieldError[key]) setFieldError((f) => ({ ...f, [key]: undefined }));
  };
  const switchTo = (next: Mode) => { setMode(next); setError(null); setFieldError({}); };
  const newPassword = mode !== "signin";
  const longEnough = password.length >= account.minPassword;

  const submit = async () => {
    if (busy) return;
    const problems: typeof fieldError = {};
    if (mode === "signup" && !/^[A-Za-z0-9._-]{3,24}$/.test(username.trim())) problems.username = t(USERNAME_RULE);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) problems.email = t("Enter your email address, like name@example.com.");
    if (!password) problems.password = t("Enter a password.");
    else if (newPassword && !longEnough) problems.password = t("Use at least {n} characters. A few unrelated words work well.", { n: account.minPassword });
    if (mode === "recover" && !code.trim()) problems.code = t("Enter the recovery code you saved.");
    if (mode === "signup" && !agreed) problems.terms = t("Please read and accept the beta terms to continue.");
    setFieldError(problems);
    setError(null);
    if (Object.keys(problems).length) return;
    setBusy(true);
    const result = mode === "signin" ? await account.login({ email, password })
      : mode === "signup" ? await account.signup({ username: username.trim(), email, password, acceptTerms: true, inviteCode: invite.trim() || undefined })
      : await account.recover({ email, recoveryCode: code, newPassword: password });
    setBusy(false);
    if (!result.ok) {
      if (result.code === "weak_password") setFieldError({ password: result.error });
      else if (result.code === "username_taken") setFieldError({ username: result.error });
      else setError(result.error);
      return;
    }
    setPassword("");
    if (result.recoveryCode) setRecoveryCode(result.recoveryCode);
    else router.replace("/");
  };

  const copy = async () => {
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined") await navigator.clipboard.writeText(recoveryCode ?? "");
      setCopied(true);
    } catch { setCopied(false); }
  };

  if (!account.ready) return <Screen title={t("Account")}><Small>{t("Loading…")}</Small></Screen>;
  // Two halves on a wide screen: the form (or the start button) and the demo. On a phone they stack.
  const halves = (left: React.ReactNode) => (
    <View style={{ width: "100%", maxWidth: 1180, alignSelf: "center", flexDirection: shell ? "row" : "column", gap: shell ? 40 : spacing.xl, alignItems: shell ? "stretch" : undefined }}>
      <Reveal style={shell ? { flex: 1, minWidth: 0, justifyContent: "center" } : undefined}>
        <View style={{ gap: spacing.lg, width: "100%", maxWidth: 480, alignSelf: shell ? "flex-end" : "center" }}>
          <View style={{ gap: spacing.md }}>
            <Wordmark size={shell ? 72 : 48} />
            <Text style={{ fontSize: shell ? 15 : 12, lineHeight: shell ? 26 : 21, letterSpacing: shell ? 7 : 4.5, fontWeight: "300", textTransform: "uppercase", color: colors.white }}>
              {t("Make better decisions.")}{"\n"}{t("Live a better life.")}
            </Text>
            <LanguageSwitch compact />
          </View>
          {left}
        </View>
      </Reveal>
      <Reveal index={1} style={shell ? { flex: 1, minWidth: 0 } : undefined}>
        <View style={[{ flex: 1, maxWidth: 520, alignSelf: shell ? "flex-start" : "center", width: "100%", padding: spacing.lg, borderRadius: 28, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.line }, blur]}>
          <Eyebrow color={colors.accentBright}>{t("See how it works")}</Eyebrow>
          <View style={{ height: spacing.md }} />
          <HowItWorksDemo compact={!shell} />
        </View>
      </Reveal>
    </View>
  );

  if (!account.enabled) {
    return (
      <Screen title={t("Welcome")} scene="sky">
        {halves(
          <Card style={{ gap: spacing.md }}>
            <SectionTitle>{t("Stuck on a decision?")}</SectionTitle>
            <Body>{t("Ask in your own words. ORION lays out the options, weighs what matters to you, and makes a clear call — then checks in on how it went.")}</Body>
            <Small>{t("This copy of ORION runs without accounts. Everything you do stays on this device.")}</Small>
            <AppButton title={t("Start deciding")} iconRight="arrow-forward" onPress={asGuest} style={{ alignSelf: "flex-start" }} />
          </Card>
        )}
      </Screen>
    );
  }

  if (recoveryCode) {
    return (
      <Screen title={t("Save your recovery code")}>
        <View style={{ width: "100%", maxWidth: layout.column, alignSelf: "center", gap: spacing.lg }}>
          <PageHeader eyebrow={mode === "recover" ? t("Password changed") : t("Account created")} title={t("Save your recovery code")} />
          <Card>
            <Body>
              {t("This code is the only way to reset your password if you forget it. ORION does not send email yet, so there is no “email me a link”. Keep it in a password manager or write it down.")}
            </Body>
            <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.accentLine, alignItems: "center" }}>
              <Text selectable accessibilityLabel={t("Recovery code: {code}", { code: recoveryCode.split("").join(" ") })} style={[{ fontSize: 22, letterSpacing: 2, fontWeight: "500", color: colors.white, textAlign: "center" }, tabular]}>
                {recoveryCode}
              </Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
              {Platform.OS === "web" && <AppButton variant="secondary" icon={copied ? "checkmark" : "copy-outline"} title={copied ? t("Copied") : t("Copy code")} onPress={() => void copy()} />}
              <Small>{t("It is shown only this once. Each code works one time; resetting gives you a new one.")}</Small>
            </View>
            <CheckRow checked={saved} onPress={() => setSaved(!saved)} label={t("I have saved my recovery code somewhere safe")} />
            <AppButton title={t("Continue")} iconRight="arrow-forward" disabled={!saved} onPress={() => router.replace("/")} style={{ alignSelf: "flex-start" }} />
          </Card>
        </View>
      </Screen>
    );
  }

  const [title, lead] = TITLES[mode].map((text) => t(text));
  return (
    <Screen title={title} scene="sky">
      {halves(
        <>
          <Card style={{ gap: spacing.lg }}>
            <View style={{ gap: spacing.sm }}>
              <View accessibilityRole="tablist" accessibilityLabel={t("Sign in or create an account")} style={{ flexDirection: "row", padding: 3, borderRadius: radius.pill, backgroundColor: colors.sunken, marginBottom: spacing.sm }}>
                {([["signin", t("Sign in")], ["signup", t("Create account")]] as const).map(([key, label]) => {
                  const active = mode === key || (key === "signin" && mode === "recover");
                  return (
                    <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => switchTo(key)}
                      style={{ flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: radius.pill, backgroundColor: active ? colors.frost : "transparent" }}>
                      <Text style={{ fontSize: 14, fontWeight: active ? "500" : "400", color: active ? colors.white : colors.muted }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <SectionTitle>{title}</SectionTitle>
              <Small>{lead}</Small>
            </View>
            {error && <Notice tone="danger" alert>{error}</Notice>}
            {mode === "signup" && (
              <LabeledField
                label={t("Username")}
                value={username}
                onChangeText={typing("username", setUsername)}
                error={fieldError.username}
                hint={t("What ORION calls you, shown at the top of every page. {rule}", { rule: t(USERNAME_RULE) })}
                placeholder={t("e.g. alex_k")}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username-new"
                textContentType="username"
                maxLength={24}
                onSubmitEditing={() => void submit()}
              />
            )}
            <LabeledField
              label={t("Email")}
              value={email}
              onChangeText={typing("email", setEmail)}
              error={fieldError.email}
              placeholder="name@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              inputMode="email"
              onSubmitEditing={() => void submit()}
            />
            {mode === "recover" && (
              <LabeledField
                label={t("Recovery code")}
                value={code}
                onChangeText={typing("code", setCode)}
                error={fieldError.code}
                hint={t("Twenty letters and digits, shown when you created your account. Dashes and capitals do not matter.")}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                onSubmitEditing={() => void submit()}
              />
            )}
            <View style={{ gap: 6 }}>
              <LabeledField
                label={mode === "recover" ? t("New password") : t("Password")}
                value={password}
                onChangeText={typing("password", setPassword)}
                error={fieldError.password}
                hint={newPassword ? t("At least {n} characters. Longer is better; symbols are not required.", { n: account.minPassword }) : undefined}
                secureTextEntry={!shown}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={newPassword ? "new-password" : "current-password"}
                textContentType={newPassword ? "newPassword" : "password"}
                onSubmitEditing={() => void submit()}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                <CheckRow checked={shown} onPress={() => setShown(!shown)} label={t("Show password")} />
                {newPassword && password.length > 0 && (
                  <Text accessibilityLiveRegion="polite" style={[{ fontSize: 13, color: longEnough ? colors.success : colors.muted }, tabular]}>
                    {longEnough ? t("Long enough") : t("{n} more to go", { n: account.minPassword - password.length })}
                  </Text>
                )}
              </View>
            </View>
            {mode === "signup" && account.inviteRequired && (
              <LabeledField
                label={t("Invite code")}
                value={invite}
                onChangeText={setInvite}
                hint={t("ORION is in a closed beta. Your invite came with a code.")}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => void submit()}
              />
            )}
            {mode === "signup" && (
              <View style={{ gap: 4 }}>
                <CheckRow checked={agreed} onPress={() => { setAgreed(!agreed); setFieldError((f) => ({ ...f, terms: undefined })); }} label={t("I agree to the beta terms and the privacy notice")} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingLeft: 28 }}>
                  <Pressable accessibilityRole="link" onPress={() => router.push("/terms")}><Text style={link}>{t("Read the beta terms")}</Text></Pressable>
                  <Pressable accessibilityRole="link" onPress={() => router.push("/privacy")}><Text style={link}>{t("Read the privacy notice")}</Text></Pressable>
                </View>
                {fieldError.terms && <Text accessibilityRole="alert" style={{ fontSize: 13, color: colors.danger, paddingLeft: 28 }}>{fieldError.terms}</Text>}
              </View>
            )}
            <AppButton
              title={busy ? t("One moment…") : mode === "signin" ? t("Sign in") : mode === "signup" ? t("Create account") : t("Set new password")}
              iconRight="arrow-forward"
              disabled={busy}
              onPress={() => void submit()}
            />
            <View style={{ gap: spacing.sm }}>
              {mode === "signin" && (
                <Pressable accessibilityRole="link" onPress={() => switchTo("recover")}><Text style={link}>{t("Forgot your password?")}</Text></Pressable>
              )}
              {mode === "recover" && (
                <>
                  <Pressable accessibilityRole="link" onPress={() => switchTo("signin")}><Text style={link}>{t("Back to sign in")}</Text></Pressable>
                  <Small>{t("Lost the recovery code too? The account cannot be recovered, but you can create a new one. Decisions on this device stay on this device.")}</Small>
                </>
              )}
              <Pressable accessibilityRole="link" onPress={asGuest}><Text style={[link, { color: colors.muted }]}>{t("Continue without an account — your decisions stay on this device")}</Text></Pressable>
            </View>
          </Card>
          <View style={{ gap: spacing.sm }}>
            {BENEFITS.map(([icon, text]) => (
              <View key={text} style={{ flexDirection: "row", gap: 10 }}>
                <Icon name={icon} size={18} color={colors.accentBright} style={{ marginTop: 2 }} />
                <Small style={{ flex: 1 }}>{t(text)}</Small>
              </View>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
