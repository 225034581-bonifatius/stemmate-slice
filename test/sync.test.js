import test from "node:test";
import assert from "node:assert/strict";
import { PlanStore, STATUS } from "../client/js/planStore.js";
import { syncPlan, syncAll, resolveConflict, buildPayload } from "../client/js/sync.js";
import { createSyncService, memoryRepo } from "../server/syncService.js";
import { fakeStorage, completePlan, seqId } from "./helpers.js";

/** A fetch that talks straight to the real server logic (no network), with hooks to break it. */
function setup() {
  const service = createSyncService(memoryRepo());
  const store = new PlanStore(fakeStorage(), "a", { newId: seqId });
  const calls = [];
  const behaviour = { mode: "ok", beforeRespond: null };
  const fetchFn = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (behaviour.mode === "down") throw new TypeError("Failed to fetch");
    if (behaviour.mode === "5xx") return { status: 503, json: async () => ({ code: "SERVER_ERROR" }) };
    const out = service.sync(body);
    if (behaviour.beforeRespond) behaviour.beforeRespond();
    if (behaviour.mode === "lost-response") throw new TypeError("Failed to fetch"); // server saved it, client never heard
    return { status: out.status, json: async () => out.body };
  };
  const queued = (over) => {
    const d = store.saveDraft(completePlan(over));
    return store.markReady(d.id);
  };
  return { service, store, fetchFn, calls, behaviour, queued };
}

test("FR-05: a queued plan syncs once and ends as SYNCED with a server id", async () => {
  const { service, store, fetchFn, queued } = setup();
  const plan = queued();
  const r = await syncPlan(store, plan.id, { fetchFn });
  assert.equal(r.outcome, "synced");
  const after = store.get(plan.id);
  assert.equal(after.status, STATUS.SYNCED);
  assert.match(after.serverId, /^srv-/);
  assert.equal(service.count(), 1);
});

test("FR-05: retrying after a lost response creates no duplicate", async () => {
  const { service, store, fetchFn, behaviour, queued } = setup();
  const plan = queued();
  behaviour.mode = "lost-response"; // server saved it, but the reply never arrived
  assert.equal((await syncPlan(store, plan.id, { fetchFn })).outcome, "failed");
  assert.equal(store.get(plan.id).status, STATUS.SYNC_FAILED);

  behaviour.mode = "ok";
  const retry = await syncPlan(store, plan.id, { fetchFn });
  assert.equal(retry.outcome, "synced");
  assert.equal(retry.duplicate, true);
  assert.equal(service.count(), 1);
  assert.equal(service.get(plan.id).version, 1);
});

test("FR-05/FR-06: server down -> SYNC_FAILED, local data kept, retry succeeds later", async () => {
  const { store, fetchFn, behaviour, queued } = setup();
  const plan = queued({ title: "Keep me" });
  behaviour.mode = "down";
  await syncPlan(store, plan.id, { fetchFn });
  const failed = store.get(plan.id);
  assert.equal(failed.status, STATUS.SYNC_FAILED);
  assert.equal(failed.title, "Keep me");
  assert.match(failed.lastError, /still saved on this device/);

  behaviour.mode = "ok";
  assert.equal((await syncPlan(store, plan.id, { fetchFn })).outcome, "synced");
  assert.equal(store.get(plan.id).lastError, null);
});

test("FR-06: a server error (5xx) is reported as SYNC_FAILED, not lost", async () => {
  const { store, fetchFn, behaviour, queued } = setup();
  const plan = queued();
  behaviour.mode = "5xx";
  await syncPlan(store, plan.id, { fetchFn });
  assert.equal(store.get(plan.id).status, STATUS.SYNC_FAILED);
  assert.equal(store.pending().length, 1);
});

test("FR-06: a conflict never overwrites either side; 'keep mine' then syncs on top", async () => {
  const { service, store, fetchFn, queued } = setup();
  const plan = queued({ title: "Original" });
  await syncPlan(store, plan.id, { fetchFn });
  service.demoEdit(plan.id); // someone else changes it on the server (version 2)

  store.saveDraft({ ...completePlan({ title: "My edit" }), id: plan.id });
  store.markReady(plan.id);
  assert.equal((await syncPlan(store, plan.id, { fetchFn })).outcome, "conflict");

  const conflicted = store.get(plan.id);
  assert.equal(conflicted.status, STATUS.CONFLICT);
  assert.equal(conflicted.title, "My edit"); // local untouched
  assert.match(service.get(plan.id).content.title, /edited on another device/); // server untouched

  resolveConflict(store, plan.id, "mine");
  assert.equal((await syncPlan(store, plan.id, { fetchFn })).outcome, "synced");
  assert.equal(service.get(plan.id).content.title, "My edit");
  assert.equal(service.get(plan.id).version, 3);
});

test("FR-06: choosing the server's version replaces the local copy and marks it SYNCED", async () => {
  const { service, store, fetchFn, queued } = setup();
  const plan = queued({ title: "Original" });
  await syncPlan(store, plan.id, { fetchFn });
  service.demoEdit(plan.id);
  store.saveDraft({ ...completePlan({ title: "My edit" }), id: plan.id });
  store.markReady(plan.id);
  await syncPlan(store, plan.id, { fetchFn });

  resolveConflict(store, plan.id, "server");
  const after = store.get(plan.id);
  assert.equal(after.status, STATUS.SYNCED);
  assert.match(after.title, /edited on another device/);
});

test("SUS-01: the request carries only the plan's own fields", async () => {
  const { store, fetchFn, calls, queued } = setup();
  const plan = queued();
  await syncPlan(store, plan.id, { fetchFn });
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    "baseVersion", "id", "inclusion", "materials", "revision", "safety", "steps", "title",
  ]);
  assert.deepEqual(Object.keys(buildPayload(plan)).sort(), Object.keys(calls[0]).sort());
});

test("recovery: a plan stuck in SYNCING after a crash goes back to the queue", () => {
  const { store, queued } = setup();
  const plan = queued();
  store.updateSyncState(plan.id, { status: STATUS.SYNCING }); // tab closed mid-sync
  assert.deepEqual(store.recoverInterrupted(), [plan.id]);
  assert.equal(store.get(plan.id).status, STATUS.PENDING_SYNC);
});

test("an edit made while a sync is in flight is not marked as synced", async () => {
  const { store, fetchFn, behaviour, queued } = setup();
  const plan = queued({ title: "v1" });
  behaviour.beforeRespond = () => store.saveDraft({ ...completePlan({ title: "v2 typed during sync" }), id: plan.id });
  const r = await syncPlan(store, plan.id, { fetchFn });
  assert.equal(r.outcome, "superseded");
  const after = store.get(plan.id);
  assert.equal(after.title, "v2 typed during sync");
  assert.equal(after.status, STATUS.DRAFT);
  assert.equal(after.baseVersion, 1); // next sync will not raise a false conflict
});

test("FR-04: offline -> nothing is sent and every plan stays queued", async () => {
  const { store, fetchFn, calls, queued } = setup();
  queued({ title: "One" });
  queued({ title: "Two" });
  const r = await syncAll(store, { fetchFn, isOnline: () => false });
  assert.equal(r.offline, true);
  assert.equal(calls.length, 0);
  assert.equal(store.pending().length, 2);
});

test("back online: syncAll sends the whole queue", async () => {
  const { service, store, fetchFn, queued } = setup();
  queued({ title: "One" });
  queued({ title: "Two" });
  const r = await syncAll(store, { fetchFn, isOnline: () => true });
  assert.equal(r.results.length, 2);
  assert.equal(service.count(), 2);
  assert.equal(store.pending().length, 0);
});

test("server rejects an incomplete plan and stores nothing", () => {
  const service = createSyncService(memoryRepo());
  const out = service.sync({ id: "x", revision: 1, baseVersion: 0, title: "Only a title" });
  assert.equal(out.status, 422);
  assert.ok(out.body.errors.steps);
  assert.equal(service.count(), 0);
});

test("server rejects malformed requests", () => {
  const service = createSyncService(memoryRepo());
  assert.equal(service.sync(null).status, 400);
  assert.equal(service.sync({ id: "", revision: 1, baseVersion: 0 }).status, 400);
  assert.equal(service.sync({ id: "x", revision: "1", baseVersion: 0 }).status, 400);
});
