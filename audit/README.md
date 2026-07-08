# Design-system drift audit

Deterministic comparison of what exists in Figma against what exists in code.
No LLM anywhere; every output is byte-stable, so drift shows up as a git diff.

## Run

```bash
npm run audit:fetch     # snapshot Figma → audit/figma-inventory.json (committed)
npm run audit           # offline join + drift report (reads the snapshots only)
npm run audit:report    # same, plus self-contained audit/report.html
node audit/audit.mjs --json     # machine-readable report
node audit/audit.mjs --strict   # exit 1 on any error-severity finding (CI gate)
```

**Token setup:** `FIGMA_TOKEN=figd_...` in the repo-root `.env` (personal access
token, **File content** read scope). All tuning — file key, page filters,
private-component filtering, name aliases, property roles — lives in
`audit/config.mjs`.

## The Figma inventory (`fetch-figma.mjs`)

One entry per component set / standalone component on the scanned pages:
`name`/`nodeId`/`kind`/`page`, nearest section with its `devStatus`,
normalized `properties`, `variants`/`axes`, and `boundVariables`
(property → variable ids), plus `fileKey`/`fileName`/`fileVersion`/
`lastModified`. Private (`.`/`_`-prefixed) components are skipped.

How to read `devStatus`: absence of a status is the default state, not a
"not ready" verdict — designers set `READY_FOR_DEV`/`COMPLETED` explicitly.
Figma's Dev-Mode "changed since marked ready" badge is not exposed via REST;
the committed inventory replaces it — a git diff touching a component whose
section still says `READY_FOR_DEV` *is* that signal, per component.

## The variable map (`design-system/dist/variable-map.json`)

Resolves the raw `VariableID`s in each component's `boundVariables` into
published token names (`--background-surface`) — the deterministic answer to a
spec's "Tokens used" section. It's a **by-product of the token sync** (`npm run
sync`; `npm run sync:map` rebuilds just the map from a saved export), built from
the same export and `tokenPath()` as the token files so map and tokens can't
disagree — see `design-system/tokens/figma-sync/variable-map.mjs`. The audit
only reads it, and skips the binding join when it's absent.

Each entry is `{ name, collection, kind, token }`: **`var`** (ships as a custom
property) · **`type-class`** (ships as a `.type-*` ramp class) · **`untracked`**
(Figma defines it, the build doesn't emit it — the drift signal) ·
**`composite`** (an input to another token, never standalone). Bound ids absent
from the map are **remote** (`VariableID:<file-key>/…`, from a subscribed
library), a **stale map** (regenerate), or — when they survive a fresh sync —
**dangling bindings** to deleted variables, fixable only in the design file.

## The code inventory (`code-inventory.mjs`)

`buildCodeInventory(config)` → flat array, one shape for all sources:

```
{ name, source: 'react-tsx' | 'fractal-config', file,
  props: { <propName>: { kind: 'enum'|'boolean'|'text'|'node'|'other', values?: [sorted] } },
  status: string|null }
```

- **react-tsx** — regex-parses `<Name>Props` from `src/components/*.tsx`
  (string-literal unions → `enum`, `boolean`, `string` → `text`,
  `ReactNode`/`children` → `node`; extended HTML attrs, `on*` handlers and
  `className` excluded). Best-effort: unparsable files get `props: {}` plus a
  `parseWarning` instead of throwing.
- **fractal-config** — reads `<codeInventory.fractalRoot>/**/*.config.json`,
  the client Craft/Twig convention (`<name>.twig` + `<name>.config.json`):
  `title`, `status`, props derived from the variant `context` keys. The root
  doesn't exist in this repo, so the source is reported as absent — point
  `fractalRoot` at a real template root to use it.

## The join (`audit.mjs`)

- **Match** on normalized names (lowercase, spaces/underscores → hyphens),
  plus `CONFIG.aliases` for the rest.
- **Axes vs props** via `CONFIG.propertyRoles`: `css-state` (SNAP's `state`)
  and `responsive` (`breakpoint`) axes are excluded from prop comparison —
  they're pseudo-states / media queries in code. Everything else must exist
  as a code prop under a normalized-key match (`'is open'` ⇄ `isOpen`);
  `[false, true]` axes match boolean props, enum value sets are diffed.
  Axes missing from the role map still compare as props but raise an
  `unmapped-axis` info finding. Figma TEXT/SLOT properties get a
  presence-only check.
- **Statuses**: Figma = section `devStatus`; code = the fractal `status`
  field, or `eval/static-checks.mjs` for react components (same spec-path
  logic as `eval/run.mjs`, so "passes the audit" = "passes `npm run eval`").
- Exit code 0 unless `--strict` and at least one error-severity finding.

### Severities

- **error** — blocks `--strict`.
- **warn** — a contradiction someone should act on.
- **info** — expected state, listed for completeness.

The per-kind severities and rule sentences live in the `RULES` registry at the
top of `audit.mjs` — the single source of truth, printed with every report
(each finding group opens with its rule). Findings carry a `why` only when the
reason is instance-specific: whether a `figma-only` component is marked ready
for dev, or which cause explains an `unresolved-binding`.

A finding isn't necessarily a code bug — e.g. Button's `ghost` variant is a
known, documented gap (`design-system/components/button.md`). Surfacing that
is the tool working.

### HTML report (`--html` / `npm run audit:report`)

Writes `audit/report.html`: a single self-contained file (inline CSS/JS, no
external requests) in SNAP's own visual language — summary tiles, the
severity legend, a filterable component board (Figma deep links, dev-status
chips, per-axis variant-coverage bars, clickable findings chips), and the
grouped findings with their whys. Built from the same report model as
`--json`; deterministic; gitignored — regenerate any time.

## Roadmap

1. ~~**Token-binding drift** — join `boundVariables` ids against the token-sync
   plugin's id→name map.~~ Done — see "The variable map" above
   (`binds-untracked-token` / `unresolved-binding` findings, per-component token
   lists in `--json` and the HTML board).
2. **Sync freshness** — record `fileVersion` at token-sync time to flag
   "tokens stale relative to Figma".
3. **CI wiring** — `audit --strict` alongside `eval:all` once tested against
   a real client repo with a real `fractalRoot`.
4. **Visual diff** — Figma render vs code screenshot for components that pass
   the structural join.
