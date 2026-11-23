"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/brand";
import { Button, Index } from "@/components/ui";
import { Segmented } from "@/components/client";
import { Confirm, InlineEdit, Menu } from "@/components/overlay";
import { RunDetails, useRunMenu } from "@/components/RunActions";
import { useLang, useT } from "@/components/LocaleProvider";
import { intlLocale, withLocale } from "@orion/i18n/index.ts";
import type { DecisionRun } from "@/lib/decide";
import { toScore, view } from "@/lib/decide";
import { exportCsv, exportJson, matches, parseExport, sortRuns, type Sort } from "@/lib/history";
import { resultLabel } from "@/lib/followup";
import { store, useStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import s from "../workspace.module.css";
import h from "./history.module.css";

type Filter = "all" | "pinned" | "chosen" | "open" | "business";

export function History() {
  const t = useT();
  const runs = useStore((d) => d.runs);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<"selected" | "all" | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => sortRuns(runs.filter((r) =>
    (filter === "all" || (filter === "pinned" && r.pinned) || (filter === "chosen" && r.chosen) || (filter === "open" && !r.chosen) || (filter === "business" && r.lens === "business")) &&
    matches(r, query)), sort), [runs, filter, query, sort]);
  // Pinned decisions lead unless you asked for a specific order other than newest.
  const ordered = useMemo(() => (sort === "newest" ? [...shown.filter((r) => r.pinned), ...shown.filter((r) => !r.pinned)] : shown), [shown, sort]);

  // Selection only ever covers decisions that still exist and are on screen.
  const picked = ordered.filter((r) => selected.has(r.id));
  const all = ordered.length > 0 && picked.length === ordered.length;
  const toggle = (id: string) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelected(all ? new Set() : new Set(ordered.map((r) => r.id)));

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const n = store.importRuns(parseExport(await f.text()));
      toast(n ? t("Imported {n} decisions", { n }) : t("Those decisions are already here."));
    } catch {
      toast(t("That file isn’t an ORION export."));
    }
    if (file.current) file.current.value = "";
  };

  return (
    <div className={s.page}>
      <div className="stack gap-7">
        <header className="stack gap-4 rise">
          <Index n="—">{t("History")}</Index>
          <div className="row between wrap-row gap-4">
            <h1 className="t-d2">{t("Your decisions")}</h1>
            <div className="row gap-2">
              <span className="t-mono faint" style={{ marginRight: 8 }}>{t("{n} saved on this device", { n: runs.length })}</span>
              <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
              <Menu label={t("History options")} items={[
                { label: t("Import from a file"), icon: "upload", onSelect: () => file.current?.click() },
                ...(runs.length ? [
                  { label: t("Export all (JSON)"), icon: "download" as const, onSelect: () => exportJson(runs) },
                  { label: t("Export all (CSV)"), icon: "download" as const, onSelect: () => exportCsv(runs) },
                  "sep" as const,
                  { label: t("Delete all decisions"), icon: "trash" as const, danger: true, onSelect: () => setConfirm("all") },
                ] : []),
              ]} />
            </div>
          </div>
        </header>
        <div className="row between wrap-row gap-4">
          <div className={h.filters}><Segmented label={t("Show")} value={filter} onChange={(f) => { setFilter(f); setSelected(new Set()); }}
            options={[{ value: "all", label: t("All") }, { value: "pinned", label: t("Pinned") }, { value: "chosen", label: t("Chosen") }, { value: "open", label: t("Undecided") }, { value: "business", label: t("Business") }]} /></div>
          <div className="row gap-3" style={{ flex: "1 1 320px", maxWidth: 480 }}>
            <input className="o-input" placeholder={t("Search your decisions")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("Search your decisions")} />
            <select className="o-select" style={{ width: 168, flex: "none" }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("Sort by")}>
              <option value="newest">{t("Newest first")}</option>
              <option value="oldest">{t("Oldest first")}</option>
              <option value="edited">{t("Recently edited")}</option>
              <option value="title">{t("Title A–Z")}</option>
            </select>
          </div>
        </div>
        {runs.length === 0 ? (
          <div className={h.empty}>
            <span className="t-label">{t("Nothing yet")}</span>
            <p className="t-h2">{t("Decisions you make with ORION will be listed here, with what it said and what you chose.")}</p>
            <div className="row gap-3"><Link href="/app" className="o-btn o-btn--primary">{t("Make your first decision")}</Link>
              <Button variant="ghost" icon="upload" onClick={() => file.current?.click()}>{t("Import from a file")}</Button></div>
          </div>
        ) : (
          <ol className={h.table}>
            <li className={h.headRow}>
              <input type="checkbox" className="o-check" checked={all} aria-label={t("Select all")}
                ref={(el) => { if (el) el.indeterminate = picked.length > 0 && !all; }} onChange={toggleAll} />
              <span aria-hidden>{t("Date")}</span><span aria-hidden>{t("Decision")}</span><span aria-hidden>{t("ORION’s call")}</span><span aria-hidden>{t("You chose")}</span><span />
            </li>
            {ordered.map((r) => <Row key={r.id} run={r} checked={selected.has(r.id)} onCheck={() => toggle(r.id)} />)}
            {ordered.length === 0 && <li className="t-small" style={{ padding: "var(--s-5) 0" }}>{t("No decisions match.")}</li>}
          </ol>
        )}
      </div>

      {picked.length > 0 && (
        <div className={h.bulk} data-bulk role="toolbar" aria-label={t("Selected decisions")}>
          <span className="t-small ink">{t("{n} selected", { n: picked.length })}</span>
          <Button size="sm" variant="ghost" icon="pin" onClick={() => {
            const pin = picked.some((r) => !r.pinned);
            picked.forEach((r) => store.updateRun(r.id, { pinned: pin }));
          }}>{picked.some((r) => !r.pinned) ? t("Pin") : t("Unpin")}</Button>
          <Button size="sm" variant="ghost" icon="download" onClick={() => exportJson(picked)}>{t("Export")}</Button>
          <Button size="sm" variant="danger" icon="trash" onClick={() => setConfirm("selected")}>{t("Delete")}</Button>
          <button type="button" className="o-icon-btn" aria-label={t("Clear selection")} onClick={() => setSelected(new Set())}><Icon name="close" size={15} /></button>
        </div>
      )}

      <Confirm open={confirm !== null} onClose={() => setConfirm(null)} danger
        title={confirm === "all" ? t("Delete all decisions?") : t("Delete {n} decisions?", { n: picked.length })}
        body={t("They are removed from this browser. You can undo for a few seconds, or export them first to keep a copy.")}
        action={t("Delete")}
        onConfirm={() => { store.removeRuns(confirm === "all" ? runs.map((r) => r.id) : picked.map((r) => r.id)); setSelected(new Set()); }} />
    </div>
  );
}

function Row({ run: r, checked, onCheck }: { run: DecisionRun; checked: boolean; onCheck: () => void }) {
  const t = useT();
  const locale = useLang();
  const [renaming, setRenaming] = useState(false);
  const [details, setDetails] = useState(false);
  const items = useRunMenu(r, { onRename: () => setRenaming(true), onDetails: () => setDetails(true) });
  const v = withLocale(locale, () => view(r));
  const chosen = r.options.find((o) => o.id === r.chosen);
  return (
    <li className={h.row} data-checked={checked || undefined}>
      <input type="checkbox" className="o-check" checked={checked} onChange={onCheck} aria-label={t("Select “{title}”", { title: r.title })} />
      <span className="t-mono faint">{new Date(r.createdAt).toLocaleDateString(withLocale(locale, intlLocale), { day: "2-digit", month: "short", year: "numeric" })}</span>
      <div className={h.cell}>
        <div className="row gap-2" style={{ minWidth: 0 }}>
          {r.pinned && <Icon name="pin" size={14} className="blue" />}
          {renaming
            ? <InlineEdit value={r.title} editing onSave={(title) => store.updateRun(r.id, { title })} onDone={() => setRenaming(false)} label={t("Rename")} />
            : <Link href={`/app/d/${r.id}`} className={h.q} onDoubleClick={(e) => { e.preventDefault(); setRenaming(true); }}>{r.title}</Link>}
          {r.lens === "business" && <span className="o-tag o-tag--plain">{t("Business")}</span>}
        </div>
        {r.title !== r.question && <span className={h.sub}>{r.question}</span>}
        {r.note && <button type="button" className={h.note} onClick={() => setDetails(true)}><Icon name="note" size={13} />{r.note}</button>}
        {r.outcomes?.length ? <span className={h.sub}>{t("Turned out: {result}", { result: resultLabel(r.outcomes[r.outcomes.length - 1].result) })}</span> : null}
      </div>
      <span className="t-small">{v.call ? <><span className="ink">{v.call.label}</span> · {toScore(v.ranked[0]?.jev ?? 0)}</> : "—"}</span>
      <span className="t-small">{chosen ? <span className={chosen.id === v.call?.optionId ? "ink" : "blue"}>{chosen.label}</span> : <span className="faint">{t("Undecided")}</span>}</span>
      <Menu label={t("Actions for “{title}”", { title: r.title })} items={items} />
      <RunDetails run={r} open={details} onClose={() => setDetails(false)} />
    </li>
  );
}
