// Validation rules for a session plan (FR-03).
// Pure functions: no browser or storage code in here, so they are easy to unit test.

export const FIELDS = [
  { key: "title", label: "Plan Title", max: 80 },
  { key: "steps", label: "Steps & Timing", max: 1000 },
  { key: "materials", label: "Materials & Local Adaptation", max: 1000 },
  { key: "safety", label: "Safety Guidance", max: 1000 },
  { key: "inclusion", label: "Inclusion / Accessibility Note", max: 1000 },
];

const clean = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * A draft only needs a title (so the facilitator can find it again) and must respect length limits.
 * This keeps in-progress work safe (FR-04) even when it is incomplete.
 */
export function validateForDraft(plan) {
  const errors = {};
  if (!clean(plan.title)) {
    errors.title = "Plan Title is required so you can find this draft later.";
  }
  addLengthErrors(plan, errors);
  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * A plan can only be marked ready to sync when all five categories are present (FR-03).
 * Messages name the field and say how to fix it (AR-01: clear, specific errors).
 */
export function validateForReady(plan) {
  const errors = {};
  for (const field of FIELDS) {
    if (!clean(plan[field.key])) {
      errors[field.key] = `${field.label} is required before completing this plan.`;
    }
  }
  addLengthErrors(plan, errors);
  return { valid: Object.keys(errors).length === 0, errors };
}

function addLengthErrors(plan, errors) {
  for (const field of FIELDS) {
    if (errors[field.key]) continue;
    if (clean(plan[field.key]).length > field.max) {
      errors[field.key] = `${field.label} must be ${field.max} characters or fewer.`;
    }
  }
}
