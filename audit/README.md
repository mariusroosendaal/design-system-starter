# Design-system drift audit

A deterministic audit that compares what exists in Figma against what exists
in code. Two slices so far:

1. **Figma component inventory** (`fetch-figma.mjs`) — walks the SNAP Figma
   file and writes a stable, diffable JSON snapshot of every component set
   and standalone component.
2. **Code inventory + join/drift report** (`code-inventory.mjs`,
   `audit.mjs`) — the code-side counterpart of that snapshot, matched against
   it to produce a findings report. Fully offline: never calls the Figma API,
   only reads the committed `figma-inventory.json`.

## Run

```bash
npm run audit:fetch          # or: node audit/fetch-figma.mjs
node audit/fetch-figma.mjs --json   # print the inventory JSON instead of the summary

npm run audit                # or: node audit/audit.mjs — the join/drift report
node audit/audit.mjs --json    # { generatedFrom, components, findings, rules } instead of the human report
node audit/audit.mjs --strict  # exit 1 if any error-severity finding (CI gate)
node audit/audit.mjs --html    # additionally write a self-contained audit/report.html
npm run audit:report           # shorthand for `node audit/audit.mjs --html`
```

Prints which pages were skipped/scanned, a change summary against the previous
inventory, and a human-readable table; writes `audit/figma-inventory.json`.

**Token setup:** put a Figma personal access token with the **File content**
read scope in the repo-root `.env`:

```
FIGMA_TOKEN=figd_...
```

Configuration (file key, page exclusions, private-component filtering, and
seed maps for the future join step) lives in `audit/config.mjs`.

## What figma-inventory.json contains

For each `COMPONENT_SET` and each standalone `COMPONENT` (not inside a set)
on the scanned pages:

- `name`, `nodeId`, `kind` (`componentSet` | `component`), `page`
- `section` — nearest SECTION ancestor with its `devStatus` (e.g.
  `READY_FOR_DEV`), the file's readiness signal

  How to read `devStatus`: absence of a status is the default state of every
  section, not a "not ready" verdict — designers only set a status when a
  component reaches `READY_FOR_DEV` (or `COMPLETED`). Figma's Dev-Mode
  "changed since marked ready" badge is **not** exposed via REST; the
  committed inventory replaces it — a git diff touching a component whose
  section still says `READY_FOR_DEV` *is* the "status changed" signal,
  per component instead of per section (planned as a report rule in the
  join slice).
- `description` — the Figma component description, when non-empty
- `properties` — component property definitions (variant options, defaults,
  TEXT/BOOLEAN/SLOT props), names normalized (Figma's `#123:456` suffix stripped)
- `variants` / `variantCount` / `axes` — the set's variant matrix
- `boundVariables` — which design-token variables are bound where in the
  component's subtree (property → sorted distinct variable ids)

Plus file identity: `fileKey`, `fileName`, `fileVersion`, `lastModified`,
`pagesScanned`.

## Why the inventory is committed

The output is deterministic — byte-identical across runs when the Figma file
hasn't changed (no fetched-at timestamp, all keys and arrays in stable order).
That means **drift is just `git diff`**: re-run the fetch and the diff shows
exactly which components/variants/tokens changed in Figma since the last
snapshot.

## Freshness

`fileVersion` is recorded in the inventory, so any consumer can tell which
Figma version a snapshot reflects. TODO: record the file version at
token-sync time in `design-system/tokens/figma-sync` as well, so we can
detect "tokens are stale relative to Figma" the same way.

## Code inventory (`code-inventory.mjs`)

`buildCodeInventory(config)` returns a flat array of entries, one common
shape regardless of source:

```
{ name, source: 'react-tsx' | 'fractal-config', file,
  props: { <propName>: { kind: 'enum'|'boolean'|'text'|'node'|'other', values?: [sorted] } },
  status: string|null, specPath: string|null }
```

Two adapters:

- **react-tsx** — scans `src/components/*.tsx` (PascalCase files only), finds
  the component's `<Name>Props` `interface`/`type` declaration, and parses
  its members with regex (no TS compiler, so it's best-effort: unparsable
  files still get an entry, with `props: {}` and a `parseWarning` instead of
  throwing). String-literal unions (inline or via a local `type X = 'a'|'b'`
  alias) → `enum`; `boolean` → `boolean`; `string` → `text`; `ReactNode` /
  the `children` member → `node`; anything else → `other`. Extended
  intrinsic props (`extends ButtonHTMLAttributes<...>`), event handlers
  (`on[A-Z]...`), and `className` are excluded, matching what a human would
  actually consider "this component's own props." `status` is always `null`
  — the React gallery has no readiness field of its own (see "Statuses"
  below for how eval fills that gap). `specPath` comes from a `// Spec: …`
  comment near the top of the file, if present.
- **fractal-config** — reads `<CONFIG.codeInventory.fractalRoot>/**/*.config.json`,
  the client's Craft/Twig convention (folders of `<name>.twig` +
  `<name>.config.json`). `name` comes from the config's `title` (fallback:
  file basename), `status` from its `status` field, and `props` from the
  union of context keys across the default `context` object and every
  `variants[].context` — string values become `enum` axes, booleans become
  `boolean`, and any key that ever holds an object/array value becomes
  `other` (not a comparable primitive axis). **This directory doesn't exist
  in this repo** (it's a React gallery, not a Craft/Twig site) — the adapter
  returns `[]` gracefully rather than throwing, and `audit.mjs` reports the
  source as "absent" rather than as an error. Point `codeInventory.fractalRoot`
  at the real template root to use this against a client codebase.

## The join (`audit.mjs`)

1. Load `audit/figma-inventory.json` (offline — if missing, it tells you to
   run `npm run audit:fetch` and exits 2; it never calls the Figma API
   itself).
2. Build the code inventory.
3. **Match** a Figma component to a code component when their names are
   equal after normalizing both (lowercase, trim, spaces/underscores →
   hyphens), or when `CONFIG.aliases[figmaNormalized] === codeNormalized`.
   Matching happens per Figma *entry*, not per de-duplicated name — so two
   Figma sets that share a normalized name (see "duplicate-figma-name"
   below) are each matched/unmatched independently.
4. **Compare variant axes to code props**, per `CONFIG.propertyRoles`:
   - `'css-state'` — the axis becomes a CSS pseudo-state in code (SNAP's
     `state` axis: default/hovered/pressed/focused). Excluded from prop
     comparison; counted as `stateAxes`.
   - `'responsive'` — the axis is a breakpoint/viewport variant, handled by
     CSS media queries rather than a prop (SNAP's `breakpoint` axis).
     Excluded from prop comparison; reported as an `info` note.
   - `'prop'` (declared or defaulted) — the axis must exist as a code prop
     under a normalized-key match (strip spaces/hyphens/underscores,
     lowercase, so `'is open'` matches `isOpen` or `is_open`). Boolean-ish
     Figma axes (`[false, true]`) match a `boolean` code prop; otherwise
     enum value sets are diffed (`missingInCode` / `extraInCode`).
   - Any axis **not** listed in `propertyRoles` still gets compared as
     `'prop'` (the safe default) but also raises an `unmappedAxis` info
     finding, so gaps in the role map are visible instead of silently
     mis-scored.
   - Figma `TEXT` properties ⇄ code `text`/`node` props and `SLOT` ⇄ `node`
     get a presence-only check (`info` if missing — these aren't variant
     axes, just "does the component expose a way to fill this in").
5. **Statuses**: Figma's is the section's `devStatus` (see slice 1's README
   section on `devStatus`). Code's is the fractal `status` field for
   fractal-config components, or — for react-tsx components — the result of
   running `eval/static-checks.mjs`'s `runStaticChecks` against the source,
   with the spec path derived exactly like `eval/run.mjs` does (`kebab-case`
   the component name → `design-system/components/<kebab>.md`), so "passes
   the audit" and "passes `npm run eval`" mean the same thing.
6. **Findings** (`{ severity: 'error'|'warn'|'info', component, kind, detail, why }`):
   every finding carries a `why` — a short, instance-specific clause
   explaining *this particular* severity (not just the general rule for its
   `kind`). See "Severity legend and rules" below for the full registry.
7. **Output**: human report (summary → per-matched-component table → severity
   legend → findings grouped as ACTION NEEDED / FOR COMPLETENESS, each
   grouped by `kind` with that kind's rule sentence printed once → compact
   figma-only/code-only lists) or, with `--json`,
   `{ generatedFrom: { fileVersion }, components: [...], findings: [...], rules: {...} }`,
   or, with `--html`, a self-contained `audit/report.html` (see below).
   Deterministic — no timestamps, findings sorted by severity/component/kind
   so a re-run against the same inputs diffs cleanly. Exit code is always 0
   unless `--strict` is passed and at least one `error`-severity finding
   exists, in which case it's 1 (mirrors `eval`'s CI gate).

### Severity legend and rules

- **error** — blocks `--strict`.
- **warn** — a contradiction someone should act on.
- **info** — expected state, listed for completeness.

The `RULES` registry in `audit.mjs` is the explicit, single source of truth
for what each finding `kind` means and why it gets the severity it does.
`figma-only` is the one **conditional** kind — its severity depends on the
instance (the section's `devStatus`), which is why every finding also carries
a per-instance `why` rather than relying on the kind's rule sentence alone.

| kind | severity | rule |
| --- | --- | --- |
| `figma-only` | conditional | warn when the section is marked READY_FOR_DEV/COMPLETED (design says ready, nothing built); info otherwise (backlog — expected). |
| `code-only` | warn | a code component exists with no matching Figma component/set — either Figma is missing it or the names have drifted apart. |
| `axis-missing-in-code` | warn | a Figma variant axis has no corresponding prop on the matched code component. |
| `enum-mismatch` | warn | a Figma axis and its matched code prop both exist, but their value sets disagree. |
| `prop-kind-mismatch` | warn | a Figma axis matches a code prop by name, but the prop's kind isn't enum/boolean as a variant axis needs. |
| `eval-static-errors` | error | a matched react-tsx component fails `eval/static-checks.mjs` — the hard, deterministic style-guide rules from CLAUDE.md. |
| `duplicate-figma-name` / `duplicate-code-name` | warn | two or more entries on the same side normalize to the same name, so the join can't tell them apart. |
| `unmappedAxis` | info | a variant axis has no `CONFIG.propertyRoles` entry, so it's treated as `'prop'` by default — a coverage gap in the map, not necessarily a bug. |
| `responsive-axis` | info | a variant axis is a breakpoint/responsive concern, handled by CSS media queries rather than a component prop. |
| `missing-text-prop` / `missing-slot-prop` | info | a Figma TEXT/SLOT property has no corresponding text/node prop on the matched code component — presence-only check, not a variant axis. |

### Reading the report

The per-matched-component table's "prop comparison" column is a quick
pass/fail count (`N/M match; issues: axis:status, …`); the findings list
underneath has the actual detail (and `why`) for each mismatch. A finding
being reported isn't necessarily a bug in the code — e.g. Button's Figma set
has `variant` values `destructive`/`primary`/`secondary`/`tertiary` where the
code only has `primary`/`secondary`/`ghost`; that's a real, known gap (see
`design-system/components/button.md`: "secondary/ghost are token-derived
conventions pending Figma definition") that the tool is meant to surface, not
hide.

### HTML report (`--html`)

`node audit/audit.mjs --html` (or `npm run audit:report`) writes
`audit/report.html` alongside the usual output — a single self-contained
file (inline CSS + vanilla JS, no external requests, no build step) styled
in SNAP's own visual language, since it's a report about SNAP. It has:

- Header with file name/version and 5 summary stat tiles.
- The same severity legend as above, always visible.
- A component board — one row per Figma component plus any code-only
  entries — with a Figma deep link, code file, dev-status chip, code status,
  a per-axis variant-coverage bar for matched components (or just the axis
  summary for unmatched ones), and clickable findings-count chips per
  severity that filter the findings section to that component.
- The findings section, grouped exactly like the human report (ACTION
  NEEDED / FOR COMPLETENESS → by kind → rule sentence → findings with their
  `why`).
- Small vanilla-JS filters: a name search box, All/Matched/Figma-only/
  Code-only toggle chips, and a "has warnings" toggle.

It's built from the same report model as `--json` (see `buildReportModel()`
in `audit.mjs` and `renderHtmlReport()` in `report-html.mjs`) — no duplicated
comparison logic — and is fully deterministic (no timestamps; re-running
against the same inputs produces a byte-identical file). `audit/report.html`
is gitignored — it's a generated artifact, regenerate it any time with
`npm run audit:report`.

## Roadmap

Remaining:

1. **Token-binding drift** — join each component's Figma `boundVariables`
   (variable ids) against the token-sync plugin-id→name map, so a component
   using a variable that's since been renamed/removed shows up here instead
   of only at token-sync time.
2. **Sync-freshness recording** — record the Figma `fileVersion` at
   token-sync time (see slice 1's README "Freshness" section) so this report
   can flag "tokens are stale relative to the Figma file this audit just
   read."
3. **CI wiring** — run `npm run audit -- --strict` alongside `eval:all` on
   every PR once the false-positive rate on a real client repo (with a real
   `fractalRoot`) has been checked.
4. **Visual diff** — Figma screenshot vs. rendered code, for components that
   pass the structural join but may have drifted visually.

`spike-figma-accordion.mjs` is the throwaway exploration this was built from
(its raw dumps in `spike-output/` are gitignored).
