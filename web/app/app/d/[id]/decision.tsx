"use client";
// One decision at its own address. Decisions live on this device, so the page reads them after mount; until then it
// holds the result's shape with skeletons, and a missing id gets a proper empty state rather than a crash.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Toast } from "@/components/client";
import { Editor, Loading, Result } from "@/components/DecisionFlow";
import { useT } from "@/components/LocaleProvider";
import { Icon } from "@/components/brand";
import { InlineEdit, Menu } from "@/components/overlay";
import { RunDetails, useRunMenu } from "@/components/RunActions";
import { Skeleton } from "@/components/ui";
import { score, type DecisionRun } from "@/lib/decide";
import { store, useStore } from "@/lib/store";
import s from "../../workspace.module.css";

export function DecisionPage({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const company = useStore((d) => d.company);
  const saved = useStore((d) => d.runs.find((r) => r.id === id) ?? null);
  const [mounted, setMounted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rescoring, setRescoring] = useState<DecisionRun | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (saved) document.title = `${saved.title} · ORION`; }, [saved]);

  if (!mounted) return <div className={s.page}><div className="stack gap-5"><Skeleton w={240} h={14} /><Skeleton w="70%" h={40} /><Skeleton h={320} r={32} /></div></div>;
  if (!saved) {
    return (
      <div className={s.page}>
        <div className="stack gap-5" style={{ maxWidth: 560, paddingTop: "var(--s-8)" }}>
          <span className="t-label">{t("Not found")}</span>
          <h1 className="t-h1">{t("This decision isn’t on this device.")}</h1>
          <p className="t-body muted">{t("Decisions are saved in the browser where you made them. It may have been deleted, or made on another device.")}</p>
          <div className="row gap-3"><Link href="/app" className="o-btn o-btn--primary">{t("Ask a new question")}</Link><Link href="/app/history" className="o-btn o-btn--ghost">{t("History")}</Link></div>
        </div>
      </div>
    );
  }
  if (rescoring) return <div className={s.page}><Loading question={rescoring.question} stage="scoring" preview={rescoring.options.map((o) => o.label)} onCancel={() => setRescoring(null)} /></div>;

  const update = (next: DecisionRun) => {
    if (next.chosen && !saved.chosen) setToast(t("Saved to your history"));
    store.saveRun(next);
  };
  return (
    <div className={s.page}>
      {editing
        ? <Editor run={saved} onCancel={() => setEditing(false)} onSave={async (next) => {
            setEditing(false);
            setRescoring(next);
            const scored = await score(next, company);
            store.saveRun({ ...next, scores: scored.scores, scenarios: scored.scenarios, source: scored.scores ? "ai" : "duel", notice: scored.notice, duels: {}, chosen: null });
            setRescoring(null);
          }} />
        : <><RunHeader run={saved} /><Result run={saved} onChange={update} onAsk={() => router.push("/app")} onEdit={() => setEditing(true)} /></>}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** The decision's own name and what you can do with it: rename in place, pin, add a note, export, delete. */
function RunHeader({ run }: { run: DecisionRun }) {
  const t = useT();
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [details, setDetails] = useState(false);
  const items = useRunMenu(run, { onDetails: () => setDetails(true) }).map((it) =>
    // Deleting from its own page leaves nothing to show, so go back to asking (Undo still brings it back).
    it !== "sep" && it.icon === "trash" ? { ...it, onSelect: () => { it.onSelect(); router.push("/app"); } } : it);
  return (
    <div className={s.runHead}>
      <div className={s.runTitle}>
        {renaming
          ? <InlineEdit value={run.title} editing onSave={(title) => store.updateRun(run.id, { title })} onDone={() => setRenaming(false)} label={t("Rename")} />
          : <button type="button" onClick={() => setRenaming(true)} title={t("Rename")}><span>{run.title}</span><Icon name="edit" size={14} /></button>}
      </div>
      <button type="button" className="o-icon-btn" aria-pressed={!!run.pinned} aria-label={run.pinned ? t("Unpin") : t("Pin")} title={run.pinned ? t("Unpin") : t("Pin")}
        onClick={() => store.updateRun(run.id, { pinned: !run.pinned })} style={run.pinned ? { color: "var(--blue-bright)" } : undefined}>
        <Icon name="pin" size={16} />
      </button>
      <Menu label={t("Actions for “{title}”", { title: run.title })} items={items} />
      {run.note && <button type="button" className={s.runNote} onClick={() => setDetails(true)}><Icon name="note" size={14} /><span>{run.note}</span></button>}
      <RunDetails run={run} open={details} onClose={() => setDetails(false)} />
    </div>
  );
}
