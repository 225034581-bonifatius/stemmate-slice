import test from "node:test";
import assert from "node:assert/strict";
import { validateForDraft, validateForReady } from "../client/js/validation.js";
import { completePlan } from "./helpers.js";

test("FR-04: a draft with only a title is valid", () => {
  assert.equal(validateForDraft({ title: "Half done" }).valid, true);
});

test("FR-04: a draft without a title is rejected with a clear message", () => {
  const r = validateForDraft({ title: "   " });
  assert.equal(r.valid, false);
  assert.match(r.errors.title, /Plan Title is required/);
});

test("FR-03: a plan missing any of the five categories cannot be completed", () => {
  for (const key of ["title", "steps", "materials", "safety", "inclusion"]) {
    const r = validateForReady(completePlan({ [key]: "" }));
    assert.equal(r.valid, false, key);
    assert.ok(r.errors[key], key);
  }
});

test("FR-03: a full plan is valid", () => {
  assert.equal(validateForReady(completePlan()).valid, true);
});

test("over-length text is rejected", () => {
  const r = validateForDraft({ title: "x".repeat(81) });
  assert.match(r.errors.title, /80 characters/);
});
