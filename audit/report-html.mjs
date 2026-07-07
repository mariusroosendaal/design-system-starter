// Self-contained HTML rendering for `node audit/audit.mjs --html`.
//
// Consumes the same report model (built once in audit.mjs's
// buildReportModel()) as the human report and --json — no duplicated
// comparison/join logic here, just presentation. Inline CSS + vanilla JS,
// no external requests, no build step, opens straight from file://.
// Deterministic: no timestamps, no Math.random, no Map/Set iteration order
// dependency — same inputs always produce byte-identical output.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../eval/lib/context.mjs";
import { READY_DEV_STATUSES } from "./lib.mjs";

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function figmaUrl(fileKey, nodeId) {
  return `https://www.figma.com/design/${fileKey}/?node-id=${nodeId.replace(/:/g, "-")}`;
}

// Fixed-total bar: segments = total distinct values (capped at 12 so a huge
// enum doesn't blow out the layout), filled = matched, scaled proportionally
// once capped.
function bar(matched, total) {
  if (total <= 0) return "";
  const segments = Math.min(total, 12);
  const filled = Math.max(0, Math.min(segments, Math.round((matched / total) * segments)));
  return "▮".repeat(filled) + "░".repeat(segments - filled);
}

// Light-theme palette — sourced from design-system/dist/tokens.css at
// report-generation time (same regex-extraction technique as
// eval/lib/context.mjs's buildTokenReference) rather than hand-copied hex,
// so the report can't silently drift from the real primitives. Falls back
// to the literal values below if tokens.css is missing.
const LIGHT_PALETTE_FALLBACK = {
  ink: "#0a152b",
  blueImpactful: "#001f5c",
  blueBold: "#313bfb",
  blueOptimistic: "#dbf5ff",
  redBold: "#eb1600",
  greenBold: "#00821c",
};

function parseTokenHex(css, varName) {
  const re = new RegExp(`${varName}\\s*:\\s*(#[0-9a-fA-F]{3,8})`);
  const m = re.exec(css);
  return m ? m[1] : null;
}

function loadLightPalette() {
  let css = null;
  try {
    css = readFileSync(join(repoRoot, "design-system/dist/tokens.css"), "utf8");
  } catch {
    css = null; // tokens.css missing — fall back to the literal palette below.
  }
  if (!css) return LIGHT_PALETTE_FALLBACK;
  const get = (varName, fallback) => parseTokenHex(css, varName) ?? fallback;
  return {
    ink: get("--color-ink-100", LIGHT_PALETTE_FALLBACK.ink),
    blueImpactful: get("--color-blue-impactful", LIGHT_PALETTE_FALLBACK.blueImpactful),
    blueBold: get("--color-blue-bold", LIGHT_PALETTE_FALLBACK.blueBold),
    blueOptimistic: get("--color-blue-optimistic", LIGHT_PALETTE_FALLBACK.blueOptimistic),
    redBold: get("--color-red-bold", LIGHT_PALETTE_FALLBACK.redBold),
    greenBold: get("--color-green-bold", LIGHT_PALETTE_FALLBACK.greenBold),
  };
}

const PALETTE = loadLightPalette();

const CSS = `
:root {
  --ground: #ffffff;
  --panel: ${PALETTE.ink}0a;
  --hairline: ${PALETTE.ink}33;
  --strong-line: ${PALETTE.ink}e5;
  --text: ${PALETTE.ink};
  --muted: ${PALETTE.ink}99;
  --primary-navy: ${PALETTE.blueImpactful};
  --accent-blue: ${PALETTE.blueBold};
  --pale-blue: ${PALETTE.blueOptimistic};
  --green: ${PALETTE.greenBold};
  --red: ${PALETTE.redBold};
  --on-solid: #ffffff;
}
/* SNAP defines no dark-mode tokens in Figma yet, so this block is hand-authored (not derived from tokens.css). */
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #0a152b;
    --panel: #ffffff0a;
    --hairline: #ffffff26;
    --strong-line: #ffffffcc;
    --text: #eef4ff;
    --muted: #b6c4de;
    --primary-navy: #7d84ff;
    --accent-blue: #7d84ff;
    --pale-blue: #81eef333;
    --green: #4ddb60;
    --red: #ff6a57;
    --on-solid: #0a152b;
  }
}
* { box-sizing: border-box; }
*, *::before, *::after { border-radius: 0 !important; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--ground);
  color: var(--text);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
}
.mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.tabular { font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.hidden { display: none !important; }
a.link { color: var(--accent-blue); text-decoration: none; border-bottom: 1px solid currentColor; }
a.link:hover { opacity: 0.8; }

.section-label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  margin: 0 0 8px;
}

.page-header { padding: 24px; border-bottom: 1px solid var(--strong-line); }
.page-title { font-size: 20px; font-weight: 700; color: var(--primary-navy); margin: 0; }
.page-meta { color: var(--muted); font-size: 13px; margin-top: 6px; }
.stat-tiles {
  display: flex; flex-wrap: wrap; gap: 1px;
  background: var(--hairline); border: 1px solid var(--hairline);
  margin-top: 18px;
}
.stat-tile { flex: 1 1 120px; background: var(--ground); padding: 12px 16px; }
.stat-num { font-size: 26px; font-weight: 700; }
.stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-top: 4px; }

.legend-strip {
  display: flex; flex-wrap: wrap; gap: 20px;
  padding: 12px 24px; background: var(--panel);
  border-bottom: 1px solid var(--hairline);
  font-size: 13px;
}
.legend-item { display: flex; align-items: center; gap: 8px; }

.chip {
  display: inline-block; padding: 1px 6px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
  border: 1px solid currentColor; white-space: nowrap;
}
.chip-error { color: var(--red); border-color: var(--red); }
.chip-warn { color: var(--primary-navy); border-color: var(--primary-navy); }
.chip-info { color: var(--muted); border-color: var(--hairline); }
.chip-outline-green { color: var(--green); border-color: var(--green); background: transparent; }
.chip-solid-green { color: var(--on-solid); background: var(--green); border-color: var(--green); }
.chip-btn { cursor: pointer; background: none; font-family: inherit; }
.chip-btn:hover { opacity: 0.75; }

.filters {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  padding: 12px 24px; border-bottom: 1px solid var(--hairline);
}
.filters input[type="text"] {
  border: 1px solid var(--hairline); background: var(--ground); color: var(--text);
  padding: 6px 8px; font-family: inherit; font-size: 13px; min-width: 200px;
}
.toggle-chip {
  border: 1px solid var(--hairline); background: var(--ground); color: var(--text);
  padding: 5px 10px; font-size: 12px; cursor: pointer; font-family: inherit;
}
.toggle-chip.active { border-color: var(--accent-blue); color: var(--accent-blue); }

#board { padding: 0 24px 24px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
th {
  text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--strong-line);
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted);
}
td { padding: 10px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
tr.board-row.hidden { display: none; }
.name-cell { font-weight: 600; }
.tag {
  display: inline-block; margin-left: 6px; font-size: 9px; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--muted); border: 1px solid var(--hairline); padding: 1px 4px;
  font-weight: 400;
}
.axis-row { margin-bottom: 8px; }
.axis-row:last-child { margin-bottom: 0; }
.axis-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.axis-name { font-weight: 600; }
.axis-bar { color: var(--accent-blue); }
.axis-note { color: var(--muted); margin-top: 2px; font-size: 12px; }
.axis-extra { margin-top: 6px; font-size: 12px; }
.chip-row { display: flex; gap: 4px; flex-wrap: wrap; }

#findings { padding: 24px; border-top: 1px solid var(--strong-line); }
.filter-banner {
  padding: 8px 12px; margin-bottom: 16px; background: var(--panel);
  border: 1px solid var(--hairline); font-size: 13px;
}
.filter-banner button {
  margin-left: 10px; border: 1px solid var(--hairline); background: var(--ground);
  color: var(--text); cursor: pointer; font-family: inherit; padding: 2px 8px; font-size: 12px;
}
.kind-group { margin-bottom: 22px; }
.kind-head { display: flex; align-items: center; gap: 8px; }
.kind-name { font-weight: 700; }
.kind-count { font-size: 12px; }
.kind-rule { margin: 4px 0 10px; font-size: 13px; }
.finding { padding: 8px 0; border-bottom: 1px solid var(--hairline); }
.finding.hidden { display: none; }
.finding-component { font-weight: 600; }
.finding-detail { margin-top: 2px; }
.finding-why { margin-top: 2px; font-size: 12px; }

footer { padding: 16px 24px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--hairline); }
`;

function statTile(num, label) {
  return `<div class="stat-tile"><div class="stat-num tabular">${num}</div><div class="stat-label">${escapeHtml(label)}</div></div>`;
}

function devStatusChip(devStatus) {
  // "is ready" gate uses the shared READY_DEV_STATUSES list; which chip
  // style (outline vs solid) to use for each ready value stays local.
  if (!READY_DEV_STATUSES.includes(devStatus)) return `<span class="muted">—</span>`;
  if (devStatus === "READY_FOR_DEV") return `<span class="chip chip-outline-green">READY_FOR_DEV</span>`;
  return `<span class="chip chip-solid-green">COMPLETED</span>`;
}

function axisCoverageHtml(axisResult) {
  const { axis, figmaValues, status } = axisResult;
  let matched, total, note = null;
  if (status === "match") {
    total = figmaValues.length;
    matched = total;
  } else if (status === "missing-in-code") {
    total = figmaValues.length;
    matched = 0;
    note = `figma: ${figmaValues.join(",")} · code: — (no matching prop)`;
  } else if (status === "kind-mismatch") {
    total = figmaValues.length;
    matched = 0;
    note = `figma: ${figmaValues.join(",")} · code: ${axisResult.codeProp} (kind: ${axisResult.codeKind})`;
  } else {
    // value-mismatch: audit.mjs's compareComponentAxes already attaches the
    // matched code prop's full value set as `codeValues` — no need to
    // reconstruct it from the missing/extra diff.
    const missingInCode = axisResult.missingInCode || [];
    const extraInCode = axisResult.extraInCode || [];
    matched = figmaValues.length - missingInCode.length;
    total = figmaValues.length + extraInCode.length;
    note = `figma: ${figmaValues.join(",")} · code: ${(axisResult.codeValues || []).join(",")}`;
  }
  return `
    <div class="axis-row">
      <div class="axis-head">
        <span class="axis-name">${escapeHtml(axis)}</span>
        <span class="axis-bar mono">${bar(matched, total)}</span>
        <span class="mono tabular">${matched}/${total}</span>
      </div>
      ${note ? `<div class="axis-note mono">${escapeHtml(note)}</div>` : ""}
    </div>`;
}

function variantsCellHtml(record, { axesSummary }) {
  if (record.matched) {
    if (record.figma.kind !== "componentSet" || !record.comparison) return `<span class="muted">—</span>`;
    const parts = [];
    for (const axisResult of record.comparison.propAxes) parts.push(axisCoverageHtml(axisResult));
    if (record.comparison.stateAxes.length) {
      parts.push(
        `<div class="axis-extra muted">state (css pseudo-class, not compared): ${escapeHtml(
          record.comparison.stateAxes.join(", ")
        )}</div>`
      );
    }
    if (record.comparison.responsiveAxes.length) {
      parts.push(
        `<div class="axis-extra muted">responsive (media query, not a prop): ${escapeHtml(
          record.comparison.responsiveAxes.join(", ")
        )}</div>`
      );
    }
    return parts.length ? parts.join("") : `<span class="muted">(no prop axes)</span>`;
  }
  if (record.figma && record.figma.kind === "componentSet") {
    return `<span class="mono">${escapeHtml(axesSummary(record.figma))}</span>`;
  }
  return `<span class="muted">—</span>`;
}

function severityChipsHtml(name, counts) {
  const order = ["error", "warn", "info"];
  const chips = order
    .filter((s) => counts && counts[s] > 0)
    .map(
      (s) =>
        `<button type="button" class="chip chip-${s} chip-btn" data-filter-component="${escapeHtml(
          name
        )}">${s.toUpperCase()} ${counts[s]}</button>`
    );
  return chips.length ? `<div class="chip-row">${chips.join("")}</div>` : `<span class="muted">—</span>`;
}

function componentRowHtml(record, model, countsByComponent, helpers) {
  const name = record.name;
  const kindTag = record.figma ? (record.figma.kind === "componentSet" ? "set" : "component") : record.code ? "code" : "";
  const page = record.figma?.page ?? "—";
  const figmaCell = record.figma
    ? `<a class="mono link" href="${figmaUrl(model.generatedFrom.fileKey, record.figma.nodeId)}" target="_blank" rel="noopener noreferrer">open</a>`
    : `<span class="muted">—</span>`;
  const codeCell = record.code?.file ? `<span class="mono">${escapeHtml(record.code.file)}</span>` : `<span class="muted">—</span>`;
  const devChip = devStatusChip(record.figma?.section?.devStatus);
  let codeStatusCell;
  if (record.evalStatic) {
    codeStatusCell = `<span class="mono tabular">${record.evalStatic.errors} err / ${record.evalStatic.warnings} warn</span>`;
  } else if (record.code?.status) {
    codeStatusCell = `<span class="mono">${escapeHtml(record.code.status)}</span>`;
  } else {
    codeStatusCell = `<span class="muted">—</span>`;
  }
  const status = record.matched ? "matched" : record.figma ? "figma-only" : "code-only";
  const counts = countsByComponent.get(name);
  const hasWarn = !!counts && (counts.warn > 0 || counts.error > 0);

  return `
    <tr class="board-row" data-name="${escapeHtml(name.toLowerCase())}" data-status="${status}" data-haswarn="${hasWarn}">
      <td class="name-cell">${escapeHtml(name)}${kindTag ? `<span class="tag">${escapeHtml(kindTag)}</span>` : ""}</td>
      <td>${escapeHtml(page)}</td>
      <td>${figmaCell}</td>
      <td>${codeCell}</td>
      <td>${devChip}</td>
      <td>${codeStatusCell}</td>
      <td>${variantsCellHtml(record, helpers)}</td>
      <td>${severityChipsHtml(name, counts)}</td>
    </tr>`;
}

function findingGroupHtml(group) {
  const sev = group.findings[0].severity;
  const findingsHtml = group.findings
    .map(
      (f) => `
      <div class="finding" data-component="${escapeHtml(f.component)}" data-severity="${f.severity}">
        <div class="finding-component mono">${escapeHtml(f.component)}</div>
        <div class="finding-detail">${escapeHtml(f.detail)}</div>
        <div class="finding-why muted">why: ${escapeHtml(f.why)}</div>
      </div>`
    )
    .join("");
  return `
    <div class="kind-group" data-kind="${escapeHtml(group.kind)}">
      <div class="kind-head">
        <span class="chip chip-${sev}">${sev.toUpperCase()}</span>
        <span class="kind-name mono">${escapeHtml(group.kind)}</span>
        <span class="kind-count muted">(${group.findings.length})</span>
      </div>
      <div class="kind-rule">${escapeHtml(group.rule)}</div>
      ${findingsHtml}
    </div>`;
}

function findingsSectionHtml(model) {
  const { actionNeeded, forCompleteness } = model.groupedFindings;
  const actionCount = actionNeeded.reduce((n, g) => n + g.findings.length, 0);
  const completenessCount = forCompleteness.reduce((n, g) => n + g.findings.length, 0);
  return `
    <section id="findings">
      <h2 class="section-label">Findings</h2>
      <div id="component-filter-banner" class="filter-banner hidden">
        Showing findings for <span id="component-filter-name" class="mono"></span>
        <button type="button" id="clear-component-filter">clear</button>
      </div>
      <h3 class="section-label">Action needed (${actionCount})</h3>
      ${actionNeeded.length ? actionNeeded.map(findingGroupHtml).join("") : `<p class="muted">None.</p>`}
      <h3 class="section-label">For completeness (${completenessCount})</h3>
      ${forCompleteness.length ? forCompleteness.map(findingGroupHtml).join("") : `<p class="muted">None.</p>`}
    </section>`;
}

export function renderHtmlReport(model, helpers) {
  const { generatedFrom, summary, componentRecords, findings } = model;

  const countsByComponent = new Map();
  for (const f of findings) {
    if (!countsByComponent.has(f.component)) countsByComponent.set(f.component, { error: 0, warn: 0, info: 0 });
    countsByComponent.get(f.component)[f.severity]++;
  }

  const rowsHtml = componentRecords.map((r) => componentRowHtml(r, model, countsByComponent, helpers)).join("");
  const findingsHtml = findingsSectionHtml(model);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SNAP · Component drift report</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${CSS}</style>
</head>
<body>
  <header class="page-header">
    <h1 class="page-title">SNAP · Component drift report</h1>
    <div class="page-meta">file: <span class="mono">${escapeHtml(generatedFrom.fileName)}</span> · fileVersion <span class="mono">${escapeHtml(
    String(generatedFrom.fileVersion)
  )}</span></div>
    <div class="stat-tiles">
      ${statTile(summary.figmaComponents, "Figma components")}
      ${statTile(summary.codeComponents, "Code components")}
      ${statTile(summary.matched, "Matched")}
      ${statTile(summary.findingsBySeverity.warn, "Warns")}
      ${statTile(summary.findingsBySeverity.error, "Errors")}
    </div>
  </header>

  <section class="legend-strip">
    <div class="legend-item"><span class="chip chip-error">ERROR</span> blocks --strict</div>
    <div class="legend-item"><span class="chip chip-warn">WARN</span> contradiction someone should act on</div>
    <div class="legend-item"><span class="chip chip-info">INFO</span> expected state, listed for completeness</div>
  </section>

  <div class="filters">
    <input type="text" id="search-input" placeholder="Search components…" aria-label="Search components by name">
    <button type="button" class="toggle-chip status-chip active" data-status-filter="all">All</button>
    <button type="button" class="toggle-chip status-chip" data-status-filter="matched">Matched</button>
    <button type="button" class="toggle-chip status-chip" data-status-filter="figma-only">Figma-only</button>
    <button type="button" class="toggle-chip status-chip" data-status-filter="code-only">Code-only</button>
    <button type="button" class="toggle-chip" id="warn-toggle">Has warnings</button>
  </div>

  <section id="board">
    <h2 class="section-label">Component board</h2>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Page</th>
          <th>Figma</th>
          <th>Code file</th>
          <th>Dev status</th>
          <th>Code status</th>
          <th>Variants</th>
          <th>Findings</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </section>

  ${findingsHtml}

  <footer>
    generated from figma-inventory.json fileVersion <span class="mono">${escapeHtml(
      String(generatedFrom.fileVersion)
    )}</span> · deterministic — regenerate with <span class="mono">npm run audit:report</span>
  </footer>

  <script>
  (function () {
    var rows = Array.prototype.slice.call(document.querySelectorAll(".board-row"));
    var findingEls = Array.prototype.slice.call(document.querySelectorAll(".finding"));
    var searchInput = document.getElementById("search-input");
    var statusChips = Array.prototype.slice.call(document.querySelectorAll(".status-chip"));
    var warnToggle = document.getElementById("warn-toggle");
    var banner = document.getElementById("component-filter-banner");
    var bannerName = document.getElementById("component-filter-name");
    var clearBtn = document.getElementById("clear-component-filter");
    var findingsSection = document.getElementById("findings");

    var state = { search: "", status: "all", warnOnly: false, component: null };

    function applyBoardFilter() {
      rows.forEach(function (row) {
        var matchesSearch = state.search === "" || row.dataset.name.indexOf(state.search) !== -1;
        var matchesStatus = state.status === "all" || row.dataset.status === state.status;
        var matchesWarn = !state.warnOnly || row.dataset.haswarn === "true";
        row.classList.toggle("hidden", !(matchesSearch && matchesStatus && matchesWarn));
      });
    }

    function applyFindingsFilter() {
      findingEls.forEach(function (f) {
        var show = !state.component || f.dataset.component === state.component;
        f.classList.toggle("hidden", !show);
      });
      if (state.component) {
        banner.classList.remove("hidden");
        bannerName.textContent = state.component;
      } else {
        banner.classList.add("hidden");
        bannerName.textContent = "";
      }
    }

    searchInput.addEventListener("input", function () {
      state.search = this.value.trim().toLowerCase();
      applyBoardFilter();
    });

    statusChips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        state.status = chip.dataset.statusFilter;
        statusChips.forEach(function (c) { c.classList.toggle("active", c === chip); });
        applyBoardFilter();
      });
    });

    warnToggle.addEventListener("click", function () {
      state.warnOnly = !state.warnOnly;
      warnToggle.classList.toggle("active", state.warnOnly);
      applyBoardFilter();
    });

    Array.prototype.slice.call(document.querySelectorAll(".chip-btn[data-filter-component]")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.component = btn.dataset.filterComponent;
        applyFindingsFilter();
        findingsSection.scrollIntoView({ behavior: "smooth" });
      });
    });

    clearBtn.addEventListener("click", function () {
      state.component = null;
      applyFindingsFilter();
    });

    applyBoardFilter();
    applyFindingsFilter();
  })();
  </script>
</body>
</html>
`;
}
