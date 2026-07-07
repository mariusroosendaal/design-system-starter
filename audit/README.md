# Design-system drift audit

First slice of a deterministic audit that compares what exists in Figma
against what exists in code. This slice is the **Figma component inventory**:
a script that walks the SNAP Figma file and writes a stable, diffable JSON
snapshot of every component set and standalone component.

## Run

```bash
npm run audit:fetch          # or: node audit/fetch-figma.mjs
node audit/fetch-figma.mjs --json   # print the inventory JSON instead of the summary
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

## Roadmap

Next slices:

1. **Code-inventory adapters** — the code-side counterpart of this snapshot:
   a Fractal-style `config.json` reader for the client Craft/Twig stack, and
   a TS-union/props parser for this repo's React gallery.
2. **Join + drift report** — match Figma components to code components (via
   `CONFIG.aliases`), map variant axes to props/CSS states (via
   `CONFIG.propertyRoles`), and report what exists in one world but not the
   other, per-axis coverage gaps, and token-binding mismatches.

`spike-figma-accordion.mjs` is the throwaway exploration this was built from
(its raw dumps in `spike-output/` are gitignored).
