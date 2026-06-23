# Figma → token sync

Pull Figma variables, text styles, and effect styles into the SNAP token JSON —
**deterministically, no LLM**. One-way: Figma owns the values, the JSON is
regenerated from them, then `build.mjs` regenerates `dist/tokens.css`.

This exists because the Figma **Variables REST API is Enterprise-only**, and we
don't want an LLM relaying a few hundred values (the non-determinism we're
avoiding). A plugin reads variables via the Plugin API — available on every plan
— and either a tiny local server writes the result to disk, **or** the plugin
commits the export to GitHub and a CI Action opens a token-sync PR.

Two delivery paths, same deterministic core (`transform.mjs`):

- **Local** — `npm run sync:serve`, click **Read & Sync to repo**, commit by hand.
- **GitHub** — click **Sync to GitHub & open PR**: no local server, the diff
  arrives as a reviewed, eval-gated PR. (Still a human click — Figma plugins
  can't run headlessly, and the REST API that could is Enterprise-only.)

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

Or, the GitHub path — same brain, different delivery (no local server):

```
┌─ Figma ─────────────┐  commit export   ┌─ GitHub ─────────────────────────────┐
│ SNAP Token Sync     │  via REST API     │ branch figma-sync/incoming           │
│ plugin (Plugin API) │ ────────────────► │   └─ push triggers Action:           │
│  + your PAT         │  api.github.com   │      transform.mjs → build → eval     │
└─────────────────────┘                   │      → opens/updates a token PR       │
                                          └──────────────────────────────────────┘
```

`transform.mjs` is the whole brain and is Figma-agnostic — it eats a plain JSON
export and is covered by `transform.test.mjs`. The plugin and server are thin.
The Action lives at `.github/workflows/figma-token-sync.yml`.

## Usage (the normal loop)

1. **Start the server** (in the repo): `npm run sync:serve`
2. **In Figma**, run the **SNAP Token Sync** plugin → click **Read & Sync to repo**.
   (Use **Dry run** first to preview, or **Download export JSON** to sync via CLI.)
3. **Review** the diff: `git diff design-system/tokens` then `npm run eval:all`.
4. **Commit** the token JSON and the regenerated `dist/tokens.css`.

> **Restart the server after editing any `figma-sync/*.mjs`.** Node caches modules
> at process start, so a long-running `npm run sync:serve` keeps using the code it
> launched with — edits to `transform.mjs` won't take effect until you Ctrl-C and
> restart it. (The CLI always runs fresh.)

CLI equivalent (e.g. from a downloaded export):

```bash
npm run sync -- path/to/figma-export.json            # write + rebuild
npm run sync -- export.json --dry-run                # preview, write nothing
npm run sync -- export.json --report                 # coverage only
npm run sync -- export.json --only=color,dimension   # subset of files
```

## Usage via GitHub (no local server)

For a designer who just wants to push changes without running anything locally:

1. In the plugin, fill in **GitHub repo** (`owner/name`) and a **GitHub token**,
   then click **Sync to GitHub & open PR**.
2. The plugin commits the export to the **`figma-sync/incoming`** branch. That push
   triggers `.github/workflows/figma-token-sync.yml`, which transforms the export,
   runs `build` + `eval:all`, and opens/updates a single **token-sync PR** — but
   only if tokens actually drifted (no diff ⇒ no PR).
3. Review and merge the PR like any other.

Repo/token are remembered in Figma `clientStorage` (local to your client, never
committed). The export is read straight off the `incoming` branch by the Action
and never reaches `main` or the PR.

**Token:** a **fine-grained PAT** scoped to this repo with **Contents: Read/Write**
(that's all the plugin needs — it only writes a file to a branch). The Action
itself uses the built-in `GITHUB_TOKEN`.

**One repo setting:** Settings → Actions → General → *Workflow permissions* →
enable **“Allow GitHub Actions to create and approve pull requests.”** Without it
the Action can transform but can't open the PR.

### Why this workflow runs `eval:all` itself (don't delete it as "redundant")

Tokens are the contract components consume, so a token change can break a
component — a renamed/removed semantic token leaves a `var()` dangling, or a value
change regresses WCAG contrast. That's exactly what the component eval catches, so
**token drift must clear the component gate before merge.**

`eval.yml` is still *the* gate — it already triggers on PRs touching
`design-system/tokens/**` and `dist/**`. The catch: a PR opened by the built-in
`GITHUB_TOKEN` does **not** reliably trigger `eval.yml` — GitHub holds it as
*"1 workflow awaiting approval"* until a maintainer clicks **Approve**. If nobody
clicks, the gate never runs.

So the `eval:all` step inside this workflow is a **pre-flight**, not a duplicate:
the producer refuses to open a PR it already knows is broken, using the same
command as the gate. The token-sync PR is therefore pre-validated even if the
`eval.yml` check sits unapproved.

**When to remove it:** if you switch the `create-pull-request` step to a
**PAT / GitHub App token** instead of `GITHUB_TOKEN`, `eval.yml` fires on the PR
normally (no "awaiting approval") and the inline `eval:all` becomes redundant.
While it runs on `GITHUB_TOKEN`, keep it.

## Installing the plugin (once)

Figma → **Plugins → Development → Import plugin from manifest…** → pick
`design-system/tokens/figma-sync/plugin/manifest.json`. It runs locally; no
publishing needed. The manifest allows network access only to
`http://localhost:41789` (local flow) and `https://api.github.com` (GitHub flow)
— nothing else.

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

- **Source of truth.** Values flow Figma → JSON. The JSON's structural conventions
  (`$type`, `$extensions.ds.*`) are emitted by the transformer. Anything Figma can't
  hold has a defined home:
  - **Per-token `$description`** comes from the Figma **variable / text-style
    description** — author docs there, not in the JSON (they'd be overwritten).
  - **Font-family fallback stacks** can't be a Figma font value (Figma couldn't
    render them), so each `font family/<x>` token gets its CSS stack from a sibling
    **`font family/<x>-stack`** variable (the bare `font family/<x>` value stays the
    face name, for Figma rendering). The `-stack` variable isn't emitted as its own
    token. `CONFIG.fontFamilyStacks` is a last-resort fallback if it's missing.
  - **File-level `$description`** (the prose blurb atop each file) has no Figma
    source, so it's carried forward from the existing file.
- **Exports aren't tracked.** The plugin produces `figma-export.json` on demand;
  it's gitignored (large, goes stale, not needed for tests). Re-export whenever you
  want to sync. The GitHub flow commits it via the API to the `figma-sync/incoming`
  branch only (the API ignores `.gitignore`); the Action reads it from there, so it
  never lands on `main` or in the PR.
- **No `.json` lands in `tokens/` except the five token files** — `build.mjs`
  globs `tokens/*.json`. Keep exports/fixtures here under `figma-sync/`.
- Stop the server with Ctrl-C. Port override: `SNAP_SYNC_PORT=xxxx npm run sync:serve`
  (also change it in `plugin/manifest.json`'s `allowedDomains`).
