// Client sync, offline queue and recovery (FR-05, FR-06, SUS-01).
// fetchFn is injected, so tests can simulate a dead network, a slow server or a lost response.
//
// Golden rule: the local copy is never deleted or overwritten until the server confirms (FR-05).

import { STATUS, StoreError } from "./planStore.js";
import { FIELDS } from "./validation.js";

const FRIENDLY = {
  network: "Could not reach the server. Your plan is still saved on this device. Try again when you are online.",
  server: "The server had a problem. Your plan is still saved on this device. Please try again.",
  rejected: "The server could not accept this plan. Check it is complete, then try again.",
};

/** SUS-01: send only what the server needs for this one plan: no profile, no other plans, no device info. */
export function buildPayload(plan) {
  const payload = { id: plan.id, revision: plan.revision, baseVersion: plan.baseVersion };
  for (const { key } of FIELDS) payload[key] = plan[key];
  return payload;
}

export async function syncPlan(store, id, { fetchFn, timeoutMs = 8000 }) {
  const plan = store.get(id);
  if (!plan) return { outcome: "missing" };
  if (plan.status !== STATUS.PENDING_SYNC && plan.status !== STATUS.SYNC_FAILED) return { outcome: "skipped" };

  const sentRevision = plan.revision;
  store.updateSyncState(id, { status: STATUS.SYNCING, lastError: null });

  // After the await, re-read the plan: the user may have edited it while the request was in flight.
  const finish = (patch, outcome, extra = {}) => {
    const current = store.get(id);
    if (!current) return { outcome: "missing" };
    if (current.revision !== sentRevision) {
      // Edited meanwhile (now a draft with newer content). Keep the new edit; just remember the server position.
      const keep = {};
      if ("serverId" in patch) keep.serverId = patch.serverId;
      if ("baseVersion" in patch) keep.baseVersion = patch.baseVersion;
      if (Object.keys(keep).length) store.updateSyncState(id, keep);
      return { outcome: "superseded" };
    }
    store.updateSyncState(id, patch);
    return { outcome, ...extra };
  };

  let res;
  try {
    res = await fetchFn("/api/plans/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(plan)),
      signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch {
    return finish({ status: STATUS.SYNC_FAILED, lastError: FRIENDLY.network }, "failed");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page: handled by status below */
  }

  if (res.status === 200 || res.status === 201) {
    return finish(
      { status: STATUS.SYNCED, serverId: data.serverId, baseVersion: data.version, lastError: null, conflict: null },
      "synced",
      { duplicate: Boolean(data.duplicate) }
    );
  }
  if (res.status === 409 && data?.server) {
    return finish({ status: STATUS.CONFLICT, conflict: { server: data.server }, lastError: null }, "conflict");
  }
  if (res.status >= 500) return finish({ status: STATUS.SYNC_FAILED, lastError: FRIENDLY.server }, "failed");
  return finish({ status: STATUS.SYNC_FAILED, lastError: FRIENDLY.rejected }, "failed");
}

/** Send every waiting plan, oldest first. When offline nothing is attempted and everything stays queued. */
export async function syncAll(store, { fetchFn, isOnline = () => true, timeoutMs } = {}) {
  if (!isOnline()) return { offline: true, results: [] };
  const results = [];
  for (const plan of store.pending()) {
    results.push({ id: plan.id, ...(await syncPlan(store, plan.id, { fetchFn, timeoutMs })) });
  }
  return { offline: false, results };
}

/** User's choice after a conflict: "mine" re-sends the local version on top of the server's; "server" takes theirs. */
export function resolveConflict(store, id, choice) {
  const plan = store.get(id);
  if (!plan || plan.status !== STATUS.CONFLICT || !plan.conflict) {
    throw new StoreError("BAD_STATE", "This plan has no conflict to resolve.");
  }
  if (choice === "mine") {
    return store.updateSyncState(id, {
      status: STATUS.PENDING_SYNC,
      baseVersion: plan.conflict.server.version,
      conflict: null,
      lastError: null,
    });
  }
  if (choice === "server") return store.applyServerVersion(id, plan.conflict.server);
  throw new StoreError("BAD_STATE", "Choose either your version or the server's version.");
}
