#!/usr/bin/env node
// Token-binding map: Figma variable id → published token name.
//
// The token sync already knows, for every Figma variable, both its id
// ("VariableID:3302:20825") and the token path it maps to ("background.surface")
// — transform() hands that table out as `variables`. This module joins it
// against the built stylesheet to record which token each id actually ships as
// ("--background-surface"), so the drift audit can report the exact tokens a
// component consumes without ever re-fetching or persisting the raw export.
//
// Produced as a by-product of `npm run sync` (see sync.mjs) and written to
// design-system/dist/variable-map.json — a generated, committed artifact that
// sits alongside dist/tokens.css and is regenerated from the same Figma export.
//
// CLI (regenerate the map only, against the current build, from a saved export):
//   node design-system/tokens/figma-sync/variable-map.mjs <export.json>
//   node design-system/tokens/figma-sync/variable-map.mjs <export.json> --json
//
// Deterministic and dependency-free; output keys are sorted, so a re-run
// against the same inputs is byte-identical.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, tokenPath, transform } from "./transform.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOKENS_CSS = path.join(HERE, "..", "..", "dist", "tokens.css");
export const VARIABLE_MAP = path.join(HERE, "..", "..", "dist", "variable-map.json");
const DEFAULT_EXPORT = path.join(HERE, "..", "figma-export.json");

const lc = (s) => (s || "").toLowerCase();

// dotted token path → CSS custom-property stem. Mirror of build.mjs's pathToVar
// (kept in sync by hand — two lines, and importing build.mjs would run its
// file-writing side effects). camelCase → kebab, then join on "-".
const seg = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const pathToVar = (p) => p.split(".").map(seg).join("-");

// Parse the built stylesheet into the two forms a token can ship as: a
// `--custom-property` and a `.type-*` composite ramp class.
export function readPublishedTokens(css) {
  const vars = new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const typeClasses = new Set([...css.matchAll(/\.(type-[a-z0-9-]+)\b/g)].map((m) => m[1]));
  return { vars, typeClasses };
}

// Would the sync ever emit this variable as its own token? False for variables
// that are only INPUTS to another token: a ramp collection (family/size/weight
// vars folded into .type-* classes), a collection's excluded prefix (responsive
// `type/*`), an exploded mode source (responsive `layout/breakpoint` → discrete
// `--breakpoint-*`), a `*-stack` font fallback, or a `_`-private segment. Only a
// standalone-token variable missing from the build is real drift ("untracked").
function emitsOwnToken(collectionName, varName, dotted) {
  const cfg = CONFIG.collections[lc(collectionName)];
  if (!cfg || cfg.ramp) return false;
  const segs = dotted.split(".");
  const firstSeg = segs[cfg.prefix ? 1 : 0];
  if ((cfg.excludePrefixes || []).includes(firstSeg)) return false;
  if (Object.keys(cfg.explodeModes || {}).includes(dotted)) return false;
  if (/-stack$/.test(varName)) return false;
  if (segs.some((s) => s.startsWith("_"))) return false;
  return true;
}

// Classify one variable → how it surfaces (or doesn't) as a token.
//   var         — ships as a `--custom-property` (token present in the build)
//   type-class  — ships as a `.type-*` ramp class (composite, no single var)
//   untracked   — a real token-collection variable with NO published token:
//                 Figma defines it, the build doesn't emit it — a drift signal.
//   composite   — an input, never a standalone token (ramp/utility/exploded/…).
function classify({ collection, name, path: dotted }, published) {
  const stem = pathToVar(dotted);
  if (published.vars.has(stem)) return { kind: "var", token: `--${stem}` };
  if (published.typeClasses.has(stem)) return { kind: "type-class", token: `.${stem}` };
  return { kind: emitsOwnToken(collection, name, dotted) ? "untracked" : "composite", token: null };
}

// Pure: transform()'s `variables` table + parsed published tokens → { byId }
// sorted by id. One entry per variable, carrying its Figma name/collection and
// its resolved token.
export function buildVariableMap(variables, published, meta = {}) {
  const byId = {};
  for (const v of variables) {
    const { kind, token } = classify(v, published);
    byId[v.id] = { name: v.name, collection: v.collection, kind, token };
  }
  const sorted = {};
  for (const id of Object.keys(byId).sort()) sorted[id] = byId[id];
  return { fileName: meta.fileName, version: meta.version, byId: sorted };
}

// Convenience for both the CLI and runSync: given a parsed Figma export and the
// current built CSS, produce the map. Runs transform() only to obtain the
// id→path table (its token files are ignored here).
export function buildVariableMapFromExport(exportData, css) {
  const { variables } = transform(exportData);
  return buildVariableMap(variables, readPublishedTokens(css), {
    fileName: exportData.fileName,
    version: exportData.version,
  });
}

export function serializeVariableMap(map) {
  return JSON.stringify(map, null, 2) + "\n";
}

// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const exportPath = args.find((a) => !a.startsWith("--")) || DEFAULT_EXPORT;

  if (!fs.existsSync(exportPath)) {
    console.error(
      `Figma export not found at ${exportPath}.\n` +
        `Pass a saved export path, or run \`npm run sync\` — it regenerates the map as a by-product.`
    );
    process.exit(2);
  }
  if (!fs.existsSync(TOKENS_CSS)) {
    console.error(`Built stylesheet not found at ${TOKENS_CSS} — run \`npm run tokens\` first.`);
    process.exit(2);
  }

  const exportData = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  const css = fs.readFileSync(TOKENS_CSS, "utf8");
  const map = buildVariableMapFromExport(exportData, css);
  const out = serializeVariableMap(map);

  if (jsonMode) {
    process.stdout.write(out);
    return;
  }
  fs.writeFileSync(VARIABLE_MAP, out);
  const kinds = {};
  for (const e of Object.values(map.byId)) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  console.error(
    `Wrote ${path.relative(path.join(HERE, "..", "..", ".."), VARIABLE_MAP)} — ${Object.keys(map.byId).length} variables ` +
      `(${kinds.var || 0} var, ${kinds["type-class"] || 0} type-class, ${kinds.untracked || 0} untracked, ${kinds.composite || 0} composite).`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main();
}
