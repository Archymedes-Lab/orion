"use client";
// One screen, three modes (sign in, create account, reset with the recovery code), so switching never loses what was
// typed. The server's reason is shown as written; the rule is stated before the mistake.
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { refreshAccount } from "@/lib/account";
import { Suspense, useState } from "react";
import { Star, Wordmark } from "@/components/brand";
import { msg } from "@orion/i18n/index.ts";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useT } from "@/components/LocaleProvider";
import { Button, Field, Notice } from "@/components/ui";
import { rich } from "@/lib/rich";
import { api, ApiError } from "@/lib/api";
import { PHOTOS } from "@/lib/photos";
import s from "./signin.module.css";

type Mode = "signin" | "signup" | "recover";
const TITLES: Record<Mode, [string, string]> = {
  signin: [msg("Welcome back"), msg("Sign in to pick up your decisions on any device.")],
  signup: [msg("Create your account"), msg("Free during the beta. It takes a minute.")],
  recover: [msg("Reset your password"), msg("Use the recovery code you saved when you created your account.")],
};

export default function Page() { return <Suspense><SignIn /></Suspense>; }

function SignIn() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>((params.get("mode") as Mode) || "signin");
  const [f, setF] = useState({ email: "", username: "", password: "", recoveryCode: "", inviteCode: "", acceptTerms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const next = params.get("next") || "/app";
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "signin") { await api("auth/login", { email: f.email, password: f.password }); void refreshAccount().finally(() => router.push(next)); }
      else if (mode === "recover") { await api("auth/recover", { email: f.email, recoveryCode: f.recoveryCode, newPassword: f.password }); void refreshAccount().finally(() => router.push(next)); }
      else {
        const r = await api<{ recoveryCode?: string }>("auth/signup", { username: f.username, email: f.email, password: f.password, acceptTerms: f.acceptTerms, inviteCode: f.inviteCode || undefined });
        if (r.recoveryCode) setRecovery(r.recoveryCode); else void refreshAccount().finally(() => router.push(next));
      }
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 404 ? t("Accounts aren’t set up on this server — you can use ORION without one.") : err.message) : t("Couldn’t reach ORION. Check your connection and try again."));
    } finally { setBusy(false); }
  };

  return (
    <div className={s.page}>
      <aside className={s.art}>
        <Image src={PHOTOS.signin.src} alt="" fill priority sizes="50vw" style={{ objectFit: "cover" }} />
        <div className={s.artInner}>
          <Link href="/" aria-label={t("ORION home")}><Wordmark height={20} /></Link>
          <div className="stack gap-4">
            <Star size={18} pulse />
            <p className="t-d2" style={{ maxWidth: "12ch" }}>{t("A clearer you, a brighter tomorrow.")}</p>
          </div>
        </div>
      </aside>
      <main id="main" className={s.formSide}>
        {recovery ? (
          <div className={`stack gap-5 ${s.form}`}>
            <span className="t-label blue">{t("Account created")}</span>
            <h1 className="t-h1">{t("Save your recovery code")}</h1>
            <p className="t-body muted">{t("ORION has no email resets. This code is the only way back in if you forget your password. It won’t be shown again.")}</p>
            <code className={s.code}>{recovery}</code>
            <div className="row gap-3">
              <Button variant="secondary" icon="copy" onClick={() => navigator.clipboard?.writeText(recovery)}>{t("Copy")}</Button>
              <Button variant="primary" arrow onClick={() => void refreshAccount().finally(() => router.push(next))}>{t("I’ve saved it")}</Button>
            </div>
          </div>
        ) : (
          <form className={`stack gap-5 ${s.form}`} onSubmit={submit} noValidate>
            <div className="row between wrap-row gap-3">
              <div className="o-seg" role="group" aria-label={t("Account")}>
                {(["signin", "signup"] as Mode[]).map((m) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setError(null); }}>{m === "signin" ? t("Sign in") : t("Create account")}</button>
                ))}
              </div>
              <LanguageSwitch />
            </div>
            <div className="stack gap-2">
              <h1 className="t-h1">{t(TITLES[mode][0])}</h1>
              <p className="t-small">{t(TITLES[mode][1])}</p>
            </div>
            {mode === "signup" && (
              <Field label={t("Username")} hint={t("3–24 characters: letters, numbers, dots, dashes or underscores.")}>
                <input className="o-input" autoComplete="username" value={f.username} onChange={set("username")} required />
              </Field>
            )}
            <Field label={t("Email")}><input className="o-input" type="email" autoComplete="email" value={f.email} onChange={set("email")} required /></Field>
            {mode === "recover" && (
              <Field label={t("Recovery code")}><input className="o-input" value={f.recoveryCode} onChange={set("recoveryCode")} autoComplete="off" required /></Field>
            )}
            <Field label={mode === "recover" ? t("New password") : t("Password")} hint={mode === "signin" ? undefined : t("At least 10 characters. A few unrelated words work well.")}>
              <input className="o-input" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={f.password} onChange={set("password")} required />
            </Field>
            {mode === "signup" && (
              <>
                <Field label={t("Invite code")} hint={t("Only if you were given one.")}><input className="o-input" value={f.inviteCode} onChange={set("inviteCode")} /></Field>
                <label className="row gap-3 t-small" style={{ alignItems: "flex-start" }}>
                  <input type="checkbox" checked={f.acceptTerms} onChange={set("acceptTerms")} style={{ marginTop: 3, accentColor: "var(--blue)" }} />
                  <span>{rich(t("I agree to the {terms} and have read the {privacy}."), { terms: <Link href="/terms" className="blue" target="_blank">{t("beta terms")}</Link>, privacy: <Link href="/privacy" className="blue" target="_blank">{t("privacy notice")}</Link> })}</span>
                </label>
              </>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
            <Button variant="primary" size="lg" arrow type="submit" disabled={busy || (mode === "signup" && !f.acceptTerms)}>
              {busy ? t("One moment…") : mode === "signin" ? t("Sign in") : mode === "signup" ? t("Create account") : t("Reset password")}
            </Button>
            <div className="row between wrap-row gap-3 t-small">
              {mode === "recover"
                ? <button type="button" className="blue" onClick={() => setMode("signin")}>{t("Back to sign in")}</button>
                : <button type="button" className="blue" onClick={() => setMode("recover")}>{t("Forgot your password?")}</button>}
              <Link href="/app" className="muted">{t("Continue without an account →")}</Link>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
