"use client";
// Things that sit over the page: an action menu, a modal dialog, a confirm, and in-place renaming.
// The menu is fixed-positioned from its trigger so scrolling lists (the rail) never clip it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./brand";
import { useT } from "./LocaleProvider";
import { Button, Kbd } from "./ui";

export type MenuItem = { label: string; icon?: IconName; danger?: boolean; kbd?: string; onSelect: () => void } | "sep";

/** A "⋯" button that opens a short list of actions. Arrow keys move, Escape closes and hands focus back. */
export function Menu({ label, items, icon = "more", className }: { label: string; items: MenuItem[]; icon?: IconName; className?: string }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const r = trigger.current.getBoundingClientRect();
    const p = panel.current.getBoundingClientRect();
    const top = r.bottom + 6 + p.height > window.innerHeight - 8 ? Math.max(8, r.top - 6 - p.height) : r.bottom + 6;
    const left = Math.min(Math.max(8, r.right - p.width), window.innerWidth - p.width - 8);
    setAt({ top, left });
    panel.current.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "pointerdown" && (panel.current?.contains(e.target as Node) || trigger.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      buttons[e.key === "Home" ? 0 : buttons.length - 1]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  };

  return (
    <>
      <button ref={trigger} type="button" className={`o-icon-btn ${className ?? ""}`} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); setAt(null); }}>
        <Icon name={icon} size={16} />
      </button>
      {open && (
        <div ref={panel} className="o-menu" role="menu" aria-label={label} onKeyDown={onKey}
          style={at ? { top: at.top, left: at.left } : { top: 0, left: 0, visibility: "hidden" }}>
          {items.map((it, i) => it === "sep"
            ? <div key={i} className="o-menu__sep" role="separator" />
            : (
              <button key={i} type="button" role="menuitem" className="o-menu__item" data-danger={it.danger || undefined}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.onSelect(); }}>
                {it.icon && <Icon name={it.icon} size={15} />}<span>{it.label}</span>{it.kbd && <Kbd>{it.kbd}</Kbd>}
              </button>
            ))}
        </div>
      )}
    </>
  );
}

/** A modal on the native <dialog>: it traps focus, closes on Escape and returns focus to where it was. */
export function Dialog({ open, onClose, title, children, className, bare }:
  { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string; bare?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`o-dialog ${className ?? ""}`} aria-label={title} onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (bare ? children : (
        <div className="o-dialog__in">
          <div className="o-dialog__head">
            <h2 className="t-h3">{title}</h2>
            <button type="button" className="o-icon-btn" aria-label={t("Close")} onClick={onClose}><Icon name="close" size={16} /></button>
          </div>
          {children}
        </div>
      ))}
    </dialog>
  );
}

/** Asks once before something that can't be taken back easily. */
export function Confirm({ open, title, body, action, danger, onConfirm, onClose }:
  { open: boolean; title: string; body: ReactNode; action: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="t-body muted">{body}</div>
      <div className="o-dialog__foot">
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button variant={danger ? "danger" : "primary"} autoFocus onClick={() => { onConfirm(); onClose(); }}>{action}</Button>
      </div>
    </Dialog>
  );
}

/** Text that turns into an input while renaming. Enter saves, Escape or an empty value cancels. */
export function InlineEdit({ value, editing, onSave, onDone, label, className }:
  { value: string; editing: boolean; onSave: (v: string) => void; onDone: () => void; label: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    if (!editing) return;
    settled.current = false;
    setDraft(value);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.select(); });
  }, [editing, value]);
  if (!editing) return <span className={className}>{value}</span>;
  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    onDone();
  };
  return (
    <input ref={ref} className={`o-inline-edit ${className ?? ""}`} value={draft} aria-label={label} maxLength={120}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); settled.current = true; onDone(); }
      }} />
  );
}
