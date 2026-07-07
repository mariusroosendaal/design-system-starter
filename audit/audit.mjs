#!/usr/bin/env node
// Design-system drift audit — slice 2: join the Figma inventory
// (audit/figma-inventory.json, slice 1) against the code inventory
// (audit/code-inventory.mjs) and report what's out of sync.
//
// Usage:
//   node audit/audit.mjs             # human report
//   node audit/audit.mjs --json      # { generatedFrom, components, findings }
//   node audit/audit.mjs --strict    # exit 1 if any error-severity finding
//
// Fully offline: reads the committed figma-inventory.json, never calls the
// Figma API (that's fetch-figma.mjs's job, run separately via
// `npm run audit:fetch`). Pure Node 18+, zero dependencies. No timestamps
// anywhere in the output — a re-run against the same inputs is byte-identical.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "./config.mjs";
import { buildCodeInventory, fractalRootExists, REPO_ROOT } from "./code-inventory.mjs";
import { runStaticChecks } from "../eval/static-checks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY_FILE = path.join(__dirname, "figma-inventory.json");

// Kept identical to eval/run.mjs's own kebab-case + spec-path derivation so
// "does this component have a spec / pass static checks" means the same
// thing here as it does in `npm run eval`.
const kebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const SPEC_DIR = "design-system/components";

// ---------------------------------------------------------------------------
// Name / key normalization
// ---------------------------------------------------------------------------

// Component-name normalization for the join: lowercase, trim, spaces/underscores → hyphens.
function normalizeName(name) {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

// Stricter key normalization for matching a Figma axis name to a code prop
// name: strip spaces/hyphens/underscores entirely, lowercase. This is what
// lets 'is open' match `isOpen` (react-tsx) or `is_open` (fractal).
function normalizeKey(name) {
  return name.toLowerCase().replace(/[\s\-_]+/g, "");
}

function figmaMatchesCode(figmaName, codeName) {
  const f = normalizeName(figmaName);
  const c = normalizeName(codeName);
  if (f === c) return true;
  return CONFIG.aliases[f] === c;
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Axis / prop comparison
// ---------------------------------------------------------------------------

function findCodeProp(codeEntry, axisOrPropName) {
  const target = normalizeKey(axisOrPropName);
  const found = Object.entries(codeEntry.props || {}).find(([k]) => normalizeKey(k) === target);
  return found ? { key: found[0], ...found[1] } : null;
}

function isBooleanish(values) {
  const set = new Set(values.map(String));
  return set.size > 0 && set.size <= 2 && [...set].every((v) => v === "true" || v === "false");
}

// Compare a componentSet's variant axes against a matched code component's
// props. Pushes findings as a side effect; returns the structured result
// used by both the human table and --json output.
function compareComponentAxes(figmaEntry, codeEntry, findings) {
  const axes = figmaEntry.axes || {};
  const result = { stateAxes: [], responsiveAxes: [], propAxes: [] };

  for (const [axisName, values] of Object.entries(axes)) {
    const declaredRole = CONFIG.propertyRoles[axisName];
    const role = declaredRole || "prop";

    if (role === "css-state") {
      result.stateAxes.push(axisName);
      continue;
    }
    if (role === "responsive") {
      result.responsiveAxes.push(axisName);
      findings.push({
        severity: "info",
        component: figmaEntry.name,
        kind: "responsive-axis",
        detail: `Axis "${axisName}" is a breakpoint/responsive concern (handled by CSS media queries), not a prop.`,
      });
      continue;
    }

    // role === 'prop', either declared or defaulted.
    if (!declaredRole) {
      findings.push({
        severity: "info",
        component: figmaEntry.name,
        kind: "unmappedAxis",
        detail: `Axis "${axisName}" has no CONFIG.propertyRoles entry; treated as 'prop' by default.`,
      });
    }

    const codeProp = findCodeProp(codeEntry, axisName);
    const entryResult = { axis: axisName, figmaValues: values };

    if (!codeProp) {
      entryResult.status = "missing-in-code";
      findings.push({
        severity: "warn",
        component: figmaEntry.name,
        kind: "axis-missing-in-code",
        detail: `Figma axis "${axisName}" (values: ${values.join("/")}) has no matching prop on code component "${codeEntry.name}".`,
      });
    } else {
      entryResult.codeProp = codeProp.key;
      entryResult.codeKind = codeProp.kind;
      const figmaBooleanish = isBooleanish(values);

      if (figmaBooleanish && codeProp.kind === "boolean") {
        entryResult.status = "match";
      } else if (codeProp.kind === "enum") {
        const figmaSet = new Set(values.map(String));
        const codeSet = new Set((codeProp.values || []).map(String));
        const missingInCode = [...figmaSet].filter((v) => !codeSet.has(v)).sort();
        const extraInCode = [...codeSet].filter((v) => !figmaSet.has(v)).sort();
        entryResult.missingInCode = missingInCode;
        entryResult.extraInCode = extraInCode;
        if (missingInCode.length || extraInCode.length) {
          entryResult.status = "value-mismatch";
          findings.push({
            severity: "warn",
            component: figmaEntry.name,
            kind: "enum-mismatch",
            detail:
              `Axis "${axisName}" vs ${codeEntry.name}.${codeProp.key}: ` +
              `missing in code [${missingInCode.join(", ") || "none"}], ` +
              `extra in code [${extraInCode.join(", ") || "none"}].`,
          });
        } else {
          entryResult.status = "match";
        }
      } else {
        entryResult.status = "kind-mismatch";
        findings.push({
          severity: "warn",
          component: figmaEntry.name,
          kind: "prop-kind-mismatch",
          detail: `Axis "${axisName}" (values: ${values.join("/")}) vs ${codeEntry.name}.${codeProp.key}: code prop is kind "${codeProp.kind}", expected enum or boolean.`,
        });
      }
    }
    result.propAxes.push(entryResult);
  }
  return result;
}

// Presence-level check: Figma TEXT properties ⇄ code text/node props, SLOT ⇄ node.
function compareTextSlotProps(figmaEntry, codeEntry, findings) {
  const results = [];
  for (const [propName, def] of Object.entries(figmaEntry.properties || {})) {
    if (def.type !== "TEXT" && def.type !== "SLOT") continue;
    const codeProp = findCodeProp(codeEntry, propName);
    const wantKind = def.type === "TEXT" ? ["text", "node"] : ["node"];
    const ok = !!codeProp && wantKind.includes(codeProp.kind);
    results.push({
      figmaProp: propName,
      type: def.type,
      matchedCodeProp: codeProp?.key ?? null,
      ok,
    });
    if (!ok) {
      findings.push({
        severity: "info",
        component: figmaEntry.name,
        kind: def.type === "TEXT" ? "missing-text-prop" : "missing-slot-prop",
        detail: `Figma ${def.type} property "${propName}" has no corresponding ${wantKind.join("/")} prop on code component "${codeEntry.name}".`,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Eval static gate (react-tsx only) — reuses eval/static-checks.mjs exactly
// the way eval/run.mjs does, so "passes the audit" and "passes `npm run eval`"
// agree on what a static error is.
// ---------------------------------------------------------------------------

function evalReactComponent(codeEntry, figmaName, findings) {
  const specRel = `${SPEC_DIR}/${kebab(codeEntry.name)}.md`;
  const specExists = fs.existsSync(path.join(REPO_ROOT, specRel));
  const source = fs.readFileSync(path.join(REPO_ROOT, codeEntry.file), "utf8");
  const sc = runStaticChecks(source, { specRel: specExists ? specRel : null });
  if (!specExists) {
    sc.findings.unshift({
      ruleId: "spec-required",
      severity: "error",
      line: 0,
      snippet: specRel,
      message: `No spec found at ${specRel}. Every component needs a spec (spec-before-code).`,
    });
    sc.errors += 1;
  }
  if (sc.errors > 0) {
    findings.push({
      severity: "error",
      component: figmaName || codeEntry.name,
      kind: "eval-static-errors",
      detail: `${sc.errors} static error(s) on ${codeEntry.file}: ${sc.findings
        .filter((f) => f.severity === "error")
        .map((f) => f.ruleId)
        .join(", ")}.`,
    });
  }
  return { specRel, specExists, errors: sc.errors, warnings: sc.warnings, findings: sc.findings };
}

// ---------------------------------------------------------------------------
// Human report
// ---------------------------------------------------------------------------

function axesSummary(figmaEntry) {
  if (figmaEntry.kind !== "componentSet") return "-";
  const parts = Object.entries(figmaEntry.axes || {}).map(([a, v]) => `${a}(${v.length})`);
  return parts.length ? parts.join(", ") : "(none)";
}

function propComparisonSummary(comparison) {
  if (!comparison) return "-";
  const { propAxes } = comparison;
  if (propAxes.length === 0) return "(no prop axes)";
  const bad = propAxes.filter((p) => p.status !== "match");
  if (bad.length === 0) return `ok (${propAxes.length}/${propAxes.length} axes match)`;
  return `${propAxes.length - bad.length}/${propAxes.length} match; issues: ${bad
    .map((p) => `${p.axis}:${p.status}`)
    .join(", ")}`;
}

function printHuman({ summary, componentRecords, findings, fractalAbsent }) {
  console.log("Design-system drift audit");
  console.log("==========================");
  console.log(`Figma components: ${summary.figmaComponents}`);
  console.log(`Code components:  ${summary.codeComponents} (react-tsx: ${summary.codeBySource["react-tsx"] || 0}, fractal-config: ${summary.codeBySource["fractal-config"] || 0})`);
  if (fractalAbsent) {
    console.log(`  note: fractal-config source root ("${CONFIG.codeInventory.fractalRoot}/") not found in this repo — reported as absent, not an error.`);
  }
  console.log(`Matched:          ${summary.matched}`);
  console.log(`Figma-only:       ${summary.figmaOnly}`);
  console.log(`Code-only:        ${summary.codeOnly}`);
  console.log(
    `Findings:         ${summary.findingsBySeverity.error} error(s), ${summary.findingsBySeverity.warn} warn(s), ${summary.findingsBySeverity.info} info`
  );

  const matchedRecords = componentRecords.filter((r) => r.matched);
  if (matchedRecords.length) {
    console.log("\nMatched components");
    console.log("-------------------");
    const nameW = Math.max(4, ...matchedRecords.map((r) => r.name.length));
    console.log(
      `  ${"name".padEnd(nameW)}  ${"code file".padEnd(28)}  ${"figma axes".padEnd(30)}  ${"prop comparison".padEnd(40)}  ${"figma status".padEnd(16)}  code status`
    );
    for (const r of matchedRecords) {
      const figmaStatus = r.figma.section?.devStatus ?? "-";
      const codeStatus =
        r.evalStatic != null
          ? `static: ${r.evalStatic.errors} err / ${r.evalStatic.warnings} warn`
          : r.code.status ?? "-";
      console.log(
        `  ${r.name.padEnd(nameW)}  ${r.code.file.padEnd(28)}  ${axesSummary(r.figma).padEnd(30)}  ${propComparisonSummary(
          r.comparison
        ).padEnd(40)}  ${String(figmaStatus).padEnd(16)}  ${codeStatus}`
      );
    }
  }

  const bySeverity = { error: [], warn: [], info: [] };
  for (const f of findings) bySeverity[f.severity].push(f);
  for (const sev of ["error", "warn", "info"]) {
    if (bySeverity[sev].length === 0) continue;
    console.log(`\n${sev.toUpperCase()} (${bySeverity[sev].length})`);
    console.log("-".repeat(sev.length + 4 + String(bySeverity[sev].length).length + 2));
    for (const f of bySeverity[sev]) {
      console.log(`  [${f.kind}] ${f.component}: ${f.detail}`);
    }
  }

  const figmaOnlyNames = componentRecords.filter((r) => !r.matched && r.figma).map((r) => r.name);
  const codeOnlyNames = componentRecords.filter((r) => !r.matched && r.code).map((r) => r.name);

  function printCompactList(title, names) {
    console.log(`\n${title} (${names.length})`);
    console.log("-".repeat(title.length + 4 + String(names.length).length));
    const colW = Math.max(4, ...names.map((n) => n.length)) + 2;
    const perRow = Math.max(1, Math.floor(78 / colW));
    for (let i = 0; i < names.length; i += perRow) {
      console.log("  " + names.slice(i, i + perRow).map((n) => n.padEnd(colW)).join(""));
    }
  }
  if (figmaOnlyNames.length) printCompactList("Figma-only", figmaOnlyNames);
  if (codeOnlyNames.length) printCompactList("Code-only", codeOnlyNames);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const strict = args.includes("--strict");

  if (!fs.existsSync(INVENTORY_FILE)) {
    console.error(
      "audit/figma-inventory.json not found. Run `npm run audit:fetch` (requires FIGMA_TOKEN) to generate it first."
    );
    process.exit(2);
  }
  const figmaInventory = JSON.parse(fs.readFileSync(INVENTORY_FILE, "utf8"));
  const figmaComponents = figmaInventory.components;
  const codeEntries = buildCodeInventory(CONFIG);
  const fractalAbsent = !fractalRootExists(CONFIG);

  const findings = [];

  // --- duplicate normalized names (either side) --------------------------
  const figmaGroups = groupBy(figmaComponents, (c) => normalizeName(c.name));
  for (const [key, group] of figmaGroups) {
    if (group.length > 1) {
      findings.push({
        severity: "warn",
        component: group[0].name,
        kind: "duplicate-figma-name",
        detail: `${group.length} Figma components normalize to "${key}": ${group
          .map((g) => `${g.name} [${g.kind}] (${g.nodeId})`)
          .join(", ")}.`,
      });
    }
  }
  const codeGroups = groupBy(codeEntries, (c) => normalizeName(c.name));
  for (const [key, group] of codeGroups) {
    if (group.length > 1) {
      findings.push({
        severity: "warn",
        component: group[0].name,
        kind: "duplicate-code-name",
        detail: `${group.length} code components normalize to "${key}": ${group
          .map((g) => `${g.name} (${g.file})`)
          .join(", ")}.`,
      });
    }
  }

  // --- join ---------------------------------------------------------------
  const matched = []; // { figma, code }
  const figmaOnly = [];
  for (const figma of figmaComponents) {
    const code = codeEntries.find((c) => figmaMatchesCode(figma.name, c.name));
    if (code) matched.push({ figma, code });
    else figmaOnly.push(figma);
  }
  const codeOnly = codeEntries.filter(
    (c) => !figmaComponents.some((f) => figmaMatchesCode(f.name, c.name))
  );

  // --- per-match comparison + eval -----------------------------------------
  const componentRecords = [];
  for (const { figma, code } of matched) {
    const comparison = figma.kind === "componentSet" ? compareComponentAxes(figma, code, findings) : null;
    const textSlot = compareTextSlotProps(figma, code, findings);
    const evalStatic = code.source === "react-tsx" ? evalReactComponent(code, figma.name, findings) : null;
    componentRecords.push({
      name: figma.name,
      matched: true,
      figma,
      code,
      comparison,
      textSlot,
      evalStatic,
    });
  }

  // --- figma-only / code-only findings -------------------------------------
  for (const f of figmaOnly) {
    const devStatus = f.section?.devStatus;
    const readyForDev = devStatus === "READY_FOR_DEV" || devStatus === "COMPLETED";
    findings.push({
      severity: readyForDev ? "warn" : "info",
      component: f.name,
      kind: "figma-only",
      detail:
        `Figma ${f.kind} "${f.name}" (${f.nodeId}) has no matching code component.` +
        (readyForDev ? ` Section devStatus=${devStatus} says it's ready for dev.` : ""),
    });
    componentRecords.push({ name: f.name, matched: false, figma: f, code: null });
  }
  for (const c of codeOnly) {
    findings.push({
      severity: "warn",
      component: c.name,
      kind: "code-only",
      detail: `Code component "${c.name}" (${c.file}) has no matching Figma component/set.`,
    });
    componentRecords.push({ name: c.name, matched: false, figma: null, code: c });
  }

  // Deterministic ordering: by name, matched before unmatched-figma before unmatched-code
  // (matches insertion order already; keep findings sorted too for stable diffs).
  findings.sort((a, b) => {
    const order = { error: 0, warn: 1, info: 2 };
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    if (a.component !== b.component) return a.component < b.component ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
  });

  const codeBySource = {};
  for (const c of codeEntries) codeBySource[c.source] = (codeBySource[c.source] || 0) + 1;

  const summary = {
    figmaComponents: figmaComponents.length,
    codeComponents: codeEntries.length,
    codeBySource,
    matched: matched.length,
    figmaOnly: figmaOnly.length,
    codeOnly: codeOnly.length,
    findingsBySeverity: {
      error: findings.filter((f) => f.severity === "error").length,
      warn: findings.filter((f) => f.severity === "warn").length,
      info: findings.filter((f) => f.severity === "info").length,
    },
  };

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          generatedFrom: { fileVersion: figmaInventory.fileVersion },
          components: componentRecords,
          findings,
        },
        null,
        2
      )
    );
  } else {
    printHuman({ summary, componentRecords, findings, fractalAbsent });
  }

  const hasError = findings.some((f) => f.severity === "error");
  process.exit(strict && hasError ? 1 : 0);
}

main();
