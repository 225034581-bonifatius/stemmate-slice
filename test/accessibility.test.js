// AR-01: automated checks on the page structure. These catch regressions; a manual keyboard pass is still in the README.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const html = fs.readFileSync(fileURLToPath(new URL("../client/index.html", import.meta.url)), "utf8");
const css = fs.readFileSync(fileURLToPath(new URL("../client/styles.css", import.meta.url)), "utf8");
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

test("AR-01: every visible text field has a label tied to it", () => {
  const fields = [...html.matchAll(/<(?:input|textarea)\b[^>]*>/g)].map((m) => m[0]).filter((t) => attr(t, "type") !== "hidden");
  assert.ok(fields.length >= 6);
  for (const tag of fields) {
    const id = attr(tag, "id");
    assert.ok(id, `field without id: ${tag}`);
    const explicit = new RegExp(`<label[^>]*for="${id}"`).test(html);
    const wrapping = new RegExp(`<label[^>]*>\\s*<input[^>]*id="${id}"`).test(html); // checkbox inside its label
    assert.ok(explicit || wrapping, `no label for #${id}`);
  }
});

test("AR-01: each plan field points at its own error message", () => {
  for (const key of ["title", "steps", "materials", "safety", "inclusion"]) {
    assert.match(html, new RegExp(`id="${key}"[^>]*aria-describedby="${key}-err"`));
    assert.match(html, new RegExp(`id="${key}-err"`));
  }
});

test("AR-01: status messages are announced and errors summarised", () => {
  assert.match(html, /id="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="error-summary"[^>]*role="alert"/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /class="skip"/);
});

test("AR-01: keyboard focus is visible and buttons are large enough to tap", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:\s*44px/);
});
