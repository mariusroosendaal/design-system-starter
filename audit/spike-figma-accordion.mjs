#!/usr/bin/env node
// Throwaway spike for the component-audit brainstorm.
// Proves out what the Figma REST API gives us for a component-inventory audit,
// using the Accordion component set as the worked example. Pure Node 18+
// (global fetch), zero dependencies. Not part of the token-sync pipeline —
// safe to delete once the audit idea is scoped for real.
//
// Usage: FIGMA_TOKEN=... node audit/spike-figma-accordion.mjs
// (or put FIGMA_TOKEN=... in a repo-root .env)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(__dirname, "spike-output");

const FILE_KEY = "40hPEX7A9Wt5VsMHxk3xCr";
const ACCORDION_NODE_ID = "8060:424";

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

// Walk a Figma node tree, invoking cb(node, ancestors) for every node.
// ancestors is the array of ancestor nodes from root to (but not including) node.
function walk(node, cb, ancestors = []) {
  if (!node) return;
  cb(node, ancestors);
  const children = node.children || [];
  for (const child of children) {
    walk(child, cb, [...ancestors, node]);
  }
}

// Parse Figma variant naming convention "Prop1=Value1, Prop2=Value2" into pairs.
function parseVariantName(name) {
  const pairs = {};
  for (const part of name.split(",")) {
    const [k, v] = part.split("=").map((s) => s && s.trim());
    if (k && v !== undefined) pairs[k] = v;
  }
  return pairs;
}

function collectBoundVariables(root) {
  // property path -> Set of variable ids
  const byProperty = new Map();
  // variable id -> { count, exampleProperty }
  const byVariable = new Map();
  let boundNodeCount = 0;

  walk(root, (node) => {
    const bv = node.boundVariables;
    if (!bv || typeof bv !== "object") return;
    boundNodeCount += 1;
    for (const [prop, value] of Object.entries(bv)) {
      const ids = [];
      if (Array.isArray(value)) {
        for (const v of value) if (v?.id) ids.push(v.id);
      } else if (value?.id) {
        ids.push(value.id);
      } else if (typeof value === "object") {
        // e.g. { r: {...}, g: {...} } style nested bindings
        for (const v of Object.values(value)) if (v?.id) ids.push(v.id);
      }
      for (const id of ids) {
        if (!byProperty.has(prop)) byProperty.set(prop, new Set());
        byProperty.get(prop).add(id);
        if (!byVariable.has(id)) byVariable.set(id, { count: 0, exampleProperty: prop });
        byVariable.get(id).count += 1;
      }
    }
  });

  return { byProperty, byVariable, boundNodeCount };
}

function printComponentSetDetail(node) {
  console.log(`\n--- COMPONENT_SET: ${node.name} (${node.id}) ---`);

  console.log("\ncomponentPropertyDefinitions:");
  console.log(JSON.stringify(node.componentPropertyDefinitions ?? {}, null, 2));

  const variants = node.children || [];
  console.log(`\nVariants (${variants.length}):`);
  for (const v of variants) {
    console.log(`  - ${v.name}  [${v.id}]`);
  }

  const axes = new Map(); // prop name -> Set of values
  for (const v of variants) {
    const pairs = parseVariantName(v.name);
    for (const [k, val] of Object.entries(pairs)) {
      if (!axes.has(k)) axes.set(k, new Set());
      axes.get(k).add(val);
    }
  }
  console.log("\nVariant axes (derived from child names):");
  for (const [axis, values] of axes) {
    console.log(`  ${axis}: [${[...values].join(", ")}]  (${values.size} values)`);
  }
  console.log(`\nTotal variant count: ${variants.length}`);

  const { byProperty, byVariable, boundNodeCount } = collectBoundVariables(node);
  console.log(`\nboundVariables summary for this subtree:`);
  console.log(`  ${boundNodeCount} node(s) carry at least one bound variable`);
  console.log(`  ${byVariable.size} distinct variable id(s) referenced`);
  for (const [prop, ids] of byProperty) {
    console.log(`  property "${prop}" bound on nodes referencing ${ids.size} distinct variable id(s)`);
  }
  console.log("  distinct variable ids (with one example bound property each):");
  for (const [id, info] of byVariable) {
    console.log(`    - ${id}  (e.g. via "${info.exampleProperty}", ${info.count} binding(s) total)`);
  }
}

function findComponentSets(root) {
  const found = [];
  walk(root, (node) => {
    if (node.type === "COMPONENT_SET") found.push(node);
  });
  return found;
}

async function main() {
  const token = resolveToken();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // --- Step 1: file overview at depth=3 ---
  const fileUrl = `https://api.figma.com/v1/files/${FILE_KEY}?depth=3`;
  const fileDoc = await figmaGet(token, fileUrl);

  console.log("=".repeat(70));
  console.log("FILE OVERVIEW");
  console.log("=".repeat(70));
  console.log(`name:          ${fileDoc.name}`);
  console.log(`lastModified:  ${fileDoc.lastModified}`);
  console.log(`version:       ${fileDoc.version}`);

  const pages = fileDoc.document?.children || [];
  console.log(`\npages (${pages.length}):`);
  for (const p of pages) {
    console.log(`  - ${p.name}  [${p.id}]`);
  }

  const sections = [];
  const componentSets = [];
  walk(fileDoc.document, (node, ancestors) => {
    if (node.type === "SECTION") {
      sections.push({
        id: node.id,
        name: node.name,
        devStatus: node.devStatus ?? null,
      });
    }
    if (node.type === "COMPONENT_SET") {
      const parentSection = [...ancestors].reverse().find((a) => a.type === "SECTION");
      componentSets.push({
        id: node.id,
        name: node.name,
        sectionId: parentSection?.id ?? null,
        sectionName: parentSection?.name ?? null,
      });
    }
  });

  console.log(`\nSECTION nodes found (${sections.length}):`);
  for (const s of sections) {
    const status = s.devStatus ? `${s.devStatus.type}${s.devStatus.description ? ` — ${s.devStatus.description}` : ""}` : "(none)";
    console.log(`  - ${s.name}  [${s.id}]  devStatus: ${status}`);
  }

  console.log(`\nCOMPONENT_SET nodes visible at depth=3 (${componentSets.length}):`);
  console.log(
    `  ${"name".padEnd(28)} ${"node id".padEnd(14)} ${"parent section".padEnd(24)} section devStatus`
  );
  for (const cs of componentSets) {
    const section = sections.find((s) => s.id === cs.sectionId);
    const status = section?.devStatus ? section.devStatus.type : "(no section)";
    console.log(
      `  ${cs.name.padEnd(28)} ${cs.id.padEnd(14)} ${(cs.sectionName ?? "(none)").padEnd(24)} ${status}`
    );
  }

  fs.writeFileSync(path.join(OUT_DIR, "file-depth3.json"), JSON.stringify(fileDoc, null, 2));

  // --- Step 2: Accordion node detail ---
  const nodesUrl = `https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${ACCORDION_NODE_ID}`;
  const nodesDoc = await figmaGet(token, nodesUrl);

  console.log("\n" + "=".repeat(70));
  console.log("ACCORDION NODE DETAIL");
  console.log("=".repeat(70));

  const entry = nodesDoc.nodes?.[ACCORDION_NODE_ID];
  const rootNode = entry?.document;
  if (!rootNode) {
    console.error(`No node returned for id ${ACCORDION_NODE_ID}`);
    process.exit(1);
  }
  console.log(`type: ${rootNode.type}   name: ${rootNode.name}`);

  const componentSets2 =
    rootNode.type === "COMPONENT_SET" ? [rootNode] : findComponentSets(rootNode);

  if (componentSets2.length === 0) {
    console.log("No COMPONENT_SET nodes found in this subtree.");
  } else {
    for (const cs of componentSets2) printComponentSetDetail(cs);
  }

  console.log("\n--- boundVariables across full requested subtree ---");
  const { byProperty, byVariable, boundNodeCount } = collectBoundVariables(rootNode);
  console.log(`${boundNodeCount} node(s) carry at least one bound variable`);
  console.log(`${byVariable.size} distinct variable id(s) referenced overall`);
  for (const [prop, ids] of byProperty) {
    console.log(`  "${prop}" bound on nodes referencing ${ids.size} distinct variable id(s)`);
  }
  console.log("distinct variable ids (one example bound property each):");
  for (const [id, info] of byVariable) {
    console.log(`  - ${id}  (e.g. via "${info.exampleProperty}", ${info.count} binding(s) total)`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "nodes-accordion.json"), JSON.stringify(nodesDoc, null, 2));

  console.log(`\nRaw responses saved to:`);
  console.log(`  ${path.join(OUT_DIR, "file-depth3.json")}`);
  console.log(`  ${path.join(OUT_DIR, "nodes-accordion.json")}`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
