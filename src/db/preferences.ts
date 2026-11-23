// §16–17 user model, persisted. Two kinds of rows in user_preferences:
// - context facts: key "context_fact", value = free text, source "manual".
// - factor affinity: id/key "affinity:<label>", value = "N" answer count.
// Affinities are learned only from the user's own "X matters most" answers —
// no invisible profiling; everything here is shown on the You screen.
import { db } from "./database.ts";
import { uid } from "../decision-engine/normalize.ts";

export interface ContextFact {
  id: string;
  text: string;
}

const FACT_KEY = "context_fact";
const affinityKey = (label: string): string => `affinity:${label.toLowerCase()}`;

export async function getFacts(): Promise<ContextFact[]> {
  await db.init();
  return (await db.list("user_preferences"))
    .filter((r) => r.key === FACT_KEY)
    .map((r) => ({ id: String(r.id), text: String(r.value) }));
}

export async function addFact(text: string): Promise<ContextFact> {
  const fact = { id: uid("fact"), text: text.trim() };
  if (!fact.text) throw new Error("empty fact");
  await db.init();
  await db.insert("user_preferences", {
    id: fact.id,
    user_id: "local",
    key: FACT_KEY,
    value: fact.text,
    confidence: 1,
    source: "manual",
  });
  return fact;
}

export async function removeFact(id: string): Promise<void> {
  await db.init();
  // Only context facts are deletable here; an affinity row with the same id is left alone.
  if ((await db.get("user_preferences", id))?.key === FACT_KEY) await db.deleteWhere("user_preferences", "id", id);
}

/** Forgets every learned "X matters most" count. */
export async function clearAffinities(): Promise<void> {
  await db.init();
  for (const row of await db.list("user_preferences")) {
    if (String(row.key).startsWith("affinity:")) await db.deleteWhere("user_preferences", "id", String(row.id));
  }
}

/** label → times the user said it matters most. */
export async function getAffinities(): Promise<Record<string, number>> {
  await db.init();
  const out: Record<string, number> = {};
  for (const r of await db.list("user_preferences")) {
    const key = String(r.key);
    if (key.startsWith("affinity:")) {
      out[key.slice("affinity:".length)] = Number(r.value) || 0;
    }
  }
  return out;
}

/** Record one "X matters most" answer. Fire-and-forget safe. */
export async function recordAffinity(label: string): Promise<void> {
  const key = affinityKey(label);
  await db.init();
  const rows = await db.list("user_preferences");
  const prev = rows.find((r) => String(r.key) === key);
  const count = (prev ? Number(prev.value) : 0) + 1;
  await db.upsert("user_preferences", {
    id: key,
    user_id: "local",
    key,
    value: String(count),
    confidence: Math.min(1, 0.5 + count * 0.1),
    source: "answers",
  });
}
