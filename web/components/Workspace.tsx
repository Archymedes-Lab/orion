"use client";
// The workspace frame: rail + one column of work, plus what floats over every page (⌘K palette, Undo, status toast).
// Owns the workspace shortcuts: "/" asks, ⌘K searches, ⌘B folds the rail.
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CommandPalette } from "./CommandPalette";
import { useT } from "./LocaleProvider";
import { Rail } from "./Rail";
import { RAIL, store, useStore, useTrash } from "@/lib/store";
import { clearToast, useToast } from "@/lib/toast";
import s from "@/app/app/workspace.module.css";

const typing = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
};

export function Workspace({ children }: { children: ReactNode }) {
  const router = useRouter();
  const rail = useStore((d) => d.rail);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") { e.preventDefault(); store.setRail({ collapsed: !store.get().rail.collapsed }); return; }
      if (e.key !== "/" || mod || e.altKey || typing(e.target)) return;
      e.preventDefault();
      const bar = document.getElementById("decide");
      if (bar) bar.focus(); else router.push("/app");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const width = rail.collapsed ? RAIL.collapsed : Math.min(RAIL.max, Math.max(RAIL.min, rail.width));
  return (
    <div className={s.shell} data-shell data-collapsed={rail.collapsed} style={{ "--rail-w": `${width}px` } as CSSProperties}>
      <Rail onSearch={() => setPalette(true)} />
      <main id="main" className={s.main}>{children}</main>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Toasts />
    </div>
  );
}

/** Undo for the last delete wins over the plain status line; both clear themselves. */
function Toasts() {
  const t = useT();
  const trash = useTrash();
  const status = useToast();
  useEffect(() => {
    if (!trash) return;
    const id = setTimeout(() => store.dismissTrash(), 7000);
    return () => clearTimeout(id);
  }, [trash]);
  useEffect(() => {
    if (!status) return;
    const id = setTimeout(clearToast, 2600);
    return () => clearTimeout(id);
  }, [status]);
  if (trash?.length) {
    return (
      <div className="o-toast row gap-4" role="status">
        <span>{trash.length === 1 ? t("Deleted “{title}”", { title: trash[0].title }) : t("Deleted {n} decisions", { n: trash.length })}</span>
        <button className="blue" style={{ fontWeight: 500 }} onClick={() => store.undoRemove()}>{t("Undo")}</button>
      </div>
    );
  }
  return status ? <div key={status.at} className="o-toast" role="status">{status.text}</div> : null;
}
