"use client";
// What you can do to one saved decision, wherever it is listed: the rail, history, the command palette and its own page.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { DecisionRun } from "@/lib/decide";
import { download, exportJson } from "@/lib/history";
import { recordMarkdown } from "@/lib/followup";
import { intlLocale, withLocale } from "@orion/i18n/index.ts";
import { store } from "@/lib/store";
import { toast } from "@/lib/toast";
import { useLang, useT } from "./LocaleProvider";
import { Dialog, type MenuItem } from "./overlay";
import { Button, Field } from "./ui";
import { Segmented } from "./client";

/** The menu items for one decision. `onRename` switches its row to in-place renaming; `onDetails` opens the editor. */
export function useRunMenu(run: DecisionRun, { onRename, onDetails }: { onRename?: () => void; onDetails: () => void }): MenuItem[] {
  const t = useT();
  const locale = useLang();
  const router = useRouter();
  return [
    ...(onRename ? [{ label: t("Rename"), icon: "edit" as const, onSelect: onRename }] : []),
    { label: t("Edit details"), icon: "note", onSelect: onDetails },
    { label: run.pinned ? t("Unpin") : t("Pin"), icon: "pin", onSelect: () => store.updateRun(run.id, { pinned: !run.pinned }) },
    "sep",
    { label: t("Ask again"), icon: "redo", onSelect: () => router.push(`/app?${run.lens === "business" ? "lens=business&" : ""}q=${encodeURIComponent(run.question)}`) },
    { label: t("Copy link"), icon: "link", onSelect: () => {
      navigator.clipboard?.writeText(`${location.origin}/app/d/${run.id}`).then(() => toast(t("Link copied")), () => toast(t("Couldn’t copy the link")));
    } },
    { label: t("Decision record"), icon: "note", onSelect: () => {
      const date = (ms: number) => new Date(ms).toLocaleDateString(withLocale(locale, intlLocale), { day: "numeric", month: "long", year: "numeric" });
      download(`${run.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "decision"}.md`, withLocale(locale, () => recordMarkdown(run, date)), "text/markdown");
    } },
    { label: t("Export"), icon: "download", onSelect: () => exportJson([run]) },
    "sep",
    { label: t("Delete"), icon: "trash", danger: true, onSelect: () => store.removeRun(run.id) },
  ];
}

/** Edit what you wrote about a decision: its title, a note, what you chose and which lens it belongs to. */
export function RunDetails({ run, open, onClose }: { run: DecisionRun; open: boolean; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(run.title);
  const [note, setNote] = useState(run.note ?? "");
  const [chosen, setChosen] = useState(run.chosen ?? "");
  const [lens, setLens] = useState(run.lens);
  useEffect(() => {
    if (!open) return;
    setTitle(run.title); setNote(run.note ?? ""); setChosen(run.chosen ?? ""); setLens(run.lens);
  }, [open, run]);
  const save = () => {
    store.updateRun(run.id, { title: title.trim() || run.title, note: note.trim() || undefined, chosen: chosen || null, lens });
    toast(t("Changes saved"));
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={t("Edit details")}>
      <form className="stack gap-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="t-small muted">{run.question}</p>
        <Field label={t("Title")}>
          <input className="o-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("You chose")} hint={t("Change it if you went another way. ORION’s call stays as it was.")}>
          <select className="o-select" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="">{t("Undecided")}</option>
            {run.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        <Field label={t("Note")} hint={t("Only you see this. What happened, what you’d tell yourself next time.")}>
          <textarea className="o-textarea" rows={4} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="stack gap-2">
          <span className="o-field__label">{t("Kind")}</span>
          <Segmented label={t("Kind")} value={lens} onChange={setLens}
            options={[{ value: "personal", label: t("Personal") }, { value: "business", label: t("Business") }]} />
        </div>
        <div className="o-dialog__foot">
          <Button type="button" variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
          <Button type="submit" variant="primary">{t("Save")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
