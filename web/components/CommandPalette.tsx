"use client";
// ⌘K: jump to any decision or run any workspace action by typing. Arrows move, Enter runs, Escape closes.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./brand";
import { useLang, useT } from "./LocaleProvider";
import { intlLocale, withLocale } from "@orion/i18n/index.ts";
import { Dialog } from "./overlay";
import { Kbd } from "./ui";
import { useModKey } from "./client";
import { exportJson, matches, sortRuns } from "@/lib/history";
import { store, useStore } from "@/lib/store";

type Item = { id: string; group: string; label: string; icon: IconName; hint?: string; run: () => void };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const locale = useLang();
  const mod = useModKey();
  const router = useRouter();
  const runs = useStore((d) => d.runs);
  const lens = useStore((d) => d.lens);
  const collapsed = useStore((d) => d.rail.collapsed);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => { if (open) { setQuery(""); setActive(0); } }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => router.push(href);
    const q = query.trim().toLowerCase();
    const all: Item[] = [
      { id: "new", group: t("Actions"), label: t("New decision"), icon: "plus", run: go("/app") },
      { id: "prioritize", group: t("Actions"), label: t("Prioritize"), icon: "grid", run: go("/app/prioritize") },
      { id: "history", group: t("Actions"), label: t("History"), icon: "history", run: go("/app/history") },
      { id: "company", group: t("Actions"), label: t("Company"), icon: "building", run: go("/app/company") },
      { id: "lens", group: t("Actions"), label: lens === "business" ? t("Switch to personal decisions") : t("Switch to business decisions"), icon: "flip",
        run: () => store.setLens(lens === "business" ? "personal" : "business") },
      { id: "rail", group: t("Actions"), label: collapsed ? t("Expand sidebar") : t("Collapse sidebar"), icon: "sidebar", hint: `${mod}B`,
        run: () => store.setRail({ collapsed: !collapsed }) },
      ...(runs.length ? [{ id: "export", group: t("Actions"), label: t("Export all decisions"), icon: "download" as const, run: () => exportJson(runs) }] : []),
    ];
    const actions = all.filter((a) => !q || a.label.toLowerCase().includes(q));
    const found = sortRuns(runs.filter((r) => matches(r, q)), "newest");
    const decisions: Item[] = [...found.filter((r) => r.pinned), ...found.filter((r) => !r.pinned)].slice(0, q ? 12 : 6).map((r) => ({
      id: r.id, group: q ? t("Decisions") : t("Recent"), label: r.title, icon: r.pinned ? "pin" : "chat",
      hint: new Date(r.createdAt).toLocaleDateString(withLocale(locale, intlLocale), { month: "short", day: "numeric" }), run: go(`/app/d/${r.id}`),
    }));
    const ask: Item[] = q.length > 3 ? [{ id: "ask", group: t("Ask"), label: t("Decide: “{q}”", { q: query.trim() }), icon: "spark",
      run: go(`/app?q=${encodeURIComponent(query.trim())}`) }] : [];
    return q ? [...decisions, ...actions, ...ask] : [...actions, ...decisions];
  }, [query, runs, lens, collapsed, router, t, locale, mod]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const run = (item: Item | undefined) => { if (!item) return; onClose(); item.run(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); run(items[active]); }
  };

  let lastGroup = "";
  return (
    <Dialog open={open} onClose={onClose} title={t("Search and commands")} className="o-palette" bare>
      <div className="o-palette__input">
        <Icon name="search" size={18} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
          placeholder={t("Search decisions or type a command")} aria-label={t("Search decisions or type a command")}
          role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={items[active] ? `pi-${active}` : undefined} />
        <Kbd>esc</Kbd>
      </div>
      <ul id="palette-list" ref={list} className="o-palette__list" role="listbox" aria-label={t("Results")}>
        {items.length === 0 && <li className="o-palette__group" role="presentation">{t("Nothing matches.")}</li>}
        {items.map((it, i) => {
          const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
          return [
            head && <li key={`g-${head}`} className="o-palette__group" role="presentation">{head}</li>,
            <li key={it.id} id={`pi-${i}`} data-i={i} role="option" aria-selected={i === active} className="o-palette__item"
              onPointerMove={() => setActive(i)} onClick={() => run(it)}>
              <Icon name={it.icon} size={16} /><span className="o-palette__text">{it.label}</span>
              {it.hint && <span className="o-palette__hint">{it.hint}</span>}
            </li>,
          ];
        })}
      </ul>
      <div className="o-palette__foot"><span>↑↓ {t("to move")}</span><span>↵ {t("to open")}</span><span>{mod}K {t("to close")}</span></div>
    </Dialog>
  );
}
