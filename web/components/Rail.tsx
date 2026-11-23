"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Wordmark, type IconName } from "./brand";
import { signOut, startAccount, useAccount } from "@/lib/account";
import type { DecisionRun } from "@/lib/decide";
import { groupRuns, matches } from "@/lib/history";
import { msg } from "@orion/i18n/index.ts";
import { LanguageSwitch } from "./LanguageSwitch";
import { useT } from "./LocaleProvider";
import { useModKey } from "./client";
import { InlineEdit, Menu } from "./overlay";
import { RunDetails, useRunMenu } from "./RunActions";
import { Kbd } from "./ui";
import { rich } from "@/lib/rich";
import { RAIL, store, useStore } from "@/lib/store";
import s from "@/app/app/workspace.module.css";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/app", label: msg("Decide"), icon: "spark" },
  { href: "/app/prioritize", label: msg("Prioritize"), icon: "grid" },
  { href: "/app/history", label: msg("History"), icon: "history" },
  { href: "/app/company", label: msg("Company"), icon: "building" },
];

/**
 * The workspace rail: where you are, your decisions (pinned first, then by day) and who you are signed in as.
 * It folds to icons (⌘B or the button) and its edge drags to resize; both are remembered on this device.
 */
export function Rail({ onSearch }: { onSearch: () => void }) {
  const t = useT();
  const mod = useModKey();
  const path = usePathname();
  const runs = useStore((d) => d.runs);
  const lens = useStore((d) => d.lens);
  const collapsed = useStore((d) => d.rail.collapsed);
  const [filter, setFilter] = useState("");
  const account = useAccount();
  const [leaving, setLeaving] = useState<"busy" | "failed" | null>(null);
  useEffect(startAccount, []);

  const groups = useMemo(() => groupRuns(runs.filter((r) => matches(r, filter)).slice(0, 60)), [runs, filter]);
  const current = path.startsWith("/app/d/") ? path.slice("/app/d/".length) : null;
  const toggle = () => store.setRail({ collapsed: !collapsed });

  return (
    <aside className={s.rail} data-collapsed={collapsed}>
      <div className={s.railHead}>
        <Link href="/" aria-label={t("ORION home")} className={s.railBrand}><Wordmark height={15} /></Link>
        <span className={`o-tag o-tag--plain ${s.railHide} ${s.railBrand}`}>{lens === "business" ? t("Business") : t("Personal")}</span>
        <button type="button" className={`o-icon-btn ${s.railHide}`} onClick={toggle} aria-expanded={!collapsed}
          aria-label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")} title={`${collapsed ? t("Expand sidebar") : t("Collapse sidebar")} (${mod}B)`}>
          <Icon name="sidebar" size={17} />
        </button>
      </div>

      <div className={`${s.railTools} ${s.railHide}`}>
        <Link href="/app" className={s.railNew} title={t("New decision")}><Icon name="plus" size={16} /><span>{t("New decision")}</span></Link>
        <button type="button" className={s.railSearch} onClick={onSearch} aria-label={t("Search and commands")} title={`${t("Search and commands")} (${mod}K)`}>
          <Icon name="search" size={16} />
        </button>
      </div>

      <nav className={s.railNav} aria-label={t("Workspace")}>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={s.railLink} title={collapsed ? t(n.label) : undefined}
            aria-current={(n.href === "/app" ? path === "/app" || path.startsWith("/app/d/") : path.startsWith(n.href)) ? "page" : undefined}>
            <Icon name={n.icon} size={17} /><span>{t(n.label)}</span>
          </Link>
        ))}
      </nav>
      <LanguageSwitch variant="toggle" className={s.railLangSm} />

      {!collapsed && (
        <>
          <div className={s.railFilter}>
            <Icon name="search" size={14} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Filter decisions")} aria-label={t("Filter decisions")}
              onKeyDown={(e) => { if (e.key === "Escape") setFilter(""); }} />
            {filter && <button type="button" onClick={() => setFilter("")} aria-label={t("Clear filter")}><Icon name="close" size={13} /></button>}
          </div>
          <div className={s.railRecent}>
            {runs.length === 0 && <p className="t-micro" style={{ padding: "0 12px" }}>{t("Your decisions will appear here.")}</p>}
            {runs.length > 0 && groups.length === 0 && <p className="t-micro" style={{ padding: "0 12px" }}>{t("No decisions match.")}</p>}
            {groups.map((g) => (
              <section key={g.label} className={s.railGroup} aria-label={t(g.label)}>
                <span className={s.railGroupLabel}>{t(g.label)}</span>
                {g.runs.map((r) => <RailItem key={r.id} run={r} active={r.id === current} />)}
              </section>
            ))}
          </div>
        </>
      )}
      {collapsed && <div className={s.railSpacer} />}

      <div className={s.railFoot}>
        {!collapsed && account.state === "in" && (
          <div className="stack gap-1" style={{ padding: "0 12px" }}>
            <span className="t-micro">{t("Signed in as")}<br /><span className="muted">{account.email}</span></span>
            <span className="t-micro faint" role="status">
              {account.sync === "saving" ? t("Saving to your account…")
                : account.sync === "saved" ? t("Saved to your account")
                : account.sync === "too_large" ? t("Your newest decisions are saved; the oldest didn’t fit.")
                : account.sync === "failed" ? t("Couldn’t save to your account. It will try again after your next change.")
                : null}
            </span>
            <button type="button" className="t-micro blue" style={{ alignSelf: "flex-start" }} disabled={leaving === "busy"}
              onClick={async () => { setLeaving("busy"); setLeaving(await signOut() ? null : "failed"); }}>
              {leaving === "busy" ? t("Saving, then signing out…") : t("Sign out")}
            </button>
            {leaving === "failed" && <span className="t-micro" style={{ color: "var(--danger)" }}>{t("Couldn’t save your latest decisions, so you’re still signed in. Try again in a moment.")}</span>}
          </div>
        )}
        {!collapsed && account.state === "local" && <span className="t-micro" style={{ padding: "0 12px" }}>{t("Local mode — decisions stay on this device.")}</span>}
        {account.state === "out" && <Link href="/signin" className={s.railLink} title={collapsed ? t("Sign in") : undefined}><Icon name="profile" size={17} /><span>{t("Sign in")}</span></Link>}
        {!collapsed && <span className="t-micro row gap-2" style={{ padding: "4px 12px" }}>{rich(t("{key} to ask anywhere"), { key: <Kbd>/</Kbd> })}</span>}
        {!collapsed && <span className="t-micro row gap-2" style={{ padding: "0 12px 4px" }}>{rich(t("{key} to search"), { key: <Kbd>{mod}K</Kbd> })}</span>}
        {!collapsed && <div style={{ padding: "4px 12px 0" }}><LanguageSwitch /></div>}
      </div>
      {!collapsed && <ResizeHandle />}
    </aside>
  );
}

function RailItem({ run, active }: { run: DecisionRun; active: boolean }) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [details, setDetails] = useState(false);
  const items = useRunMenu(run, { onRename: () => setRenaming(true), onDetails: () => setDetails(true) });
  return (
    <div className={s.railItem} data-active={active || undefined} data-renaming={renaming || undefined}>
      {renaming
        ? <InlineEdit value={run.title} editing onSave={(title) => store.updateRun(run.id, { title })} onDone={() => setRenaming(false)} label={t("Rename")} />
        : (
          <Link href={`/app/d/${run.id}`} title={run.question} aria-current={active ? "page" : undefined}
            onDoubleClick={(e) => { e.preventDefault(); setRenaming(true); }}>
            {run.title}
          </Link>
        )}
      {!renaming && <Menu label={t("Actions for “{title}”", { title: run.title })} items={items} className={s.railItemMenu} />}
      <RunDetails run={run} open={details} onClose={() => setDetails(false)} />
    </div>
  );
}

/** Drag the rail's edge to resize; arrow keys do the same, double-click goes back to the default width. */
function ResizeHandle() {
  const t = useT();
  const width = useStore((d) => d.rail.width);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(RAIL.max, Math.max(RAIL.min, w)));
  const shell = () => document.querySelector<HTMLElement>("[data-shell]");

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
    document.body.style.cursor = "col-resize";
    shell()?.setAttribute("data-resizing", "");
  };
  // While dragging, write the width straight onto the shell; save once on release so storage isn't written per frame.
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    shell()?.style.setProperty("--rail-w", `${clamp(drag.current.w + e.clientX - drag.current.x)}px`);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const w = clamp(drag.current.w + e.clientX - drag.current.x);
    drag.current = null;
    document.body.style.cursor = "";
    shell()?.removeAttribute("data-resizing");
    store.setRail({ width: w });
  };
  return (
    <div className={s.railResize} role="separator" aria-orientation="vertical" aria-label={t("Resize sidebar")} tabIndex={0}
      aria-valuemin={RAIL.min} aria-valuemax={RAIL.max} aria-valuenow={width}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onDoubleClick={() => store.setRail({ width: RAIL.base })}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); store.setRail({ width: clamp(width + (e.key === "ArrowRight" ? 16 : -16)) }); }
        if (e.key === "Home") store.setRail({ width: RAIL.base });
      }} />
  );
}
