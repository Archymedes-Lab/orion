// Friend input: a shared snapshot friends answer and only the owner can read back.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handler } from "../server/index.ts";
import { memoryStore, storeKind, upstashStore } from "../server/store.ts";
import { tally } from "../src/share/tally.ts";

function call(handle, method, path, body, ip = "203.0.113.5") {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url: path, headers: { host: "orion.example" }, socket: { remoteAddress: ip } });
    const res = {
      headers: {}, setHeader(name, value) { this.headers[name] = value; },
      writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
      end(text) { resolve({ status: this.status, body: text ? JSON.parse(text) : null, headers: this.headers }); },
    };
    handle(req, res).catch(reject);
  });
}

const snapshot = {
  title: "Pizza or tacos",
  options: [{ id: "a", label: "Pizza" }, { id: "b", label: "Tacos" }],
  factors: [{ id: "f1", label: "Craving" }, { id: "f2", label: "Cost" }],
};

describe("sharing a decision with friends", () => {
  it("is off without a store", async () => {
    const h = handler({ env: {}, store: null });
    assert.equal((await call(h, "POST", "/share", snapshot)).status, 404);
  });

  it("lets friends answer and only the owner read the answers", async () => {
    const h = handler({ env: {}, store: memoryStore() });
    const created = await call(h, "POST", "/share", snapshot);
    assert.equal(created.status, 201);
    const { shareId, ownerKey } = created.body;
    assert.match(shareId, /^[A-Za-z0-9_-]{16,}$/);

    const seen = await call(h, "GET", `/share/${shareId}`);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.title, "Pizza or tacos");
    assert.equal(seen.body.ownerKey, undefined, "the friend never sees the owner key");
    assert.equal(seen.body.ownerHash, undefined);

    assert.equal((await call(h, "POST", `/share/${shareId}/respond`, { optionId: "b", factorId: "f1", name: "Sam", note: "Tacos, obviously" })).status, 200);
    assert.equal((await call(h, "POST", `/share/${shareId}/respond`, { optionId: "zzz" })).status, 400, "unknown option");
    assert.equal((await call(h, "POST", `/share/${shareId}/respond`, { optionId: "a", factorId: "nope" })).status, 400, "unknown factor");

    assert.equal((await call(h, "POST", `/share/${shareId}/results`, { ownerKey: "x".repeat(32) })).status, 403);
    const results = await call(h, "POST", `/share/${shareId}/results`, { ownerKey });
    assert.equal(results.status, 200);
    assert.equal(results.body.responses.length, 1);
    assert.equal(results.body.responses[0].note, "Tacos, obviously");

    assert.equal((await call(h, "POST", `/share/${shareId}/delete`, { ownerKey })).status, 200);
    assert.equal((await call(h, "GET", `/share/${shareId}`)).status, 404);
  });

  it("limits answers from one network", async () => {
    const h = handler({ env: {}, store: memoryStore() });
    const { shareId } = (await call(h, "POST", "/share", snapshot)).body;
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await call(h, "POST", `/share/${shareId}/respond`, { optionId: "a" })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
    assert.equal((await call(h, "POST", `/share/${shareId}/respond`, { optionId: "a" }, "198.51.100.7")).status, 200, "another network");
  });

  it("refuses the wrong method and malformed snapshots", async () => {
    const h = handler({ env: {}, store: memoryStore() });
    assert.equal((await call(h, "GET", "/share")).status, 405);
    assert.equal((await call(h, "POST", "/share", { ...snapshot, options: [snapshot.options[0]] })).status, 400);
    assert.equal((await call(h, "POST", "/share", { ...snapshot, options: [snapshot.options[0], snapshot.options[0]] })).status, 400);
  });

  it("tallies answers against the options on screen", () => {
    const result = tally([
      { optionId: "b", factorId: "f1", name: "Sam", note: "Tacos", at: "" },
      { optionId: "b", factorId: "f1", name: "", note: "", at: "" },
      { optionId: "a", factorId: null, name: "", note: "", at: "" },
      { optionId: "gone", factorId: null, name: "", note: "", at: "" },
    ], snapshot.options, snapshot.factors);
    assert.equal(result.total, 3);
    assert.deepEqual(result.votes.map((v) => v.count), [1, 2]);
    assert.deepEqual(result.topFactor, { label: "Craving", count: 2 });
    assert.equal(result.notes.length, 1);
    assert.equal(result.stale, 1);
  });

  it("talks to Upstash Redis with LPUSH/LTRIM/EXPIRE and LRANGE", async () => {
    const sent = [];
    const store = upstashStore("https://db.upstash.io", "tok", async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push([url.replace("https://db.upstash.io", "") || "/", body]);
      return Response.json(url.endsWith("/pipeline") ? body.map(() => ({ result: 1 })) : { result: body[0] === "LRANGE" ? ["b", "a"] : null });
    });
    await store.push("k", "b", 50, 600);
    assert.deepEqual(await store.list("k"), ["b", "a"]);
    assert.deepEqual(sent, [
      ["/pipeline", [["LPUSH", "k", "b"], ["LTRIM", "k", 0, 49], ["EXPIRE", "k", 600]]],
      ["/", ["LRANGE", "k", 0, -1]],
    ]);
  });

  it("names the database the environment configures", () => {
    assert.equal(storeKind({ KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" }), "upstash");
    assert.equal(storeKind({ ORION_ACCOUNT_STORE: "memory" }), "memory");
    assert.equal(storeKind({}), "none");
  });
});
