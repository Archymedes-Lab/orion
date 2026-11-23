"use client";
// Client-side primitives: anything that observes scroll, time or input.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ElementType, type ReactNode } from "react";
import { Icon, Wordmark, type IconName } from "./brand";
import { msg } from "@orion/i18n/index.ts";
import { LanguageSwitch } from "./LanguageSwitch";
import { useLang, useT } from "./LocaleProvider";
import { ArrowButton, Chip } from "./ui";

/** Fades and lifts its children in the first time they scroll into view. `i` staggers siblings. */
export function Reveal({ as: As = "div", i = 0, className, style, children }:
  { as?: ElementType; i?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setInView(true); io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <As ref={ref} className={`reveal ${inView ? "in" : ""} ${className ?? ""}`} style={{ "--i": i, ...style } as CSSProperties}>{children}</As>;
}

export function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [threshold]);
  return scrolled;
}

const LINKS = [
  { href: "/#how", label: msg("Method") },
  { href: "/#everyday", label: msg("Everyday") },
  { href: "/business", label: msg("Business") },
  { href: "/#aftermath", label: msg("Aftermath") },
];

/** Marketing top bar: transparent over the sky, frosted once content scrolls under it. */
export function SiteNav() {
  const t = useT();
  const scrolled = useScrolled();
  const path = usePathname();
  return (
    <header className="o-nav" data-solid={scrolled}>
      <div className="wrap o-nav__in">
        <Link href="/" aria-label={t("ORION home")} style={{ justifySelf: "start" }}><Wordmark height={17} /></Link>
        <nav className="o-nav__links" aria-label={t("Main")}>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="o-nav__link" aria-current={path === l.href ? "page" : undefined}>{t(l.label)}</Link>
          ))}
        </nav>
        <div className="o-nav__end">
          <LanguageSwitch className="o-nav__hide-sm" />
          <LanguageSwitch variant="toggle" className="o-nav__lang-sm" />
          <Link href="/signin" className="o-btn o-btn--ghost o-btn--sm o-nav__hide-sm">{t("Sign in")}</Link>
          <Link href="/app" className="o-btn o-btn--primary o-btn--sm">{t("Start deciding")}</Link>
        </div>
      </div>
    </header>
  );
}

/** Live local time in a named city, as on the poster ("8:17 AM — KIGALI"). */
export function CityClock({ zone = "Africa/Kigali", city = msg("Kigali") }: { zone?: string; city?: string }) {
  const t = useT();
  const locale = useLang();
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [zone, locale]);
  return (
    <div className="stack gap-2">
      <span className="t-h1 t-num" style={{ fontWeight: 200, minHeight: "1.15em" }}>{now ?? " "}</span>
      <span className="t-label">{t(city)}</span>
      <span className="o-rule" />
    </div>
  );
}

export const CATEGORIES: { icon: IconName; label: string; prompt: string }[] = [
  { icon: "career", label: msg("Career"), prompt: msg("Accept this offer or keep looking?") },
  { icon: "health", label: msg("Health"), prompt: msg("Gym before work or tonight?") },
  { icon: "money", label: msg("Money"), prompt: msg("Rent or buy a home?") },
  { icon: "people", label: msg("Relationships"), prompt: msg("Move in together this year or wait?") },
  { icon: "travel", label: msg("Moving"), prompt: msg("Move to a new city for work or stay?") },
];

/**
 * The one input: "What are you deciding?". Enter submits, Shift+Enter breaks a line.
 * Without `onSubmit` it hands the question to the workspace (/app?q=…).
 */
export function DecisionBar({ onSubmit, busy, autoFocus, chips = true, initial = "", placeholder: given, lens }:
  { onSubmit?: (text: string) => void; busy?: boolean; autoFocus?: boolean; chips?: boolean; initial?: string; placeholder?: string; lens?: "business" }) {
  const t = useT();
  const placeholder = given ?? t("What are you deciding?");
  const [text, setText] = useState(initial);
  const router = useRouter();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(initial), [initial]);
  const send = (value = text) => {
    const q = value.trim();
    if (!q || busy) return;
    if (onSubmit) onSubmit(q);
    else router.push(`/app?${lens ? `lens=${lens}&` : ""}q=${encodeURIComponent(q)}`);
  };
  return (
    <div className="stack gap-4">
      <form className="o-decide" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label htmlFor="decide" className="sr-only">{placeholder}</label>
        <textarea
          id="decide" ref={ref} rows={1} value={text} autoFocus={autoFocus} placeholder={placeholder} maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        />
        <ArrowButton label={t("Decide")} type="submit" disabled={!text.trim() || busy} />
      </form>
      {chips && (
        <div className="row gap-2 wrap-row">
          {CATEGORIES.map((c) => (
            <Chip key={c.label} icon={c.icon} onClick={() => { setText(t(c.prompt)); ref.current?.focus(); }}>{t(c.label)}</Chip>
          ))}
          <Chip icon="more" onClick={() => { setText(""); ref.current?.focus(); }}>{t("More")}</Chip>
        </div>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }:
  { value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="o-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className="row gap-2">
          {o.icon && <Icon name={o.icon} size={14} />}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDone, 2600);
    return () => clearTimeout(id);
  }, [message, onDone]);
  return message ? <div className="o-toast" role="status">{message}</div> : null;
}

/** "⌘" on Apple keyboards, "Ctrl " elsewhere; "⌘" until the browser says otherwise. */
export function useModKey(): string {
  return useSyncExternalStore(() => () => {}, () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl "), () => "⌘");
}
