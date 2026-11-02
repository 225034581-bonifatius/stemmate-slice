// Local persistent store for session plans (FR-03, FR-04, SR-01).
//
// The storage object is injected: the browser passes window.localStorage, the tests pass an in-memory fake.
// Plans are kept per profile, so one facilitator on a shared device cannot see another's plans (SR-01).
//
// Team state model (see A3 traceability, section 1.3):
//   DRAFT        being edited, saved on this device
//   PENDING_SYNC "Saved locally (Unsynced)": complete, waiting to sync
//   SYNCING      upload in progress
//   SYNCED       confirmed by the server
//   SYNC_FAILED  last attempt failed, local copy kept, retry possible
//   CONFLICT     server has a different newer version, user must choose

import { validateForDraft, validateForReady, FIELDS } from "./validation.js";

export const STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PENDING_SYNC: "PENDING_SYNC",
  SYNCING: "SYNCING",
  SYNCED: "SYNCED",
  SYNC_FAILED: "SYNC_FAILED",
  CONFLICT: "CONFLICT",
});

export class StoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StoreError";
    this.code = code; // VALIDATION | NOT_FOUND | STORAGE_FULL | BAD_STATE
    this.details = details;
  }
}

export class PlanStore {
  constructor(storage, profileId, { now = () => new Date(), newId = () => crypto.randomUUID() } = {}) {
    if (!profileId) throw new StoreError("BAD_STATE", "A profile is required.");
    this.storage = storage;
    this.profileId = profileId;
    this.now = now;
    this.newId = newId;
    this.key = `stemmate:v1:${profileId}:plans`;
  }

  // ---- reading -----------------------------------------------------------------

  /** Returns a map of id -> plan. A corrupt value is backed up and treated as empty, never thrown. */
  #readAll() {
    const raw = this.storage.getItem(this.key);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      try {
        this.storage.setItem(`${this.key}:corrupt`, raw);
      } catch {
        /* backup is best-effort */
      }
      return {};
    }
  }

  #writeAll(map) {
    try {
      this.storage.setItem(this.key, JSON.stringify(map));
    } catch (err) {
      throw new StoreError("STORAGE_FULL", "This device has no space left to save the plan. Remove old plans and try again.", {
        cause: String(err),
      });
    }
  }

  list() {
    return Object.values(this.#readAll()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  get(id) {
    return this.#readAll()[id] ?? null;
  }

  // ---- writing -----------------------------------------------------------------

  /**
   * Save (create or update) a draft on this device. Any edit sends the plan back to DRAFT and bumps
   * its revision, so the server can tell a retry of the same content from a genuinely new edit.
   */
  saveDraft(input) {
    const { valid, errors } = validateForDraft(input);
    if (!valid) throw new StoreError("VALIDATION", "The draft could not be saved.", { errors });

    const all = this.#readAll();
    const existing = input.id ? all[input.id] : null;
    if (input.id && !existing) throw new StoreError("NOT_FOUND", "That plan no longer exists on this device.");

    const plan = {
      id: existing?.id ?? this.newId(),
      serverId: existing?.serverId ?? null,
      baseVersion: existing?.baseVersion ?? 0,
      revision: (existing?.revision ?? 0) + 1,
      status: STATUS.DRAFT,
      lastError: null,
      conflict: null,
      savedAt: this.now().toISOString(),
    };
    for (const { key } of FIELDS) plan[key] = typeof input[key] === "string" ? input[key].trim() : "";

    all[plan.id] = plan;
    this.#writeAll(all);
    return plan;
  }

  /** Mark a complete plan ready for sync (FR-03: all five categories present). */
  markReady(id) {
    const all = this.#readAll();
    const plan = all[id];
    if (!plan) throw new StoreError("NOT_FOUND", "That plan no longer exists on this device.");
    if (plan.status !== STATUS.DRAFT) throw new StoreError("BAD_STATE", `Only a draft can be completed (this plan is ${plan.status}).`);

    const { valid, errors } = validateForReady(plan);
    if (!valid) throw new StoreError("VALIDATION", "The plan is not complete yet.", { errors });

    plan.status = STATUS.PENDING_SYNC;
    plan.savedAt = this.now().toISOString();
    all[id] = plan;
    this.#writeAll(all);
    return plan;
  }

  /** Update sync-related fields (used by the sync layer). Not for user-edited content. */
  updateSyncState(id, patch) {
    const all = this.#readAll();
    const plan = all[id];
    if (!plan) throw new StoreError("NOT_FOUND", "That plan no longer exists on this device.");
    const allowed = ["status", "serverId", "baseVersion", "lastError", "conflict"];
    for (const key of Object.keys(patch)) {
      if (!allowed.includes(key)) throw new StoreError("BAD_STATE", `Cannot change ${key} through updateSyncState.`);
    }
    Object.assign(plan, patch);
    all[id] = plan;
    this.#writeAll(all);
    return plan;
  }

  /** Take the server's version of a plan (used when the user resolves a conflict in the server's favour). */
  applyServerVersion(id, server) {
    const all = this.#readAll();
    const plan = all[id];
    if (!plan) throw new StoreError("NOT_FOUND", "That plan no longer exists on this device.");
    for (const { key } of FIELDS) plan[key] = server.content[key] ?? "";
    plan.status = STATUS.SYNCED;
    plan.serverId = server.serverId;
    plan.baseVersion = server.version;
    plan.lastError = null;
    plan.conflict = null;
    plan.savedAt = this.now().toISOString();
    all[id] = plan;
    this.#writeAll(all);
    return plan;
  }

  /**
   * Recovery after the tab was closed or the browser crashed mid-sync: a plan stuck in SYNCING
   * goes back to PENDING_SYNC. Nothing is lost because the local copy was never removed.
   */
  recoverInterrupted() {
    const all = this.#readAll();
    const fixed = [];
    for (const plan of Object.values(all)) {
      if (plan.status === STATUS.SYNCING) {
        plan.status = STATUS.PENDING_SYNC;
        fixed.push(plan.id);
      }
    }
    if (fixed.length) this.#writeAll(all);
    return fixed;
  }

  remove(id) {
    const all = this.#readAll();
    if (!all[id]) return false;
    delete all[id];
    this.#writeAll(all);
    return true;
  }

  /** Plans waiting to be sent, oldest first. */
  pending() {
    return this.list()
      .filter((p) => p.status === STATUS.PENDING_SYNC || p.status === STATUS.SYNC_FAILED)
      .reverse();
  }
}
