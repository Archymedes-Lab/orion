"use client";
// Team and settings: the Invest budget, the people on a team board (role and weekly hours drive delegation and the
// overload check), invites, and creating, leaving or deleting boards. Members can be names only: a task can go to
// someone who never opens ORION.
import { useState } from "react";
import { load, type Board } from "@orion/decision-engine/board.ts";
import { Button, Disclosure, Field, Tag } from "@/components/ui";
import { useT } from "@/components/LocaleProvider";
import { newId, useBoards } from "@/lib/board";
import s from "./prioritize.module.css";

const TARGETS = [10, 15, 20, 25, 30, 40, 50];

export function TeamSettings({ b, board }: { b: ReturnType<typeof useBoards>; board: Board }) {
  const t = useT();
  const team = board.kind === "team";
  const me = board.members.find((m) => m.id === b.me);
  const owner = !team || me?.access === "owner";
  const [invite, setInvite] = useState<{ code: string; for?: string } | null>(null);
  const [draft, setDraft] = useState({ name: "", role: "", hours: "" });
  const [create, setCreate] = useState({ name: "", you: "" });
  const [busy, setBusy] = useState(false);
  const hours = new Map(load(board).map((x) => [x.member.id, x]));
  const link = (code: string) => `${typeof location === "undefined" ? "" : location.origin}/app/prioritize?join=${code}`;

  async function makeInvite(memberId?: string) {
    setBusy(true);
    try { const r = await b.invite(memberId); setInvite({ code: r.code, for: memberId }); } catch { /* shown above */ } finally { setBusy(false); }
  }

  return (
    <Disclosure title={team ? t("Team and settings") : t("Settings and teams")} hint={team ? t("{n} people", { n: board.members.length }) : undefined}>
      <div className="stack gap-6">
        <div className="row gap-4" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label={t("Invest target")} hint={t("The share of logged time you want to protect for Invest work.")}>
            <select className="o-select" style={{ maxWidth: 160 }} value={board.investTarget} disabled={!owner} onChange={(e) => b.dispatch({ op: "board.set", investTarget: Number(e.target.value) })}>
              {[...new Set([...TARGETS, board.investTarget])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v}%</option>)}
            </select>
          </Field>
          {team && owner && (
            <Field label={t("Board name")}>
              <input className="o-input" maxLength={60} defaultValue={board.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== board.name) b.dispatch({ op: "board.set", name: v }); }} />
            </Field>
          )}
        </div>

        {team && (
          <div className={s.team}>
            <span className="t-label">{t("People")}</span>
            {board.members.map((m) => {
              const l = hours.get(m.id);
              const canEdit = owner || m.id === b.me;
              return (
                <div key={m.id} className={s.member}>
                  <div className="stack">
                    <span className="t-small ink">{m.name}{m.id === b.me && <span className="faint"> · {t("you")}</span>}</span>
                    <span className="row gap-2">{m.access === "owner" ? <Tag tone="blue">{t("Owner")}</Tag> : null}{"linked" in m && m.linked ? <Tag plain>{t("Has an account")}</Tag> : <Tag plain>{t("Name only")}</Tag>}</span>
                  </div>
                  <input className="o-input" maxLength={80} placeholder={t("Role, e.g. finance and suppliers")} defaultValue={m.role ?? ""} disabled={!canEdit} aria-label={t("Role")}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.role ?? "")) b.dispatch({ op: "member.update", id: m.id, patch: { role: v } }); }} />
                  <div className="stack">
                    <input className="o-input" type="number" min={0} max={80} placeholder={t("h / week")} defaultValue={m.hoursPerWeek ?? ""} disabled={!canEdit} aria-label={t("Hours a week")}
                      onBlur={(e) => { const v = e.target.value === "" ? null : Math.max(0, Math.min(80, Number(e.target.value))); if (v !== (m.hoursPerWeek ?? null)) b.dispatch({ op: "member.update", id: m.id, patch: { hoursPerWeek: v } }); }} />
                    {l && <span className={s.load} data-over={l.over}>{t("{hours} h open", { hours: Math.round(l.hours) })}</span>}
                  </div>
                  <div className="row gap-2">
                    {owner && !("linked" in m && m.linked) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => makeInvite(m.id)}>{t("Invite")}</Button>}
                    {owner && m.access !== "owner" && <Button size="sm" variant="ghost" icon="close" aria-label={t("Remove {name}", { name: m.name })} onClick={() => { if (confirm(t("Remove {name} from the board? Their tasks become unassigned.", { name: m.name }))) b.dispatch({ op: "member.remove", id: m.id }); }} />}
                  </div>
                </div>
              );
            })}

            {owner && (
              <form className={s.member} onSubmit={(e) => {
                e.preventDefault();
                if (!draft.name.trim()) return;
                b.dispatch({ op: "member.add", member: { id: newId(), name: draft.name.trim(), role: draft.role.trim() || undefined, hoursPerWeek: draft.hours === "" ? null : Number(draft.hours) } });
                setDraft({ name: "", role: "", hours: "" });
              }}>
                <input className="o-input" maxLength={60} placeholder={t("Name")} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label={t("Name")} />
                <input className="o-input" maxLength={80} placeholder={t("Role (optional)")} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} aria-label={t("Role")} />
                <input className="o-input" type="number" min={0} max={80} placeholder={t("h / week")} value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} aria-label={t("Hours a week")} />
                <Button size="sm" variant="secondary" type="submit" icon="plus" disabled={!draft.name.trim()}>{t("Add person")}</Button>
              </form>
            )}
            <p className="t-micro muted">{t("Add people by name to hand them tasks, even if they never open ORION. Invite them when they should see the board themselves.")}</p>

            {owner && (
              <div className="stack gap-2">
                <div><Button size="sm" variant="secondary" icon="people" disabled={busy} onClick={() => makeInvite()}>{t("Invite someone new")}</Button></div>
                {invite && (
                  <div className="stack gap-2">
                    <span className="t-small">{invite.for ? t("Send this link to {name}. It works once, for seven days, and needs an ORION account.", { name: board.members.find((m) => m.id === invite.for)?.name ?? "" }) : t("Send this link. It works once, for seven days, and needs an ORION account.")}</span>
                    <span className={s.code}>{link(invite.code)}</span>
                    <div><Button size="sm" variant="ghost" icon="copy" onClick={() => navigator.clipboard?.writeText(link(invite.code))}>{t("Copy link")}</Button></div>
                  </div>
                )}
              </div>
            )}

            <div className="row gap-3">
              {(me?.access !== "owner" || board.members.filter((m) => m.access === "owner").length > 1) && <Button size="sm" variant="ghost" onClick={() => { if (confirm(t("Leave this board?"))) void b.leave(); }}>{t("Leave the board")}</Button>}
              {owner && <Button size="sm" variant="danger" onClick={() => { if (confirm(t("Delete “{name}” for everyone? This can’t be undone.", { name: board.name }))) void b.remove(); }}>{t("Delete the board")}</Button>}
            </div>
          </div>
        )}

        {b.mode === "remote" && (
          <form className="stack gap-3" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try { await b.create(create.name.trim(), create.you.trim()); setCreate({ name: "", you: "" }); } catch { /* shown above */ } finally { setBusy(false); }
          }}>
            <span className="t-label">{t("New team board")}</span>
            <p className="t-micro muted">{t("A shared board for a company or a team: shared goals, owners for each task, delegation by role and weekly hours.")}</p>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              <input className="o-input" style={{ flex: "1 1 200px" }} required maxLength={60} placeholder={t("Board name, e.g. Acme leadership")} value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} aria-label={t("Board name")} />
              <input className="o-input" style={{ flex: "1 1 160px" }} required maxLength={60} placeholder={t("Your name")} value={create.you} onChange={(e) => setCreate({ ...create, you: e.target.value })} aria-label={t("Your name")} />
              <Button variant="secondary" type="submit" icon="plus" disabled={busy || !create.name.trim() || !create.you.trim()}>{t("Create")}</Button>
            </div>
          </form>
        )}
        {b.mode === "local" && <p className="t-micro muted">{t("Team boards need an account on this server.")}</p>}
      </div>
    </Disclosure>
  );
}
