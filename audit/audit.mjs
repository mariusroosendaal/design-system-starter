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
import { buildCodeInventory, fractalRootExists } from "./code-inventory.mjs";
import { repoRoot as REPO_ROOT, runStaticChecksWithSpecGate } from "../eval/lib/context.mjs";
import { normalizeName, axesSummary, READY_DEV_STATUSES, loadVariableMap, resolveBindings } from "./lib.mjs";
import { renderHtmlReport } from "./report-html.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY_FILE = path.join(__dirname, "figma-inventory.json");

// ---------------------------------------------------------------------------
// Severity rules registry — one entry per finding `kind`.
//
// This is the explicit contract behind every finding's severity: `severity`
// is either a fixed level or 'conditional' (it depends on the instance).
// `rule` is the plain-language sentence printed once per kind-group in the
// human report, the HTML report, and under `rules` in --json output — it IS
// the "why" for most findings. A finding carries its own `why` only when the
// reason is genuinely instance-specific (conditional severity, cause
// diagnosis); the reports print it only then.
// ---------------------------------------------------------------------------
const RULES = {
  "figma-only": {
    severity: "conditional",
    rule: "warn when the section is marked READY_FOR_DEV/COMPLETED (design says ready, nothing built); info otherwise (backlog — expected).",
  },
  "code-only": {
    severity: "warn",
    rule: "a code component exists with no matching Figma component/set — check for a rename, a missing CONFIG.aliases entry, or a component built ahead of its Figma definition.",
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
    rule: "two or more Figma entries normalize to the same name, so the join can't tell them apart — rename one or disambiguate via CONFIG.aliases.",
  },
  "duplicate-code-name": {
    severity: "warn",
    rule: "two or more code entries normalize to the same name, so the join can't tell them apart — rename one or disambiguate via CONFIG.aliases.",
  },
  "unmapped-axis": {
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
  "parse-warning": {
    severity: "info",
    rule: "the react-tsx adapter couldn't parse this component's props; its comparison is incomplete.",
  },
  "binds-untracked-token": {
    severity: "warn",
    rule: "a component binds a Figma variable that names a real token but has no published CSS custom property — either the token needs adding to the token JSON, or the Figma variable is stray; a faithful build can't reference it until that's resolved.",
  },
  "unresolved-binding": {
    severity: "info",
    rule: "a component binds variable ids the token map couldn't resolve — remote/library variables (not in the local plugin export), a variable map that's stale relative to the inventory (regenerate: `npm run sync:map`), or a dangling binding to a variable deleted in Figma (persists after a fresh sync — rebind or detach it in the design file).",
  },
};

// Append one finding. Severity comes from the registry unless the kind is
// conditional, in which case opts.severity is required. opts.why is only for
// instance-specific reasons — omit it when the kind's rule says it all.
function pushFinding(findings, kind, component, detail, opts = {}) {
  const severity = opts.severity ?? RULES[kind].severity;
  const f = { severity, component, kind, detail };
  if (opts.why) f.why = opts.why;
  findings.push(f);
}

// ---------------------------------------------------------------------------
// Name / key normalization
// ---------------------------------------------------------------------------

// Stricter key normalization for matching a Figma axis name to a code prop
// name: strip spaces/hyphens/underscores entirely, lowercase. This is what
// lets 'is open' match `isOpen` (react-tsx) or `is_open` (fractal).
function normalizeKey(name) {
  return name.toLowerCase().replace(/[\s\-_]+/g, "");
}

// Build a normalized-code-name → entry lookup for the join, once. When two
// code entries normalize to the same name, the first one (in codeEntries
// order) wins — matching the old `codeEntries.find(...)` semantics (that
// case is separately flagged as `duplicate-code-name`).
function buildCodeByNormalizedName(codeEntries) {
  const map = new Map();
  for (const c of codeEntries) {
    const key = normalizeName(c.name);
    if (!map.has(key)) map.set(key, c);
  }
  return map;
}

// Find the code entry a Figma name joins to: a direct normalized-name match,
// falling back to CONFIG.aliases (keyed by normalized Figma name, valued by
// normalized code name) — same alias semantics as the old figmaMatchesCode.
function findMatchingCode(figmaName, codeByName) {
  const f = normalizeName(figmaName);
  if (codeByName.has(f)) return codeByName.get(f);
  const aliasTarget = CONFIG.aliases[f];
  if (aliasTarget && codeByName.has(aliasTarget)) return codeByName.get(aliasTarget);
  return null;
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
      pushFinding(findings, "responsive-axis", figmaEntry.name,
        `Axis "${axisName}" is a breakpoint/responsive concern (handled by CSS media queries), not a prop.`);
      continue;
    }

    // role === 'prop', either declared or defaulted.
    if (!declaredRole) {
      pushFinding(findings, "unmapped-axis", figmaEntry.name,
        `Axis "${axisName}" has no CONFIG.propertyRoles entry; treated as 'prop' by default.`);
    }

    const codeProp = findCodeProp(codeEntry, axisName);
    const entryResult = { axis: axisName, figmaValues: values };

    if (!codeProp) {
      entryResult.status = "missing-in-code";
      pushFinding(findings, "axis-missing-in-code", figmaEntry.name,
        `Figma axis "${axisName}" (values: ${values.join("/")}) has no matching prop on code component "${codeEntry.name}".`);
      result.propAxes.push(entryResult);
      continue;
    }

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
      entryResult.codeValues = [...codeSet].sort();
      if (missingInCode.length || extraInCode.length) {
        entryResult.status = "value-mismatch";
        pushFinding(findings, "enum-mismatch", figmaEntry.name,
          `Axis "${axisName}" vs ${codeEntry.name}.${codeProp.key}: ` +
            `missing in code [${missingInCode.join(", ") || "none"}], ` +
            `extra in code [${extraInCode.join(", ") || "none"}].`);
      } else {
        entryResult.status = "match";
      }
    } else {
      entryResult.status = "kind-mismatch";
      pushFinding(findings, "prop-kind-mismatch", figmaEntry.name,
        `Axis "${axisName}" (values: ${values.join("/")}) vs ${codeEntry.name}.${codeProp.key}: code prop is kind "${codeProp.kind}", expected enum or boolean.`);
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
      pushFinding(findings, def.type === "TEXT" ? "missing-text-prop" : "missing-slot-prop", figmaEntry.name,
        `Figma ${def.type} property "${propName}" has no corresponding ${wantKind.join("/")} prop on code component "${codeEntry.name}".`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Token-binding join — resolve a component's boundVariables against the
// variable map (see README "The variable map"). Attaches a `bindings` block
// to the record; pushes findings as a side effect.
// ---------------------------------------------------------------------------

function resolveTokenBindings(figmaEntry, varMap, findings) {
  const bindings = resolveBindings(figmaEntry.boundVariables, varMap);

  for (const u of bindings.untracked) {
    pushFinding(findings, "binds-untracked-token", figmaEntry.name,
      `binds Figma variable "${u.collection}/${u.name}" (${u.id}) as ${u.fields.join(", ")}, which has no published token in the built stylesheet.`);
  }

  const absent = bindings.unresolved.length + bindings.remote.length;
  if (absent > 0) {
    const parts = [];
    if (bindings.remote.length) parts.push(`${bindings.remote.length} remote/library`);
    if (bindings.unresolved.length) parts.push(`${bindings.unresolved.length} not in the local map`);
    pushFinding(findings, "unresolved-binding", figmaEntry.name,
      `${absent} bound variable id(s) unresolved (${parts.join(", ")}): ${[...bindings.remote, ...bindings.unresolved]
        .map((u) => `${u.id} (bound as ${u.fields.join(", ")})`)
        .join("; ")}.`,
      {
        // Which of the rule's three causes applies is per-instance — say so.
        why: bindings.remote.length
          ? "Remote ids come from a subscribed library file and aren't in the local plugin export by design; any non-remote ids mean either a stale variable map (regenerate with `npm run sync:map`) or — if they persist after a fresh sync — dangling bindings to variables deleted in Figma, which only rebinding/detaching in the design file can fix."
          : "These ids aren't in the variable map — either it's stale relative to the inventory (regenerate with `npm run sync:map`) or, if they persist after a fresh sync, the variables were deleted in Figma and the component carries dangling bindings; rebind or detach them in the design file.",
      });
  }

  return bindings;
}

// ---------------------------------------------------------------------------
// Eval static gate (react-tsx only) — reuses eval/static-checks.mjs (via the
// shared eval/lib/context.mjs helper) exactly the way eval/run.mjs does, so
// "passes the audit" and "passes `npm run eval`" agree on what a static
// error is. Uses the source text already read by code-inventory.mjs's
// react-tsx adapter (`codeEntry.rawSource`) instead of re-reading the file.
// ---------------------------------------------------------------------------

function evalReactComponent(codeEntry, figmaName, findings) {
  const sc = runStaticChecksWithSpecGate(codeEntry.rawSource, codeEntry.name);
  if (sc.errors > 0) {
    pushFinding(findings, "eval-static-errors", figmaName || codeEntry.name,
      `${sc.errors} static error(s) on ${codeEntry.file}: ${sc.findings
        .filter((f) => f.severity === "error")
        .map((f) => f.ruleId)
        .join(", ")}.`);
  }
  return { errors: sc.errors, warnings: sc.warnings, findings: sc.findings };
}

// ---------------------------------------------------------------------------
// Human report
// ---------------------------------------------------------------------------

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
  function groupSeverity(severity) {
    const byKind = new Map();
    for (const f of findings) {
      if (f.severity !== severity) continue;
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
    actionNeeded: [...groupSeverity("error"), ...groupSeverity("warn")],
    forCompleteness: groupSeverity("info"),
  };
}

function printHuman({ summary, componentRecords, findings, fractalAbsent, variableMapAbsent, groupedFindings }) {
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
  if (variableMapAbsent) {
    console.log(`Token bindings:   (skipped — no ${CONFIG.paths.variableMap}; run \`npm run sync\` or \`npm run sync:map\` to generate it)`);
  } else {
    const tb = summary.tokenBindings;
    console.log(
      `Token bindings:   ${tb.distinctTokens} distinct token(s) across ${tb.componentsResolved} component(s); ${tb.untracked} untracked, ${tb.unresolved} unresolved`
    );
  }
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

  const { actionNeeded, forCompleteness } = groupedFindings;

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
        if (f.why) console.log(`      why: ${f.why}`);
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
  // Optional: the token-binding map. Absent until `npm run sync:map` is run —
  // the binding join is simply skipped when it's missing (like fractalRoot).
  const varMap = loadVariableMap();

  const findings = [];

  // --- duplicate normalized names (either side) --------------------------
  for (const [key, group] of groupBy(figmaComponents, (c) => normalizeName(c.name))) {
    if (group.length > 1) {
      pushFinding(findings, "duplicate-figma-name", group[0].name,
        `${group.length} Figma components normalize to "${key}": ${group
          .map((g) => `${g.name} [${g.kind}] (${g.nodeId})`)
          .join(", ")}.`);
    }
  }
  for (const [key, group] of groupBy(codeEntries, (c) => normalizeName(c.name))) {
    if (group.length > 1) {
      pushFinding(findings, "duplicate-code-name", group[0].name,
        `${group.length} code components normalize to "${key}": ${group
          .map((g) => `${g.name} (${g.file})`)
          .join(", ")}.`);
    }
  }

  // --- join ---------------------------------------------------------------
  // Normalize each side once and join via a Map (O(n+m) instead of an
  // O(n*m) scan per Figma component), preserving figmaMatchesCode's alias
  // semantics: a direct normalized-name match wins, falling back to
  // CONFIG.aliases[normalizedFigmaName] as the code-side lookup key. When
  // several code entries share a normalized name, the first one (in
  // codeEntries order) is the one that can be joined — same as the old
  // `codeEntries.find(...)` — the rest still surface via duplicate-code-name.
  const codeByName = buildCodeByNormalizedName(codeEntries);
  const matched = []; // { figma, code }
  const figmaOnly = [];
  const consumedCodeNames = new Set();
  for (const figma of figmaComponents) {
    const code = findMatchingCode(figma.name, codeByName);
    if (code) {
      matched.push({ figma, code });
      consumedCodeNames.add(normalizeName(code.name));
    } else {
      figmaOnly.push(figma);
    }
  }
  const codeOnly = codeEntries.filter((c) => !consumedCodeNames.has(normalizeName(c.name)));

  // --- per-match comparison + eval -----------------------------------------
  const componentRecords = [];
  for (const { figma, code } of matched) {
    const comparison = figma.kind === "componentSet" ? compareComponentAxes(figma, code, findings) : null;
    const textSlot = compareTextSlotProps(figma, code, findings);
    const evalStatic = code.source === "react-tsx" ? evalReactComponent(code, figma.name, findings) : null;
    if (code.parseWarning) {
      pushFinding(findings, "parse-warning", figma.name, `${code.file}: ${code.parseWarning}`);
    }
    const bindings = varMap ? resolveTokenBindings(figma, varMap, findings) : null;
    componentRecords.push({
      name: figma.name,
      matched: true,
      figma,
      code,
      comparison,
      textSlot,
      evalStatic,
      bindings,
    });
  }

  // --- figma-only / code-only findings -------------------------------------
  for (const f of figmaOnly) {
    const devStatus = f.section?.devStatus;
    const readyForDev = READY_DEV_STATUSES.includes(devStatus);
    pushFinding(findings, "figma-only", f.name,
      `Figma ${f.kind} "${f.name}" (${f.nodeId}) has no matching code component.` +
        (readyForDev ? ` Section devStatus=${devStatus} says it's ready for dev.` : ""),
      {
        severity: readyForDev ? "warn" : "info",
        why: readyForDev
          ? `Section says devStatus=${devStatus} but no code exists — design has signaled readiness, so this needs a build (or a status correction).`
          : "No dev status set on the section; unbuilt backlog is the normal, default state.",
      });
    const bindings = varMap ? resolveTokenBindings(f, varMap, findings) : null;
    componentRecords.push({ name: f.name, matched: false, figma: f, code: null, bindings });
  }
  for (const c of codeOnly) {
    pushFinding(findings, "code-only", c.name,
      `Code component "${c.name}" (${c.file}) has no matching Figma component/set.`);
    if (c.parseWarning) {
      pushFinding(findings, "parse-warning", c.name, `${c.file}: ${c.parseWarning}`);
    }
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

  // Token-binding rollup across every component that has a resolved `bindings`
  // block (null when the map is absent, so this stays 0/0/0 in that case).
  const bound = componentRecords.filter((r) => r.bindings);
  const tokenBindings = {
    componentsResolved: bound.length,
    distinctTokens: new Set(bound.flatMap((r) => r.bindings.tokens)).size,
    untracked: bound.reduce((n, r) => n + r.bindings.untracked.length, 0),
    unresolved: bound.reduce((n, r) => n + r.bindings.unresolved.length + r.bindings.remote.length, 0),
  };

  const summary = {
    figmaComponents: figmaComponents.length,
    codeComponents: codeEntries.length,
    codeBySource,
    matched: matched.length,
    figmaOnly: figmaOnly.length,
    codeOnly: codeOnly.length,
    tokenBindings,
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
    groupedFindings: groupFindingsForReport(findings),
    rules: RULES,
    fractalAbsent,
    variableMapAbsent: !varMap,
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
    const html = renderHtmlReport(model, { axesSummary });
    const outFile = path.join(__dirname, "report.html");
    fs.writeFileSync(outFile, html);
    console.error(`Wrote ${path.relative(REPO_ROOT, outFile)}`);
  }

  process.exit(strict && model.hasError ? 1 : 0);
}

main();
