# Design-system drift audit

Deterministic comparison of what exists in Figma against what exists in code.
No LLM anywhere; every output is byte-stable, so drift shows up as a git diff.

## Run

```bash
npm run audit:fetch     # snapshot Figma → audit/figma-inventory.json (committed)
npm run audit           # offline join + drift report (reads the snapshot only)
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

### Severity legend and rules

- **error** — blocks `--strict`.
- **warn** — a contradiction someone should act on.
- **info** — expected state, listed for completeness.

Every finding carries a per-instance `why`; the `RULES` registry in
`audit.mjs` is the source of truth:

| kind | severity | rule |
| --- | --- | --- |
| `figma-only` | conditional | warn when the section says READY_FOR_DEV/COMPLETED (design says ready, nothing built); info otherwise (backlog — expected). |
| `code-only` | warn | code component with no Figma counterpart — missing in Figma, or names drifted. |
| `axis-missing-in-code` | warn | a Figma variant axis has no matching code prop. |
| `enum-mismatch` | warn | axis and prop both exist but their value sets disagree. |
| `prop-kind-mismatch` | warn | name matches, but the prop isn't enum/boolean as an axis needs. |
| `eval-static-errors` | error | matched react component fails the hard style-guide checks. |
| `duplicate-figma-name` / `duplicate-code-name` | warn | two entries normalize to the same name; the join can't tell them apart. |
| `unmapped-axis` | info | axis has no `propertyRoles` entry — a gap in the map, not necessarily a bug. |
| `responsive-axis` | info | breakpoint axis, handled by media queries rather than a prop. |
| `missing-text-prop` / `missing-slot-prop` | info | Figma TEXT/SLOT property with no text/node prop; presence-only check. |
| `parse-warning` | info | the react-tsx adapter couldn't parse this component's props; its comparison is incomplete. |

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

1. **Token-binding drift** — join `boundVariables` ids against the token-sync
   plugin's id→name map.
2. **Sync freshness** — record `fileVersion` at token-sync time to flag
   "tokens stale relative to Figma".
3. **CI wiring** — `audit --strict` alongside `eval:all` once tested against
   a real client repo with a real `fractalRoot`.
4. **Visual diff** — Figma render vs code screenshot for components that pass
   the structural join.
