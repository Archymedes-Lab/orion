// The downside check: each option's realistic worst case and whether it can be undone, from Jev, with every question
// asked twice in opposite directions so a judge that leans one way cancels out.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handler } from "../server/index.ts";
import { downsideWithJev, WORST_LEVELS } from "../server/downside.ts";

const request = { context: "Quit my job to start a company, or stay another year?", stakes: "major", options: [{ id: "quit", label: "Quit now" }, { id: "stay", label: "Stay a year" }] };

/** A fake Jev with a bias: it adds `tilt` levels to whatever scale it is shown, and leans "yes" on every Noul by `lean`. */
function fakeJev({ tilt = 0, lean = 0 } = {}) {
  const truth = { quit: { worst: 3, undo: 0.2 }, stay: { worst: 1, undo: 0.9 } };
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    const option = body.state.option === "Quit now" ? "quit" : "stay";
    const t = truth[option];
    const top = WORST_LEVELS.length - 1;
    const answers = {
      worst: { type: "score", score: t.worst + tilt, legend: {}, probabilities: {}, confidence: 0.8 },
      worstReversed: { type: "score", score: top - t.worst + tilt, legend: {}, probabilities: {}, confidence: 0.8 },
      undo: { type: "noul", noul: Math.min(1, t.undo + lean) },
      locked: { type: "noul", noul: Math.min(1, 1 - t.undo + lean) },
    };
    return Response.json({ model: "jev-test", answers, usage: { input_tokens: 1, output_tokens: 1 } });
  };
}

describe("downside", () => {
  it("reads the worst case and reversibility per option", async () => {
    const res = await downsideWithJev(request, { apiKey: "k", fetchImpl: fakeJev() });
    assert.deepEqual(res.options.map((o) => [o.optionId, o.worst, o.reversible]), [["quit", 3, 0.2], ["stay", 1, 0.9]]);
  });

  it("cancels a judge that leans one way on every scale", async () => {
    const res = await downsideWithJev(request, { apiKey: "k", fetchImpl: fakeJev({ tilt: 0.6, lean: 0.08 }) });
    assert.deepEqual(res.options.map((o) => o.worst), [3, 1], "a constant tilt cancels across the reversed scale");
    assert.deepEqual(res.options.map((o) => o.reversible), [0.2, 0.9], "a constant yes-lean cancels across the negated question");
  });

  it("is served by the API, open to guests, and answers 503 without Jev", async () => {
    const call = (handle) => new Promise((resolve, reject) => {
      const req = Readable.from([JSON.stringify(request)]);
      Object.assign(req, { method: "POST", url: "/decision/downside", headers: { host: "orion.example" }, socket: { remoteAddress: "198.51.100.3" } });
      const res = { writeHead(status) { this.status = status; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } };
      handle(req, res).catch(reject);
    });
    const withJev = await call(handler({ env: { TYPESAFE_API_KEY: "k" }, fetchImpl: fakeJev() }));
    assert.equal(withJev.status, 200);
    assert.equal(withJev.body.options.length, 2);
    const without = await call(handler({ env: {} }));
    assert.equal(without.status, 503);
  });
});
