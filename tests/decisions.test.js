import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { useSession } from "../src/store/session.ts";
import { db } from "../src/db/database.ts";
import { TABLES, deleteDecision, eraseAllData, exportData, listDecisions, matchesQuery } from "../src/db/decisions.ts";
import { addFact, clearAffinities, getAffinities, getFacts, recordAffinity, removeFact } from "../src/db/preferences.ts";

beforeEach(async () => {
  useSession.setState({ privateMode: false });
  useSession.getState().reset();
  await db.init();
  for (const table of TABLES) await db.clearTable(table);
});

async function save(input, pick = 0) {
  await useSession.getState().submit(input);
  const s = useSession.getState();
  s.duel(s.factors[0].id, s.options[0].id);
  await useSession.getState().commit(pick === null ? null : s.options[pick].id);
  const id = s.decisionId;
  useSession.getState().reset();
  return { id, options: s.options };
}

describe("saved decisions", () => {
  it("lists decisions with the option that was chosen", async () => {
    const cook = await save("Should I cook or order food?");
    await save("Take the bus or call a taxi?", null);
    const rows = await listDecisions();
    assert.equal(rows.length, 2);
    const decided = rows.find((r) => r.id === cook.id);
    assert.equal(decided.status, "decided");
    assert.equal(decided.chosen, cook.options[0].label);
    assert.equal(decided.category, "Food");
    const open = rows.find((r) => r.id !== cook.id);
    assert.equal(open.status, "open");
    assert.equal(open.chosen, null);
  });

  it("matches a search on every word, across title, category and choice", async () => {
    const row = { id: "d", title: "Cook or order food", category: "Food", stakes: "tiny", status: "decided", createdAt: "", chosen: "Cook" };
    assert.equal(matchesQuery(row, "order COOK"), true);
    assert.equal(matchesQuery(row, "food"), true);
    assert.equal(matchesQuery(row, "taxi"), false);
    assert.equal(matchesQuery(row, "   "), true);
  });

  it("deletes one decision with all of its rows and leaves the others intact", async () => {
    const gone = await save("Should I cook or order food?");
    const kept = await save("Take the bus or call a taxi?");
    await db.insert("decision_outcomes", { id: "out_1", decision_id: gone.id, rating: "Good", created_at: "2026-01-01" });
    await recordAffinity("Cost");
    await deleteDecision(gone.id);

    assert.equal(await db.get("decisions", gone.id), null);
    assert.equal(await db.get("decision_metadata", gone.id), null);
    for (const table of ["options", "factors", "questions", "decision_outcomes"]) {
      assert.equal((await db.list(table)).filter((r) => r.decision_id === gone.id).length, 0, table);
    }
    const goneOptions = new Set(gone.options.map((o) => o.id));
    assert.equal((await db.list("option_factor_values")).filter((v) => goneOptions.has(v.option_id)).length, 0);

    assert.equal(await useSession.getState().loadDecision(kept.id), true);
    assert.equal(useSession.getState().options.length, kept.options.length);
    assert.ok((await db.list("option_factor_values")).length > 0);
    assert.deepEqual(await getAffinities(), { cost: 1 });
    assert.equal(await useSession.getState().loadDecision(gone.id), false);
  });

  it("exports every table and erases everything on request", async () => {
    const { id } = await save("Should I cook or order food?");
    await addFact("I prefer walking");
    const data = await exportData(new Date("2026-10-03T00:00:00Z"));
    assert.equal(data.app, "orion");
    assert.equal(data.exportedAt, "2026-10-03T00:00:00.000Z");
    assert.deepEqual(Object.keys(data.tables).sort(), [...TABLES].sort());
    assert.equal(data.tables.decisions[0].id, id);
    assert.equal(data.tables.user_preferences.length, 1);
    assert.doesNotThrow(() => JSON.stringify(data));

    await eraseAllData();
    for (const table of TABLES) assert.deepEqual(await db.list(table), [], table);
  });
});

describe("preferences", () => {
  it("removes one fact without touching affinities, and clears affinities without touching facts", async () => {
    const a = await addFact("I prefer walking");
    const b = await addFact("I am vegetarian");
    await recordAffinity("Cost");
    await recordAffinity("Time");
    await removeFact(a.id);
    assert.deepEqual((await getFacts()).map((f) => f.id), [b.id]);
    await removeFact("affinity:cost");
    assert.deepEqual(await getAffinities(), { cost: 1, time: 1 });
    await clearAffinities();
    assert.deepEqual(await getAffinities(), {});
    assert.equal((await getFacts()).length, 1);
  });
});
