import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/server.js";
import { completePlan } from "./helpers.js";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "stemmate-")), "plans.json");

async function start(dataFile) {
  const app = createApp({ dataFile });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  return { app, base, stop: () => new Promise((r) => app.close(r)) };
}

const post = (base, body) =>
  fetch(`${base}/api/plans/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const payload = () => ({ id: "p1", revision: 1, baseVersion: 0, ...completePlan() });

test("persistence: data survives a server restart and a repeat request is not duplicated", async () => {
  const file = tmpFile();
  let s = await start(file);
  const first = await post(s.base, payload());
  assert.equal(first.status, 201);
  await s.stop();

  s = await start(file); // restart with the same data file
  const again = await post(s.base, payload());
  const body = await again.json();
  assert.equal(again.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(file, "utf8"))).length, 1);
  await s.stop();
});

test("the client page is served", async () => {
  const s = await start(tmpFile());
  const res = await fetch(`${s.base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Create Session Plan/);
  await s.stop();
});

test("path traversal outside the client folder is refused", async () => {
  const s = await start(tmpFile());
  const status = await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: new URL(s.base).port, path: "/..%2fpackage.json" }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
  });
  assert.equal(status, 403);
  await s.stop();
});

test("invalid JSON gets a clear 400, not a crash", async () => {
  const s = await start(tmpFile());
  const res = await fetch(`${s.base}/api/plans/sync`, { method: "POST", body: "{nope" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "BAD_REQUEST");
  await s.stop();
});

test("an oversized request is refused with 413", async () => {
  const s = await start(tmpFile());
  const res = await post(s.base, { ...payload(), steps: "x".repeat(200_000) });
  assert.equal(res.status, 413);
  await s.stop();
});

test("demo endpoint is off unless the server is started with --demo", async () => {
  const s = await start(tmpFile());
  const res = await fetch(`${s.base}/api/demo/edit/p1`, { method: "POST" });
  assert.equal(res.status, 404);
  await s.stop();
});
