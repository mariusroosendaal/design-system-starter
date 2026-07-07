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
import { renderHtmlReport } from "./report-html.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY_FILE = path.join(__dirname, "figma-inventory.json");

// Kept identical to eval/run.mjs's own kebab-case + spec-path derivation so
// "does this component have a spec / pass static checks" means the same
// thing here as it does in `npm run eval`.
const kebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const SPEC_DIR = "design-system/components";

// ---------------------------------------------------------------------------
// Severity rules registry — one entry per finding `kind`.
//
// This is the explicit contract behind every finding's severity: `severity`
// is either a fixed level or 'conditional' (meaning: it depends on the
// instance — see each finding's own `why` field for the specific reason).
// `rule` is the plain-language sentence printed once per kind-group in the
// human report, the HTML report, and under `rules` in --json output.
// ---------------------------------------------------------------------------
const RULES = {
  "figma-only": {
    severity: "conditional",
    rule: "warn when the section is marked READY_FOR_DEV/COMPLETED (design says ready, nothing built); info otherwise (backlog — expected).",
  },
  "code-only": {
    severity: "warn",
    rule: "a code component exists with no matching Figma component/set — either Figma is missing it or the names have drifted apart.",
  },
  "axis-missing-in-code": {
    severity: "warn",
    rule: "a Figma variant axis has no corresponding prop on the matched code component.",
  },
  "enum-mismatch": {
    severity: "warn",
    rule: "a Figma axis and its matched code prop both exist, but their value sets disagree.",
  },
  "prop-kind-mismatch": {
    severity: "warn",
    rule: "a Figma axis matches a code prop by name, but the prop's kind isn't enum/boolean as a variant axis needs.",
  },
  "eval-static-errors": {
    severity: "error",
    rule: "a matched react-tsx component fails eval/static-checks.mjs — the hard, deterministic style-guide rules from CLAUDE.md.",
  },
  "duplicate-figma-name": {
    severity: "warn",
    rule: "two or more Figma entries normalize to the same name, so the join can't tell them apart.",
  },
  "duplicate-code-name": {
    severity: "warn",
    rule: "two or more code entries normalize to the same name, so the join can't tell them apart.",
  },
  unmappedAxis: {
    severity: "info",
    rule: "a variant axis has no CONFIG.propertyRoles entry, so it's treated as 'prop' by default — a coverage gap in the map, not necessarily a bug.",
  },
  "responsive-axis": {
    severity: "info",
    rule: "a variant axis is a breakpoint/responsive concern, handled by CSS media queries rather than a component prop.",
  },
  "missing-text-prop": {
    severity: "info",
    rule: "a Figma TEXT property has no corresponding text/node prop on the matched code component — presence-only check, not a variant axis.",
  },
  "missing-slot-prop": {
    severity: "info",
    rule: "a Figma SLOT property has no corresponding node prop on the matched code component — presence-only check, not a variant axis.",
  },
};

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
        why: "CONFIG.propertyRoles marks this axis 'responsive'; SNAP components are responsive via CSS media queries, not a JS prop switch.",
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
        why: `No propertyRoles entry for "${axisName}" — defaulting to 'prop' so the gap in the map is visible instead of silently mis-scored.`,
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
        why: `Figma defines this axis but no code prop on "${codeEntry.name}" matches it under normalized-key comparison.`,
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
            why: `Both sides define this axis/prop, but their value sets disagree — a real gap unless the Figma/code naming convention is expected to differ.`,
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
          why: `Code prop "${codeProp.key}" exists under this name but is kind "${codeProp.kind}", not the enum/boolean a variant axis needs.`,
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
        why: `This is a presence-only check, not a variant axis: Figma exposes a ${def.type.toLowerCase()} to fill in, but "${codeEntry.name}" has no ${wantKind.join("/")} prop for it.`,
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
      why: "Static style-guide checks (eval/static-checks.mjs) failed — these are the hard CLAUDE.md rules, always an error regardless of Figma state.",
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

// Group findings into the report's two buckets — ACTION NEEDED (error, then
// warn) and FOR COMPLETENESS (info) — then by `kind` within each severity,
// kinds sorted alphabetically so grouping is deterministic regardless of
// insertion order. Shared by the human report and the HTML report.
function groupFindingsForReport(findings) {
  function groupSeverity(sevList) {
    const byKind = new Map();
    for (const f of findings) {
      if (!sevList.includes(f.severity)) continue;
      if (!byKind.has(f.kind)) byKind.set(f.kind, []);
      byKind.get(f.kind).push(f);
    }
    return [...byKind.keys()].sort().map((kind) => ({
      kind,
      rule: RULES[kind]?.rule ?? "(no rule registered for this kind)",
      findings: byKind.get(kind),
    }));
  }
  return {
    actionNeeded: [...groupSeverity(["error"]), ...groupSeverity(["warn"])],
    forCompleteness: groupSeverity(["info"]),
  };
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

  console.log("\nSeverity legend");
  console.log("---------------");
  console.log("  error = blocks --strict");
  console.log("  warn  = contradiction someone should act on");
  console.log("  info  = expected state, listed for completeness");

  const { actionNeeded, forCompleteness } = groupFindingsForReport(findings);

  function printFindingGroups(title, groups) {
    if (!groups.length) return;
    const total = groups.reduce((n, g) => n + g.findings.length, 0);
    console.log(`\n${title} (${total})`);
    console.log("=".repeat(title.length + 4 + String(total).length));
    for (const g of groups) {
      const sev = g.findings[0].severity.toUpperCase();
      console.log(`\n${sev} — ${g.kind} (${g.findings.length})`);
      console.log(`  rule: ${g.rule}`);
      for (const f of g.findings) {
        console.log(`  - ${f.component}: ${f.detail}`);
        console.log(`      why: ${f.why}`);
      }
    }
  }
  printFindingGroups("ACTION NEEDED", actionNeeded);
  printFindingGroups("FOR COMPLETENESS", forCompleteness);

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
// Report model — the one structure consumed by the human report, --json,
// and the --html report. Comparison/join logic lives only here; every
// output format renders from this, so they can never disagree.
// ---------------------------------------------------------------------------

function buildReportModel() {
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
        why: `${group.length} Figma nodes share the normalized name "${key}"; the join can only match code by name, so this needs a rename or a CONFIG.aliases entry to disambiguate.`,
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
        why: `${group.length} code entries share the normalized name "${key}"; the join can only match Figma by name, so this needs a rename or a CONFIG.aliases entry to disambiguate.`,
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
      why: readyForDev
        ? `Section says devStatus=${devStatus} but no code exists — design has signaled readiness, so this needs a build (or a status correction).`
        : "No dev status set on the section; unbuilt backlog is the normal, default state.",
    });
    componentRecords.push({ name: f.name, matched: false, figma: f, code: null });
  }
  for (const c of codeOnly) {
    findings.push({
      severity: "warn",
      component: c.name,
      kind: "code-only",
      detail: `Code component "${c.name}" (${c.file}) has no matching Figma component/set.`,
      why: "No Figma component/set normalizes to this name — check for a rename, a missing alias, or a component built ahead of its Figma definition.",
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

  const hasError = findings.some((f) => f.severity === "error");

  return {
    generatedFrom: {
      fileKey: figmaInventory.fileKey,
      fileName: figmaInventory.fileName,
      fileVersion: figmaInventory.fileVersion,
    },
    summary,
    componentRecords,
    findings,
    rules: RULES,
    fractalAbsent,
    hasError,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const strict = args.includes("--strict");
  const htmlMode = args.includes("--html");

  const model = buildReportModel();

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          generatedFrom: { fileVersion: model.generatedFrom.fileVersion },
          components: model.componentRecords,
          findings: model.findings,
          rules: model.rules,
        },
        null,
        2
      )
    );
  } else {
    printHuman(model);
  }

  if (htmlMode) {
    const html = renderHtmlReport(model, { groupFindingsForReport, axesSummary });
    const outFile = path.join(__dirname, "report.html");
    fs.writeFileSync(outFile, html);
    console.error(`Wrote ${path.relative(REPO_ROOT, outFile)}`);
  }

  process.exit(strict && model.hasError ? 1 : 0);
}

main();
