// Tiny shared helpers used by both audit.mjs and fetch-figma.mjs (and
// consumed by report-html.mjs), so the two slices of the drift audit and
// its HTML rendering can't drift apart on name normalization, axis
// summaries, what counts as "ready for dev", or how a component's bound
// Figma variables resolve to tokens.

import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.mjs";
import { repoRoot as REPO_ROOT } from "../eval/lib/context.mjs";

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

// ── token-binding consumption ──────────────────────────────────────────────
// The map itself is produced by the token sync (design-system/tokens/figma-sync/
// variable-map.mjs) and committed at design-system/dist/variable-map.json; the
// audit only reads it. Returns null (not an error) when it hasn't been generated
// yet — the binding join is simply skipped, like an absent fractalRoot.
export function loadVariableMap() {
  const rel = CONFIG.paths.variableMap;
  const file = path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel);
  if (!fs.existsSync(file)) return null;
  const map = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!map || typeof map.byId !== "object" || map.byId === null) {
    throw new Error(`${rel} has no byId table — not a variable map; regenerate with \`npm run sync\` or \`sync:map\`.`);
  }
  return map;
}

// A Figma variable id is "remote" (subscribed from another library file) when it
// carries a file-key prefix: "VariableID:<file-key>/<node>". Local ids are always
// "VariableID:<n>:<n>" — never a slash — so the slash alone is the discriminator
// (don't over-match on the key's exact format; Figma doesn't guarantee it). The
// sync only sees LOCAL variables, so remote ids are never in the map — this tells
// an unresolved-because-remote binding apart from a stale-map one.
export function isRemoteVariableId(id) {
  return /^VariableID:[^/]+\//.test(id);
}

// Resolve one component's boundVariables (field → [ids]) against the map into
// the tokens it consumes and the ids that didn't resolve. Pure; no findings.
export function resolveBindings(boundVariables, varMap) {
  const ids = [...new Set(Object.values(boundVariables || {}).flat())];
  const tokens = new Set(); // published --vars + .type-* classes
  const untracked = []; // { id, name, collection } — defined in Figma, unbuilt
  const remote = []; // ids from a subscribed library (expected-absent)
  const unresolved = []; // ids absent from the map for other reasons
  for (const id of ids.sort()) {
    const e = varMap.byId[id];
    if (!e) {
      (isRemoteVariableId(id) ? remote : unresolved).push(id);
      continue;
    }
    if (e.token) tokens.add(e.token);
    else if (e.kind === "untracked") untracked.push({ id, name: e.name, collection: e.collection });
    // composite inputs (ramp/utility/exploded) consume no standalone token — ignored.
  }
  return { tokens: [...tokens].sort(), untracked, remote, unresolved };
}
