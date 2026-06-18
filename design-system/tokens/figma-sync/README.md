# Figma → token sync

Pull Figma variables, text styles, and effect styles into the SNAP token JSON —
**deterministically, no LLM**. One-way: Figma owns the values, the JSON is
regenerated from them, then `build.mjs` regenerates `dist/tokens.css`.

This exists because the Figma **Variables REST API is Enterprise-only**, and we
don't want an LLM relaying a few hundred values (the non-determinism we're
avoiding). A plugin reads variables via the Plugin API — available on every plan
— and a tiny local server writes the result to disk.

```
figma-sync/
  transform.mjs       the deterministic core: Figma export → 5 token files (pure, testable)
  transform.test.mjs  offline proof of the core (npm run sync:test)
  sync.mjs            CLI: export.json → token files → tokens.css  (npm run sync)
  sync-server.mjs     localhost receiver the plugin posts to       (npm run sync:serve)
  plugin/             the Figma plugin (vanilla JS, no build step)
    manifest.json · code.js · ui.html
```

## How the pieces fit

```
┌─ Figma ─────────────┐         ┌─ your machine ───────────────────────────┐
│ SNAP Token Sync     │  POST   │ sync-server.mjs ─→ transform.mjs ─→ *.json│
│ plugin (Plugin API) │ ──────► │                          └─→ build.mjs ─→ │
│  reads vars+styles  │ :41789  │                             dist/tokens.css│
└─────────────────────┘         └───────────────────────────────────────────┘
```

`transform.mjs` is the whole brain and is Figma-agnostic — it eats a plain JSON
export and is covered by `transform.test.mjs`. The plugin and server are thin.

## Usage (the normal loop)

1. **Start the server** (in the repo): `npm run sync:serve`
2. **In Figma**, run the **SNAP Token Sync** plugin → click **Read & Sync to repo**.
   (Use **Dry run** first to preview, or **Download export JSON** to sync via CLI.)
3. **Review** the diff: `git diff design-system/tokens` then `npm run eval:all`.
4. **Commit** the token JSON and the regenerated `dist/tokens.css`.

CLI equivalent (e.g. from a downloaded export):

```bash
npm run sync -- path/to/figma-export.json            # write + rebuild
npm run sync -- export.json --dry-run                # preview, write nothing
npm run sync -- export.json --report                 # coverage only
npm run sync -- export.json --only=color,dimension   # subset of files
```

## Installing the plugin (once)

Figma → **Plugins → Development → Import plugin from manifest…** → pick
`design-system/tokens/figma-sync/plugin/manifest.json`. It runs locally; no
publishing needed. The manifest only allows network access to
`http://localhost:41789` — nothing leaves your machine.

## The mapping (and how to tune it after the first run)

All routing lives in `CONFIG` at the top of `transform.mjs`. The key idea: a
**variable's name already is its token path** — `background/interactive-primary`
⇒ `background.interactive-primary`, `color/ink/100` ⇒ `color.ink.100`. So the
config only routes **collection → file**; the path falls out of the name, and
aliases resolve through a global id→path index.

| Figma source | → token file | modes |
| --- | --- | --- |
| `color primitives`, `size primitives`, `typography primitives` collections | `primitives.json` | single |
| `color` collection | `color.json` | theme (`light`) |
| `responsive` collection | `dimension.json` | breakpoint (`sm`–`2xl`) |
| `typography` collection (`fontWeight/*`) | `typography.json` | single |
| **text styles** (`<role>/<bp>`, `…/<bp>-strong`) | `typography.json` `ramp.*` | breakpoint ranges |
| **effect styles** (`shadow-sm`, `shadow-md`, `focus`) | `elevation.json` | — |

**If your Figma names differ from these defaults**, the first real run tells you:

```bash
npm run sync -- figma-export.json --report
```

Unmapped collections and unparsed style names are listed. Adjust `CONFIG`:

- `collections` — add/rename the collection→file routes
- `modeAliases` — if Figma modes are named oddly (e.g. `Desktop` → `lg`)
- `textStyles.namePattern` — if text styles aren't named `role/bp`
- `effectStyles.nameMap` — if shadow styles are named differently
- `unitless` — FLOAT values that must not get a `px` suffix (e.g. `layout.columns`)

### What's robust vs. what to verify

- **Solid:** primitives, semantic color (aliases), responsive dimensions
  (breakpoint compression matches the hand-authored `ds.modes` exactly).
- **Verify on first run:** the **typography ramp** and **shadows** depend on
  text/effect-style *naming* and on font sizes existing in the `fontSize` scale.
  Where the transformer can't map cleanly it warns and falls back to a raw value
  rather than guessing — so a bad name surfaces as a warning + a visible diff,
  never a silent wrong token. Use `--only` to sync just the solid files until
  the ramp mapping is confirmed.

## Notes

- **Source of truth.** Values now flow Figma → JSON. The JSON's structural
  conventions (`$type`, `$extensions.ds.*`) are emitted by the transformer; each
  file's prose `$description` is carried forward from the existing file.
- **No `.json` lands in `tokens/` except the five token files** — `build.mjs`
  globs `tokens/*.json`. Keep exports/fixtures here under `figma-sync/`.
- Stop the server with Ctrl-C. Port override: `SNAP_SYNC_PORT=xxxx npm run sync:serve`
  (also change it in `plugin/manifest.json`'s `allowedDomains`).
