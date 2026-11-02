import test from "node:test";
import assert from "node:assert/strict";
import { PlanStore, StoreError, STATUS } from "../client/js/planStore.js";
import { fakeStorage, completePlan, seqId } from "./helpers.js";

const make = (storage = fakeStorage(), profile = "a") => new PlanStore(storage, profile, { newId: seqId });

test("FR-04: a saved draft survives a 'restart' (new store over same storage)", () => {
  const storage = fakeStorage();
  const saved = make(storage).saveDraft({ title: "Draft one" });
  const reopened = make(storage).get(saved.id);
  assert.equal(reopened.title, "Draft one");
  assert.equal(reopened.status, STATUS.DRAFT);
});

test("FR-04: invalid input saves nothing", () => {
  const store = make();
  assert.throws(() => store.saveDraft({ title: "" }), (e) => e instanceof StoreError && e.code === "VALIDATION");
  assert.equal(store.list().length, 0);
});

test("FR-03: incomplete plan cannot be queued; complete plan becomes PENDING_SYNC", () => {
  const store = make();
  const d = store.saveDraft({ title: "T" });
  assert.throws(() => store.markReady(d.id), (e) => e.code === "VALIDATION" && Boolean(e.details.errors.steps));
  const full = store.saveDraft({ ...completePlan(), id: d.id });
  assert.equal(store.markReady(full.id).status, STATUS.PENDING_SYNC);
});

test("editing bumps the revision and returns the plan to DRAFT", () => {
  const store = make();
  const p = store.saveDraft(completePlan());
  store.markReady(p.id);
  const edited = store.saveDraft({ ...completePlan({ title: "New title" }), id: p.id });
  assert.equal(edited.revision, 2);
  assert.equal(edited.status, STATUS.DRAFT);
});

test("SR-01: profiles on the same device cannot see each other's plans", () => {
  const storage = fakeStorage();
  make(storage, "alice").saveDraft({ title: "Alice's plan" });
  assert.equal(make(storage, "bob").list().length, 0);
});

test("full storage gives a clear STORAGE_FULL error and keeps earlier plans", () => {
  const storage = fakeStorage({ quota: 600 });
  const store = make(storage);
  store.saveDraft({ title: "Small" });
  assert.throws(() => store.saveDraft(completePlan({ steps: "y".repeat(1000) })), (e) => e.code === "STORAGE_FULL");
  assert.equal(store.list().length, 1);
});

test("corrupt stored data does not crash the app and is backed up", () => {
  const storage = fakeStorage();
  const store = make(storage);
  storage.setItem(store.key, "{not json");
  assert.deepEqual(store.list(), []);
  assert.equal(storage.getItem(`${store.key}:corrupt`), "{not json");
});
