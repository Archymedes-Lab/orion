import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/db/database.ts";

function fakeStorage(initial = {}) {
  const data = { ...initial };
  let writes = 0;
  return { data, writes: () => writes, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { writes++; data[k] = v; } };
}

describe("browser persistence of the memory store", () => {
  it("restores rows in a new instance, as after a page reload", async () => {
    const storage = fakeStorage();
    const first = new Database(storage);
    await first.init();
    await first.insert("decisions", { id: "d1", title: "Cook or order" });
    await first.upsert("user_preferences", { id: "p1", value: "1" });
    const second = new Database(storage);
    await second.init();
    assert.deepEqual(await second.get("decisions", "d1"), { id: "d1", title: "Cook or order" });
    assert.equal((await second.list("user_preferences")).length, 1);
    await second.clearTable("decisions");
    const third = new Database(storage);
    await third.init();
    assert.deepEqual(await third.list("decisions"), []);
  });
  it("stores a transaction once, and stores nothing new when it rolls back", async () => {
    const storage = fakeStorage();
    const database = new Database(storage);
    await database.init();
    await database.insert("decisions", { id: "kept" });
    const before = storage.writes();
    await database.transaction(["decisions", "options"], async (tx) => {
      await tx.insert("decisions", { id: "d2" });
      await tx.insert("options", { id: "o1" });
    });
    assert.equal(storage.writes(), before + 1);
    await assert.rejects(database.transaction(["decisions"], async (tx) => {
      await tx.insert("decisions", { id: "lost" });
      throw new Error("save failed");
    }));
    const reloaded = new Database(storage);
    await reloaded.init();
    assert.deepEqual((await reloaded.list("decisions")).map((r) => r.id), ["kept", "d2"]);
  });
  it("starts empty on a corrupt store and keeps working when the store is full", async () => {
    const corrupt = new Database(fakeStorage({ "orion.db.v1": "{not json" }));
    await corrupt.init();
    assert.deepEqual(await corrupt.list("decisions"), []);
    const full = new Database({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } });
    await full.init();
    await full.insert("decisions", { id: "d1" });
    assert.equal((await full.list("decisions")).length, 1);
  });
  it("stays purely in memory without a store", async () => {
    const database = new Database(null);
    await database.init();
    await database.insert("decisions", { id: "d1" });
    const other = new Database(null);
    await other.init();
    assert.deepEqual(await other.list("decisions"), []);
  });
});
