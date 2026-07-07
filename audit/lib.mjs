// Tiny shared helpers used by both audit.mjs and fetch-figma.mjs (and
// consumed by report-html.mjs), so the two slices of the drift audit and
// its HTML rendering can't drift apart on name normalization, axis
// summaries, or what counts as "ready for dev".

// Component-name normalization for the join: lowercase, trim, spaces/underscores → hyphens.
export function normalizeName(name) {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

// One-line axis summary for a Figma componentSet entry, e.g. "size(3), variant(2)".
// Tolerant of a missing/empty `axes` map (fetch-figma.mjs's own entries always
// have one, but callers may pass partial/derived data).
export function axesSummary(figmaEntry) {
  if (figmaEntry.kind !== "componentSet") return "-";
  const parts = Object.entries(figmaEntry.axes || {}).map(([a, v]) => `${a}(${v.length})`);
  return parts.length ? parts.join(", ") : "(none)";
}

// Section devStatus values that mean "design says this is ready to build".
export const READY_DEV_STATUSES = ["READY_FOR_DEV", "COMPLETED"];
