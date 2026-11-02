// Browser wiring: form <-> validation <-> PlanStore. Uses textContent only (never innerHTML) so plan text cannot inject markup.
import { PlanStore, StoreError, STATUS } from "./planStore.js";
import { FIELDS } from "./validation.js";

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

function openProfile(name) {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "default";
  store = new PlanStore(window.localStorage, id);
  clearForm();
  render();
  say(`Profile "${name.trim() || "default"}" opened.`);
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
    action();
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

function render() {
  const plans = store.list();
  const ul = $("plan-list");
  ul.replaceChildren();
  $("empty").hidden = plans.length > 0;
  for (const plan of plans) {
    const li = document.createElement("li");
    const h = document.createElement("h3");
    h.textContent = plan.title;
    const chip = document.createElement("p");
    chip.className = `chip st-${plan.status}`;
    chip.textContent = LABELS[plan.status];
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit ${plan.title}`);
    edit.addEventListener("click", () => fillForm(plan));
    li.append(h, chip, " ", edit);
    ul.append(li);
  }
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

$("complete").addEventListener("click", () =>
  handle(() => {
    const draft = store.saveDraft(readForm());
    $("plan-id").value = draft.id;
    const plan = store.markReady(draft.id);
    clearErrors();
    render();
    say(`"${plan.title}" is complete and queued for sync. It is saved on this device.`);
  })
);

$("clear-form").addEventListener("click", () => { clearForm(); say("Form cleared."); });
$("switch-profile").addEventListener("click", () => openProfile($("profile").value));

function updateNet() {
  const online = navigator.onLine;
  $("net-chip").textContent = online ? "● Online" : "○ Offline – your work is kept on this device";
  $("net-chip").className = `chip ${online ? "chip-online" : "chip-offline"}`;
}
window.addEventListener("online", updateNet);
window.addEventListener("offline", updateNet);
updateNet();

openProfile($("profile").value);
