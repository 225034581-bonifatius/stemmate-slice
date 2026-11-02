// Browser wiring: form <-> validation <-> PlanStore <-> sync.
// Uses textContent only (never innerHTML), so plan text cannot inject markup.
import { PlanStore, StoreError, STATUS } from "./planStore.js";
import { FIELDS } from "./validation.js";
import { syncPlan, syncAll, resolveConflict } from "./sync.js";

const $ = (id) => document.getElementById(id);
const LABELS = {
  DRAFT: "✎ Draft (saved on this device)",
  PENDING_SYNC: "⏳ Saved locally (Unsynced)",
  SYNCING: "⟳ Syncing…",
  SYNCED: "✔ Synced",
  SYNC_FAILED: "✖ Sync failed – kept on this device",
  CONFLICT: "⚠ Conflict – needs your choice",
};

let store = null;
let demoMode = false;

// The only place the network is touched. "Pretend offline" and the demo delay live here, away from the logic.
const fetchFn = async (url, opts) => {
  if (demoMode) await new Promise((r) => setTimeout(r, 700)); // so the Syncing state can be seen
  if ($("demo-fail").checked) throw new TypeError("Failed to fetch");
  return fetch(url, opts);
};

const isOnline = () => navigator.onLine;

function openProfile(name) {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "default";
  store = new PlanStore(window.localStorage, id);
  const recovered = store.recoverInterrupted();
  clearForm();
  render();
  say(
    recovered.length
      ? `Profile "${name.trim() || "default"}" opened. ${recovered.length} plan(s) that were interrupted mid-sync are back in the queue.`
      : `Profile "${name.trim() || "default"}" opened.`
  );
}

function say(msg) { $("status").textContent = msg; }

function readForm() {
  const plan = { id: $("plan-id").value || undefined };
  for (const { key } of FIELDS) plan[key] = $(key).value;
  return plan;
}

function fillForm(plan) {
  $("plan-id").value = plan.id;
  for (const { key } of FIELDS) $(key).value = plan[key] ?? "";
  clearErrors();
  $("title").focus();
}

function clearForm() {
  $("plan-id").value = "";
  for (const { key } of FIELDS) $(key).value = "";
  clearErrors();
}

function clearErrors() {
  $("error-summary").hidden = true;
  $("error-list").replaceChildren();
  for (const { key } of FIELDS) {
    $(`${key}-err`).hidden = true;
    $(`${key}-err`).textContent = "";
    $(key).removeAttribute("aria-invalid");
    $(key).closest(".field").classList.remove("invalid");
  }
}

function showErrors(errors) {
  clearErrors();
  const list = $("error-list");
  for (const { key } of FIELDS) {
    if (!errors[key]) continue;
    $(`${key}-err`).textContent = errors[key];
    $(`${key}-err`).hidden = false;
    $(key).setAttribute("aria-invalid", "true");
    $(key).closest(".field").classList.add("invalid");
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${key}`;
    a.textContent = errors[key];
    li.append(a);
    list.append(li);
  }
  $("error-summary").hidden = false;
  $("error-summary").focus();
}

function handle(action) {
  try {
    return action();
  } catch (err) {
    if (err instanceof StoreError && err.code === "VALIDATION") {
      showErrors(err.details.errors);
      say("Nothing was saved. Please fix the errors listed.");
    } else if (err instanceof StoreError) {
      say(err.message);
    } else {
      throw err;
    }
  }
}

const button = (text, onClick, { label, primary } = {}) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (label) b.setAttribute("aria-label", label);
  if (primary) b.className = "primary";
  b.addEventListener("click", onClick);
  return b;
};

function render() {
  const plans = store.list();
  const ul = $("plan-list");
  ul.replaceChildren();
  $("empty").hidden = plans.length > 0;
  $("sync-all").hidden = store.pending().length === 0;

  for (const plan of plans) {
    const li = document.createElement("li");
    const h = document.createElement("h3");
    h.textContent = plan.title;
    const chip = document.createElement("p");
    chip.className = `chip st-${plan.status}`;
    chip.textContent = LABELS[plan.status];
    li.append(h, chip);

    if (plan.lastError) {
      const p = document.createElement("p");
      p.className = "err";
      p.textContent = plan.lastError;
      li.append(p);
    }

    if (plan.status === STATUS.CONFLICT) {
      const box = document.createElement("div");
      box.className = "conflict";
      const p = document.createElement("p");
      p.textContent = `This plan was changed somewhere else. The server's version is titled "${plan.conflict.server.content.title}". Which do you want to keep?`;
      box.append(
        p,
        button("Keep my version", () => resolve(plan.id, "mine"), { label: `Keep my version of ${plan.title}` }),
        " ",
        button("Use the server's version", () => resolve(plan.id, "server"), { label: `Use the server's version of ${plan.title}` })
      );
      li.append(box);
    }

    const actions = document.createElement("p");
    actions.append(button("Edit", () => fillForm(plan), { label: `Edit ${plan.title}` }));
    if (plan.status === STATUS.PENDING_SYNC || plan.status === STATUS.SYNC_FAILED) {
      const text = plan.status === STATUS.SYNC_FAILED ? "Retry sync" : "Sync now";
      actions.append(" ", button(text, () => runSync(plan.id), { label: `${text}: ${plan.title}` }));
    }
    li.append(actions);
    ul.append(li);
  }
  renderDemoPicker(plans);
}

function renderDemoPicker(plans) {
  $("demo-conflict").hidden = !demoMode;
  if (!demoMode) return;
  const sel = $("demo-plan");
  sel.replaceChildren();
  for (const p of plans.filter((x) => x.serverId)) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.title;
    sel.append(o);
  }
}

function describe(result, title) {
  switch (result.outcome) {
    case "synced": return `"${title}" synced.`;
    case "failed": return `"${title}" could not be synced. It is still saved on this device. Use Retry when you are ready.`;
    case "conflict": return `"${title}" was changed somewhere else. Please choose which version to keep.`;
    case "superseded": return `"${title}" was edited while syncing, so the new edit is kept as a draft.`;
    default: return "";
  }
}

async function runSync(id) {
  const plan = store.get(id);
  if (!plan) return;
  if (!isOnline()) {
    say(`You are offline. "${plan.title}" is saved on this device and will sync when you are back online.`);
    return;
  }
  const pending = syncPlan(store, id, { fetchFn }); // marks SYNCING immediately
  render();
  say(`Syncing "${plan.title}"…`);
  const result = await pending;
  render();
  say(describe(result, plan.title));
}

async function runSyncAll() {
  if (!isOnline()) {
    say("You are offline. Your plans are saved on this device and will sync when you are back online.");
    return;
  }
  say("Syncing waiting plans…");
  const pending = syncAll(store, { fetchFn, isOnline });
  render();
  const { results } = await pending;
  render();
  const ok = results.filter((r) => r.outcome === "synced").length;
  say(results.length ? `${ok} of ${results.length} plan(s) synced.` : "Nothing is waiting to sync.");
}

function resolve(id, choice) {
  handle(() => {
    resolveConflict(store, id, choice);
    render();
    say(choice === "mine" ? "Keeping your version. Use Sync now to send it." : "Using the server's version.");
  });
}

$("save-draft").addEventListener("click", () =>
  handle(() => {
    const plan = store.saveDraft(readForm());
    $("plan-id").value = plan.id;
    clearErrors();
    render();
    say(`Draft "${plan.title}" saved on this device.`);
  })
);

$("complete").addEventListener("click", async () => {
  const plan = handle(() => {
    const draft = store.saveDraft(readForm());
    $("plan-id").value = draft.id;
    const ready = store.markReady(draft.id);
    clearErrors();
    render();
    return ready;
  });
  if (!plan) return;
  if (isOnline()) {
    await runSync(plan.id);
  } else {
    say(`"${plan.title}" is saved on this device and queued. It will sync when you are back online.`);
  }
});

$("sync-all").addEventListener("click", runSyncAll);
$("clear-form").addEventListener("click", () => { clearForm(); say("Form cleared."); });
$("switch-profile").addEventListener("click", () => openProfile($("profile").value));

$("demo-edit").addEventListener("click", async () => {
  const id = $("demo-plan").value;
  if (!id) return say("Sync a plan first, then you can simulate an edit from another device.");
  const res = await fetch(`/api/demo/edit/${encodeURIComponent(id)}`, { method: "POST" });
  say(res.ok ? "Done. Now edit that plan here, complete it and sync it to see the conflict." : "Could not simulate the edit.");
});

function updateNet() {
  const online = isOnline();
  $("net-chip").textContent = online ? "● Online" : "○ Offline – your work is kept on this device";
  $("net-chip").className = `chip ${online ? "chip-online" : "chip-offline"}`;
}
window.addEventListener("online", () => { updateNet(); runSyncAll(); }); // back online: send the queue
window.addEventListener("offline", () => { updateNet(); say("You are offline. New plans are saved on this device."); });
updateNet();

try {
  demoMode = Boolean((await (await fetch("/api/config")).json()).demo);
} catch {
  demoMode = false;
}
openProfile($("profile").value);
