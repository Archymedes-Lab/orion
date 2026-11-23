// Preferences persistence (runs on the memory fallback in node).
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/db/database.ts";
import {
  addFact,
  getAffinities,
  getFacts,
  recordAffinity,
  removeFact,
} from "../src/db/preferences.ts";

beforeEach(async () => {
  await db.init();
  await db.clearTable("user_preferences");
});

describe("context facts", () => {
  it("add → list → remove round-trips", async () => {
    const fact = await addFact("I work remotely.");
    assert.deepEqual(await getFacts(), [{ id: fact.id, text: "I work remotely." }]);
    await removeFact(fact.id);
    assert.deepEqual(await getFacts(), []);
  });
  it("rejects empty facts", async () => {
    await assert.rejects(() => addFact("   "), /empty/);
  });
  it("removing one fact keeps the rest", async () => {
    const a = await addFact("A");
    await addFact("B");
    await removeFact(a.id);
    assert.deepEqual((await getFacts()).map((f) => f.text), ["B"]);
  });
});

describe("affinities", () => {
  it("counts answers per label", async () => {
    await recordAffinity("Cost");
    await recordAffinity("cost");
    await recordAffinity("Time");
    assert.deepEqual(await getAffinities(), { cost: 2, time: 1 });
  });
  it("starts empty", async () => {
    assert.deepEqual(await getAffinities(), {});
  });
});
