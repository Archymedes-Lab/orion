// Shared page furniture for the marketing pages: full-bleed photography and the Swiss index footer (with the language
// switch, so it is reachable on every public page at any width).
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Archymedes, Wordmark } from "./brand";
import { msg } from "@orion/i18n/index.ts";
import { LanguageSwitch } from "./LanguageSwitch";
import { CREDITS, PHOTOS, type PhotoKey } from "@/lib/photos";
import { getT } from "@/lib/locale-server";
import { rich } from "@/lib/rich";

export function Photo({ name, priority, scrim, position, className, style }:
  { name: PhotoKey; priority?: boolean; scrim?: string; position?: string; className?: string; style?: CSSProperties }) {
  const p = PHOTOS[name];
  return (
    <div className={`o-photo ${className ?? ""}`} style={{ ...(scrim ? { "--scrim": scrim } : {}), ...style } as CSSProperties}>
      <Image src={p.src} alt="" fill priority={priority} sizes="100vw" quality={78} style={{ objectPosition: position ?? "center" }} />
    </div>
  );
}

const COLUMNS = [
  { title: msg("Product"), links: [[msg("Start deciding"), "/app"], [msg("How it works"), "/#how"], [msg("Everyday decisions"), "/#everyday"], [msg("History"), "/app/history"]] },
  { title: msg("Business"), links: [[msg("ORION for business"), "/business"], [msg("Company profile"), "/app/company"], [msg("Templates"), "/business#templates"]] },
  { title: msg("Account"), links: [[msg("Sign in"), "/signin"], [msg("Create an account"), "/signin?mode=signup"], [msg("Beta terms"), "/terms"], [msg("Privacy"), "/privacy"]] },
];

export async function Footer() {
  const t = await getT();
  const authors = CREDITS.filter((p, i, all) => all.findIndex((q) => q.author === p.author) === i);
  return (
    <footer className="o-footer">
      <div className="wrap grid" style={{ rowGap: "var(--s-7)" }}>
        <div className="c-1-4 stack gap-5">
          <Wordmark height={20} />
          <p className="t-small" style={{ maxWidth: "30ch" }}>{t("Make better decisions. Live a better life. Clear questions, deeper insights, a brighter tomorrow.")}</p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} className="stack gap-3 c-2" aria-label={t(col.title)}>
            <span className="t-label">{t(col.title)}</span>
            {col.links.map(([label, href]) => <Link key={href} href={href}>{t(label)}</Link>)}
          </nav>
        ))}
        <div className="stack gap-3 c-2">
          <span className="t-label">{t("Photography")}</span>
          <p className="t-micro" style={{ lineHeight: 1.7 }}>
            {rich(t("{authors} on Unsplash."), { authors: authors.map((p, i) => (
              <span key={p.author}><a href={p.page} target="_blank" rel="noreferrer" style={{ fontSize: "inherit" }}>{p.author}</a>{i < authors.length - 1 ? ", " : ""}</span>
            )) })}
          </p>
        </div>
        <div className="row between wrap-row gap-4" style={{ gridColumn: "1 / -1", paddingTop: "var(--s-5)", borderTop: "1px solid var(--hair)" }}>
          <span className="row gap-3 t-micro"><Archymedes size={16} /> <span className="t-tracked" style={{ fontSize: 11 }}>Archymedes</span></span>
          <span className="row gap-4 wrap-row">
            <LanguageSwitch />
            <span className="t-mono faint">© {new Date().getFullYear()} · {t("Build · Automate · Protect · Grow")}</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
