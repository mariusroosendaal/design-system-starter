---
name: sync-tokens
description: Sync Figma variables/styles into the SNAP token JSON via the deterministic (no-LLM) transformer, then review the diff. Use when asked to sync tokens from Figma, pull design tokens, update tokens after a Figma change, or re-sync the token JSON. Usage - /sync-tokens [--dry-run]
---

# Sync design tokens from Figma

Goal: pull Figma variables + text/effect styles into `design-system/tokens/*.json`
deterministically, regenerate `dist/tokens.css`, and hand back a reviewable diff.
The transform is plain code (`design-system/tokens/figma-sync/transform.mjs`) —
you orchestrate it, you do **not** transform values yourself. Never hand-edit
token values to "match Figma"; that defeats the determinism.

Full design + mapping config: `design-system/tokens/figma-sync/README.md`.

## 1. Confirm the core is healthy

```bash
npm run sync:test
```

Must pass before syncing. If it fails, the transformer regressed — stop and report.

## 2. Get the export to the transformer (two paths)

**A — companion server (preferred).** The user runs `npm run sync:serve` and clicks
**Read & Sync to repo** in the SNAP Token Sync plugin. The server writes the files
and rebuilds. You won't run a command for the sync itself — confirm the server is
up (`curl -s localhost:41789/health`) and tell the user to click Sync (or Dry run).

**B — downloaded export.** If the user has a `figma-export.json` (the plugin's
"Download export JSON" button), run it through the CLI yourself:

```bash
npm run sync -- <path-to-export.json> --report      # first: see coverage
npm run sync -- <path-to-export.json> --dry-run     # preview the diff
npm run sync -- <path-to-export.json>                # write + rebuild tokens.css
```

If invoked with `--dry-run`, stop after the dry-run and report what would change.

## 3. Read the report before trusting the write

From `--report` (or the server's warnings), check:

- **Unmapped collections** / **skipped style names** → the Figma names don't match
  `CONFIG` in `transform.mjs`. Surface these; don't paper over them. Point at the
  README's "tune the mapping" section (`collections`, `ignoreCollections`,
  `segmentRename`, `effectStyles.nameMap`, `unitless`).
- **Warnings** (e.g. a font size not in the `fontSize` scale) → a real gap between
  Figma and the token scale. Report each; the transformer fell back to a raw value
  rather than guessing, so it shows up as a visible diff.

If only the typography ramp / shadows look off, sync the solid files first with
`--only=primitives,color,dimension` and flag the rest for mapping work.

## 4. Review + report

- `git diff --stat design-system/tokens` then `git diff design-system/tokens` —
  summarize what changed (added/removed/retargeted tokens), not just file names.
- Run `npm run eval:all` — token changes can break components (e.g. a renamed or
  dropped semantic token). Report failures with the component + finding.
- **Result:** list changed files, notable token changes, any unmapped/warned items,
  and the eval outcome. Remind the user to commit both the token JSON and the
  regenerated `dist/tokens.css`. Do not commit unless asked.

If a sync would drop a semantic token a component depends on, call it out as a
breaking change rather than letting it ride.
