import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { handler } from "../server/index.ts";
import { rateLimiter } from "../server/http.ts";

/** Runs one request through the handler and collects status, headers and body. */
function call(handle, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url: path, headers });
    const chunks = [];
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.writeHead = (status, head = {}) => { res.status = status; res.head = head; return res; };
    res.on("finish", () => resolve({ status: res.status, headers: res.head, text: Buffer.concat(chunks).toString() }));
    handle(req, res).catch(reject);
  });
}
const env = { ORION_ALLOWED_ORIGINS: "https://app.example" };

describe("server responses", () => {
  it("sends security headers and never caches API answers", async () => {
    const res = await call(handler({ env }), { path: "/health" });
    assert.equal(res.status, 200);
    assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
    assert.equal(res.headers["X-Frame-Options"], "DENY");
    assert.equal(res.headers["Cache-Control"], "no-store");
    const health = JSON.parse(res.text);
    assert.equal(health.ok, true);
    assert.equal(health.aiConfigured, false);
  });

  it("allows listed origins and the page it serves itself, and refuses others", async () => {
    const handle = handler({ env });
    const listed = await call(handle, { path: "/health", headers: { origin: "https://app.example", host: "api.example" } });
    assert.equal(listed.headers["Access-Control-Allow-Origin"], "https://app.example");
    const same = await call(handle, { path: "/health", headers: { origin: "https://orion.example", host: "orion.example" } });
    assert.equal(same.status, 200);
    const other = await call(handle, { path: "/health", headers: { origin: "https://evil.example", host: "orion.example" } });
    assert.equal(other.status, 403);
    assert.equal(other.headers["Access-Control-Allow-Origin"], undefined);
  });

  it("answers 405 to a GET on an API path and 404 elsewhere", async () => {
    const handle = handler({ env });
    assert.equal((await call(handle, { path: "/decision/parse" })).status, 405);
    assert.equal((await call(handle, { path: "/nope" })).status, 404);
  });

  it("limits each client and tells it when to retry", async () => {
    const handle = handler({ env: { ...env, ORION_RATE_LIMIT: "2" } });
    const post = () => call(handle, { method: "POST", path: "/decision/parse", body: { input: "Cook or order food?" } });
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 200);
    const third = await post();
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers["Retry-After"]) >= 1);
  });

  it("counts clients separately and opens a new window after the old one ends", () => {
    let now = 0;
    const limited = rateLimiter(1, 1000, () => now);
    assert.equal(limited("a").allowed, true);
    assert.equal(limited("a").allowed, false);
    assert.equal(limited("b").allowed, true);
    now = 1000;
    assert.equal(limited("a").allowed, true);
    assert.equal(rateLimiter(0)("a").allowed, true);
  });
});

describe("serving the web build", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-static-"));
  mkdirSync(join(dir, "_expo", "static", "js"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<html>orion</html>");
  writeFileSync(join(dir, "_expo", "static", "js", "entry-abc.js"), "console.log(1)");
  writeFileSync(join(dir, "..", "orion-secret.txt"), "secret");
  const handle = handler({ env, staticDir: dir });

  it("serves the page with a content security policy and assets with long caching", async () => {
    const page = await call(handle, { path: "/" });
    assert.equal(page.status, 200);
    assert.equal(page.text, "<html>orion</html>");
    assert.match(page.headers["Content-Security-Policy"], /default-src 'self'/);
    assert.equal(page.headers["Cache-Control"], "no-cache");
    const script = await call(handle, { path: "/_expo/static/js/entry-abc.js" });
    assert.match(script.headers["Content-Type"], /javascript/);
    assert.match(script.headers["Cache-Control"], /immutable/);
  });

  it("returns the page for client-side routes and 404 for missing assets", async () => {
    assert.equal((await call(handle, { path: "/history" })).text, "<html>orion</html>");
    assert.equal((await call(handle, { path: "/decision/dec_1/analysis" })).text, "<html>orion</html>");
    assert.equal((await call(handle, { path: "/missing.js" })).status, 404);
  });

  it("does not serve files outside the build directory", async () => {
    for (const path of ["/../orion-secret.txt", "/%2e%2e/orion-secret.txt", "/..%2forion-secret.txt"]) {
      const res = await call(handle, { path });
      assert.notEqual(res.text, "secret", path);
    }
  });

  it("still answers the API when a build is being served", async () => {
    const res = await call(handle, { method: "POST", path: "/decision/parse", body: { input: "Cook or order food?" } });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).options.length, 2);
  });
});
