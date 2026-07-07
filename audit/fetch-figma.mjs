#!/usr/bin/env node
// Deterministic Figma component inventory — first slice of the drift audit.
//
// Fetches the SNAP Figma file, walks the component/pattern pages, and writes
// audit/figma-inventory.json: every COMPONENT_SET and standalone COMPONENT
// with its variant axes, property definitions, section dev-status, and the
// design-token variables bound in its subtree. The output is byte-stable
// across runs when the Figma file hasn't changed, so drift shows up as a
// plain `git diff` on the committed inventory.
//
// Usage:
//   node audit/fetch-figma.mjs           # human summary to stdout
//   node audit/fetch-figma.mjs --json    # inventory JSON to stdout instead
//
// Pure Node 18+ (global fetch), zero dependencies. Requires FIGMA_TOKEN in
// the shell env or the repo-root .env (File-content read scope).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(__dirname, "figma-inventory.json");
const API_BASE = "https://api.figma.com";
const PAGE_IDS_PER_REQUEST = 4; // bound the /nodes payload size

// ---------------------------------------------------------------------------
// Token + HTTP
// ---------------------------------------------------------------------------

function resolveToken() {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;
  const envPath = path.join(REPO_ROOT, ".env");
  if (fs.existsSync(envPath)) {
    const line = fs
      .readFileSync(envPath, "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith("FIGMA_TOKEN="));
    if (line) {
      return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  console.error(
    "No FIGMA_TOKEN found. Set FIGMA_TOKEN in your shell env, or add a line\n" +
      "  FIGMA_TOKEN=your-token-here\n" +
      "to a .env file at the repo root, then re-run."
  );
  process.exit(1);
}

async function figmaGet(token, url) {
  const res = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Request failed: ${res.status} ${res.statusText}\n${url}\n${body}`);
    if (res.status === 403) {
      console.error(
        "403 usually means the token is missing the 'File content' read scope, " +
          "or doesn't have access to this file."
      );
    }
    process.exit(1);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

// Walk a Figma node tree, invoking cb(node, ancestors) for every node.
// ancestors runs from root to (but not including) node.
function walk(node, cb, ancestors = []) {
  if (!node) return;
  cb(node, ancestors);
  for (const child of node.children || []) {
    walk(child, cb, [...ancestors, node]);
  }
}

// Parse Figma variant naming convention "Prop1=Value1, Prop2=Value2".
function parseVariantName(name) {
  const pairs = {};
  for (const part of name.split(",")) {
    const [k, v] = part.split("=").map((s) => s && s.trim());
    if (k && v !== undefined) pairs[k] = v;
  }
  return pairs;
}

function isPrivateName(name) {
  return name.startsWith(".") || name.startsWith("_");
}

// Strip the '#123:456' suffix Figma appends to non-variant property names,
// e.g. 'heading#2636:0' → 'heading'.
function normalizePropertyName(name) {
  return name.replace(/#\d+:\d+$/, "");
}

// Aggregate boundVariables over a subtree: top-level property name →
// sorted array of distinct variable ids. Handles the three value shapes:
// single { id }, array of { id }, and nested object of { id } (e.g. size.x).
function collectBoundVariables(root) {
  const byProperty = new Map(); // prop -> Set of ids
  walk(root, (node) => {
    const bv = node.boundVariables;
    if (!bv || typeof bv !== "object") return;
    for (const [prop, value] of Object.entries(bv)) {
      const ids = [];
      if (Array.isArray(value)) {
        for (const v of value) if (v?.id) ids.push(v.id);
      } else if (value?.id) {
        ids.push(value.id);
      } else if (value && typeof value === "object") {
        for (const v of Object.values(value)) if (v?.id) ids.push(v.id);
      }
      for (const id of ids) {
        if (!byProperty.has(prop)) byProperty.set(prop, new Set());
        byProperty.get(prop).add(id);
      }
    }
  });
  const out = {};
  for (const prop of [...byProperty.keys()].sort()) {
    out[prop] = [...byProperty.get(prop)].sort();
  }
  return out;
}

// componentPropertyDefinitions → deterministic { name: { type, values?, default? } }.
function extractProperties(defs) {
  if (!defs || typeof defs !== "object") return {};
  const entries = Object.entries(defs).map(([rawName, def]) => {
    const prop = { type: def.type };
    if (def.type === "VARIANT" && Array.isArray(def.variantOptions)) {
      prop.values = [...def.variantOptions].sort();
    }
    // SLOT defaults are opaque guid objects — omit them.
    if (def.type !== "SLOT" && def.defaultValue !== undefined) {
      prop.default = def.defaultValue;
    }
    return [normalizePropertyName(rawName), prop];
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}

// Derive variant axes from child COMPONENT names: { axis: [sorted values] }.
function deriveAxes(variantNames) {
  const axes = new Map();
  for (const name of variantNames) {
    for (const [axis, value] of Object.entries(parseVariantName(name))) {
      if (!axes.has(axis)) axes.set(axis, new Set());
      axes.get(axis).add(value);
    }
  }
  const out = {};
  for (const axis of [...axes.keys()].sort()) {
    out[axis] = [...axes.get(axis)].sort();
  }
  return out;
}

function nearestSection(ancestors) {
  const section = [...ancestors].reverse().find((a) => a.type === "SECTION");
  if (!section) return null;
  return {
    name: section.name,
    nodeId: section.id,
    devStatus: section.devStatus?.type ?? null,
  };
}

// Build one deterministic inventory entry (fixed key order throughout).
// descriptions: node id -> description string. In /nodes responses the
// description does NOT live on the document node itself — it comes from the
// response's `components` / `componentSets` metadata maps.
function buildEntry(node, kind, pageName, ancestors, descriptions) {
  const entry = {
    name: node.name,
    nodeId: node.id,
    kind, // 'componentSet' | 'component'
    page: pageName,
    section: nearestSection(ancestors),
  };
  const description = node.description ?? descriptions.get(node.id);
  if (typeof description === "string" && description.trim() !== "") {
    entry.description = description;
  }
  entry.properties = extractProperties(node.componentPropertyDefinitions);
  if (kind === "componentSet") {
    const variantNames = (node.children || [])
      .filter((c) => c.type === "COMPONENT")
      .map((c) => c.name);
    entry.variants = [...variantNames].sort();
    entry.variantCount = variantNames.length;
    entry.axes = deriveAxes(variantNames);
  }
  entry.boundVariables = collectBoundVariables(node);
  return entry;
}

// ---------------------------------------------------------------------------
// Diffing against the previous inventory
// ---------------------------------------------------------------------------

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function printChangeSummary(prev, next) {
  const prevById = new Map(prev.components.map((c) => [c.nodeId, c]));
  const nextById = new Map(next.components.map((c) => [c.nodeId, c]));
  const added = next.components.filter((c) => !prevById.has(c.nodeId));
  const removed = prev.components.filter((c) => !nextById.has(c.nodeId));
  const changed = next.components.filter(
    (c) => prevById.has(c.nodeId) && !deepEqual(prevById.get(c.nodeId), c)
  );

  console.error("Change summary vs existing figma-inventory.json:");
  console.error(
    `  fileVersion: ${prev.fileVersion} -> ${next.fileVersion}` +
      (prev.fileVersion === next.fileVersion ? " (unchanged)" : "")
  );
  if (added.length + removed.length + changed.length === 0) {
    console.error("  components: no changes");
  } else {
    for (const c of added) console.error(`  + added:   ${c.name} (${c.nodeId})`);
    for (const c of removed) console.error(`  - removed: ${c.name} (${c.nodeId})`);
    for (const c of changed) console.error(`  ~ changed: ${c.name} (${c.nodeId})`);
  }
}

// ---------------------------------------------------------------------------
// Human summary
// ---------------------------------------------------------------------------

function axesSummary(entry) {
  if (entry.kind !== "componentSet") return "-";
  const parts = Object.entries(entry.axes).map(
    ([axis, values]) => `${axis}(${values.length})`
  );
  return parts.length ? parts.join(", ") : "(none)";
}

function printHumanSummary(inventory, skippedPrivate) {
  const sets = inventory.components.filter((c) => c.kind === "componentSet");
  const standalone = inventory.components.filter((c) => c.kind === "component");

  console.log("");
  console.log(`File:    ${inventory.fileName}`);
  console.log(`Version: ${inventory.fileVersion}  (last modified ${inventory.lastModified})`);
  console.log(
    `Totals:  ${sets.length} component set(s), ${standalone.length} standalone component(s), ` +
      `${skippedPrivate} private skipped`
  );

  console.log("\nPer-page counts:");
  for (const page of inventory.pagesScanned) {
    const n = inventory.components.filter((c) => c.page === page).length;
    console.log(`  ${page.padEnd(24)} ${n}`);
  }

  const nameW = Math.max(4, ...inventory.components.map((c) => c.name.length));
  console.log("\nComponents:");
  console.log(
    `  ${"name".padEnd(nameW)}  ${"kind".padEnd(12)}  ${"variants".padEnd(8)}  ${"axes".padEnd(28)}  section devStatus`
  );
  for (const c of inventory.components) {
    console.log(
      `  ${c.name.padEnd(nameW)}  ` +
        `${(c.kind === "componentSet" ? "set" : "component").padEnd(12)}  ` +
        `${String(c.variantCount ?? "-").padEnd(8)}  ` +
        `${axesSummary(c).padEnd(28)}  ` +
        `${c.section?.devStatus ?? "-"}`
    );
  }
  console.log(`\nWrote ${OUT_FILE}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const jsonMode = process.argv.includes("--json");
  const token = resolveToken();
  const { fileKey, excludePages, includePrivate } = CONFIG;

  // Step 1: file overview (name, version, page list) at depth=1.
  const fileDoc = await figmaGet(token, `${API_BASE}/v1/files/${fileKey}?depth=1`);
  const allPages = fileDoc.document?.children || [];

  // Step 2: filter pages.
  const keptPages = [];
  for (const page of allPages) {
    const matched = excludePages.find((re) => re.test(page.name));
    if (matched) {
      console.error(`skip page: ${JSON.stringify(page.name)}  (matched ${matched})`);
    } else {
      console.error(`scan page: ${JSON.stringify(page.name)}  [${page.id}]`);
      keptPages.push(page);
    }
  }
  if (keptPages.length === 0) {
    console.error("All pages were excluded — check CONFIG.excludePages.");
    process.exit(1);
  }

  // Step 3: fetch kept pages' full subtrees, chunked, sequentially.
  const pageDocs = new Map(); // page id -> subtree root
  const descriptions = new Map(); // component/set node id -> description
  for (let i = 0; i < keptPages.length; i += PAGE_IDS_PER_REQUEST) {
    const chunk = keptPages.slice(i, i + PAGE_IDS_PER_REQUEST);
    const ids = chunk.map((p) => p.id).join(",");
    const url = `${API_BASE}/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`;
    console.error(
      `fetching pages ${i + 1}-${i + chunk.length} of ${keptPages.length}...`
    );
    const doc = await figmaGet(token, url);
    for (const page of chunk) {
      const entry = doc.nodes?.[page.id];
      if (!entry?.document) {
        console.error(`No subtree returned for page ${JSON.stringify(page.name)} [${page.id}]`);
        process.exit(1);
      }
      pageDocs.set(page.id, entry.document);
      // Descriptions live in the response metadata maps, not on the nodes.
      for (const meta of [entry.components, entry.componentSets]) {
        for (const [nodeId, info] of Object.entries(meta || {})) {
          if (info?.description) descriptions.set(nodeId, info.description);
        }
      }
    }
  }

  // Step 4: walk each page, collecting component sets + standalone components.
  const components = [];
  let skippedPrivate = 0;
  for (const page of keptPages) {
    walk(pageDocs.get(page.id), (node, ancestors) => {
      const isSet = node.type === "COMPONENT_SET";
      const isStandalone =
        node.type === "COMPONENT" &&
        !ancestors.some((a) => a.type === "COMPONENT_SET");
      if (!isSet && !isStandalone) return;
      if (!includePrivate && isPrivateName(node.name)) {
        skippedPrivate += 1;
        return;
      }
      components.push(
        buildEntry(
          node,
          isSet ? "componentSet" : "component",
          page.name,
          ancestors,
          descriptions
        )
      );
    });
  }

  components.sort((a, b) => {
    if (a.page !== b.page) return a.page < b.page ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0;
  });

  // Step 5: assemble the inventory. Deliberately no fetched-at timestamp —
  // the file must be byte-stable when the Figma file hasn't changed.
  const inventory = {
    fileKey,
    fileName: fileDoc.name,
    fileVersion: fileDoc.version,
    lastModified: fileDoc.lastModified,
    pagesScanned: keptPages.map((p) => p.name),
    components,
  };

  // Step 6: change summary vs the previous inventory, then write.
  if (fs.existsSync(OUT_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
      printChangeSummary(prev, inventory);
    } catch (err) {
      console.error(`Could not diff against existing inventory: ${err.message}`);
    }
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(inventory, null, 2) + "\n");

  // Step 7: report.
  if (jsonMode) {
    console.log(JSON.stringify(inventory, null, 2));
  } else {
    printHumanSummary(inventory, skippedPrivate);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
