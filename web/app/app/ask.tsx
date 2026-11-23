"use client";
// /app: ask a question. A finished decision gets its own address (/app/d/[id]); the ?q= hand-off from the marketing
// pages is consumed once and replaced, so a refresh never re-runs it. Old ?d= links redirect to the canonical route.
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DecisionBar, Segmented } from "@/components/client";
import { Loading, RecentCard } from "@/components/DecisionFlow";
import { msg } from "@orion/i18n/index.ts";
import { useT } from "@/components/LocaleProvider";
import { Index, Notice } from "@/components/ui";
import { startAccount, useAccount } from "@/lib/account";
import { ApiError } from "@/lib/api";
import { decide, type DecisionRun } from "@/lib/decide";
import { dueCheckIn } from "@/lib/followup";
import { PHOTOS } from "@/lib/photos";
import { store, useStore } from "@/lib/store";
import s from "./workspace.module.css";

type Phase = { kind: "idle" } | { kind: "loading"; stage: "reading" | "scoring"; preview: string[] } | { kind: "error"; message: string; signIn?: "signin" | "signup" };

export function Ask() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const runs = useStore((d) => d.runs);
  const lens = useStore((d) => d.lens);
  const company = useStore((d) => d.company);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [question, setQuestion] = useState("");
  const abort = useRef<AbortController | null>(null);

  const submit = useCallback(async (text: string, as: "personal" | "business") => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setQuestion(text);
    setPhase({ kind: "loading", stage: "reading", preview: [] });
    try {
      const run = await decide(text, as, company, (stage, preview) => setPhase({ kind: "loading", stage, preview: preview ?? [] }), ctrl.signal);
      store.saveRun(run);
      router.replace(`/app/d/${run.id}`);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      // Out of guest tries: the server's own words, and an invitation to sign up rather than sign in.
      if (error instanceof ApiError && error.status === 401 && error.code === "guest_limit") { setPhase({ kind: "error", signIn: "signup", message: error.message }); return; }
      const signIn = error instanceof ApiError && error.status === 401;
      setPhase({ kind: "error", signIn: signIn ? "signin" : undefined, message: signIn ? t("Sign in to use ORION on this server.") : t("Something went wrong reading that. Try again in a moment.") });
    }
  }, [company, router, t]);

  const cancel = useCallback(() => { abort.current?.abort(); setPhase({ kind: "idle" }); }, []);

  const q = params.get("q");
  const d = params.get("d");
  const asked = params.get("lens");
  useEffect(() => {
    if (d) { router.replace(`/app/d/${d}`); return; }
    const as = asked === "business" || asked === "personal" ? asked : undefined;
    if (as) store.setLens(as);
    if (q) {
      router.replace("/app"); // consume the hand-off
      void submit(q, as ?? store.get().lens);
    }
  }, [q, d, asked, router, submit]);
  useEffect(() => () => abort.current?.abort(), []);

  if (phase.kind === "loading") return <div className={s.page}><Loading question={question} stage={phase.stage} preview={phase.preview} onCancel={cancel} /></div>;
  return (
    <>
      <div className={s.sky} aria-hidden><Image src={lens === "business" ? PHOTOS.business.src : PHOTOS.ask.src} alt="" fill priority sizes="100vw" /></div>
      <div className={s.page}>
        <Idle lens={lens} runs={runs} onSubmit={(text) => void submit(text, lens)} initial={question} error={phase.kind === "error" ? phase : null} />
      </div>
    </>
  );
}

function Idle({ lens, runs, onSubmit, initial, error }: {
  lens: "personal" | "business"; runs: DecisionRun[]; onSubmit: (t: string) => void; initial: string; error: { message: string; signIn?: "signin" | "signup" } | null;
}) {
  const t = useT();
  const account = useAccount();
  useEffect(startAccount, []);
  const [greeting, setGreeting] = useState(msg("Welcome"));
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 5 ? msg("Still up") : hour < 12 ? msg("Good morning") : hour < 18 ? msg("Good afternoon") : msg("Good evening"));
  }, []);
  return (
    <div className="stack gap-8">
      <section className={s.welcome}>
        <div className="stack gap-3 rise">
          <span className="t-label" style={{ color: "rgb(255 255 255 / 0.8)" }}>{t(greeting)}</span>
          <h1 className="t-d2" style={{ maxWidth: "16ch" }}>{lens === "business" ? t("What is the business deciding?") : t("What are you deciding?")}</h1>
        </div>
        <div className="row between wrap-row gap-4 rise" style={{ "--i": 1 } as React.CSSProperties}>
          <Segmented label={t("Who is this decision for?")} value={lens} onChange={(v) => store.setLens(v)}
            options={[{ value: "personal", label: t("For me"), icon: "profile" }, { value: "business", label: t("For a business"), icon: "building" }]} />
          {lens === "business" && <Link href="/app/company" className="t-small blue">{t("Company profile →")}</Link>}
        </div>
        <div className="rise" style={{ "--i": 2 } as React.CSSProperties}>
          <DecisionBar onSubmit={onSubmit} autoFocus initial={initial}
            placeholder={lens === "business" ? t("e.g. Hire a second engineer now or wait until next quarter?") : t("What are you deciding?")} />
        </div>
        {error && (
          <Notice tone="danger" icon="close">
            {error.message} {error.signIn === "signin" && <Link href="/signin?next=/app" className="blue">{t("Sign in →")}</Link>}
            {error.signIn === "signup" && <Link href="/signin?mode=signup&next=/app" className="blue">{t("Create a free account →")}</Link>}
          </Notice>
        )}
        {account.state === "out" && account.guestDecisions > 0 && !error && (
          <p className="t-small rise" style={{ "--i": 3, color: "rgb(255 255 255 / 0.86)" } as React.CSSProperties}>
            {account.guestDecisions === 1 ? t("Try it now — no account needed for your first decision.") : t("Try it now — no account needed for your first {n} decisions.", { n: account.guestDecisions })}{" "}
            <Link href="/signin?mode=signup&next=/app" className="blue">{t("Create a free account to keep them on every device →")}</Link>
          </p>
        )}
        <p className="t-small rise" style={{ "--i": 3, color: "rgb(255 255 255 / 0.72)" } as React.CSSProperties}>
          {t("Name your options (“A or B?”) or just describe the situation — ORION will suggest some. It scores them for you; you’ll be asked at most one question.")}
        </p>
      </section>

      <CheckIns runs={runs} />

      {runs.length > 0 && (
        <section className="stack gap-5" aria-labelledby="recent">
          <div className="row between"><Index n="—"><span id="recent">{t("Recent decisions")}</span></Index></div>
          <div className={s.recentGrid}>{runs.slice(0, 6).map((r) => <RecentCard key={r.id} run={r} />)}</div>
          {runs.length > 6 && <Link href="/app/history" className="t-small blue">{t("All {n} decisions →", { n: runs.length })}</Link>}
        </section>
      )}
    </div>
  );
}

/** Decisions whose two- or six-month check-in is due: the reason to come back after choosing. */
function CheckIns({ runs }: { runs: DecisionRun[] }) {
  const t = useT();
  // Read the clock after mount so the server and first browser render agree.
  const [due, setDue] = useState<DecisionRun[]>([]);
  useEffect(() => setDue(runs.filter((r) => dueCheckIn(r) !== null).slice(0, 3)), [runs]);
  if (due.length === 0) return null;
  return (
    <section className="stack gap-4" aria-labelledby="checkins">
      <Index n="—"><span id="checkins">{t("Check in")}</span></Index>
      <div className={s.recentGrid}>
        {due.map((r) => (
          <Link key={r.id} href={`/app/d/${r.id}`} className={`o-card ${s.recent}`}>
            <span className="t-label blue">{t("How did it turn out?")}</span>
            <span className={s.recentTitle}>{r.title}</span>
            <span className="t-small">{t("You chose {option}.", { option: r.options.find((o) => o.id === r.chosen)?.label ?? "" })}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
