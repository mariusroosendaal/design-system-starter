# Design System Starter

A reusable starting point for building a **client design system** the agentic way: Figma is the source of design truth, this repo is the extracted, machine-readable contract, and Claude Code builds on-system components against it — with an eval that gates every component to the style guide.

It ships a tiny working example (neutral tokens + a `Button`) so the whole pipeline runs green out of the box. You replace the example with the client's tokens and components.

## What you get

- **Token pipeline** — author tokens as W3C Design Tokens JSON (`design-system/tokens/*.json`); `build.mjs` compiles them to themed, responsive CSS custom properties + `.type-*` ramp classes (`design-system/dist/tokens.css`). No dependencies.
- **Component stack** — React 19 + TypeScript + Tailwind v3, with Tailwind mapped to the tokens (`var(--token)`, not literals) so theming + responsiveness are free. A live gallery with a theme switcher.
- **Style-guide eval** — deterministic checks (hard gate) + an LLM judge (spec adherence), runnable as `npm run eval`, the `/eval-component` skill, and CI. See `eval/README.md`.
- **The rules** — `CLAUDE.md` (agentic contract) + `design-system/components/_TEMPLATE.md` (spec format).

## Quick start

```bash
npm install
npm run dev        # gallery at http://localhost:5173 (light/dark switcher)
npm run build      # typecheck + production build
npm run eval:all   # gate the example component against the guide
```

## Spin up a new client design system

1. **Rename** — set `name` in `package.json`, fill in `CLAUDE.md` (system name + Figma link).
2. **Extract tokens from Figma** — pull the client's variable collections, text styles, and effect styles (the Figma MCP / Dev Mode) and write them into `design-system/tokens/*.json`, replacing the examples. Keep the structure: primitives → semantic; mark themed groups with `$extensions["ds.modeType"] = "theme"` and responsive ones with `"breakpoint"`; list modes under `$extensions["ds.modes"]`.
3. **Build the CSS** — `npm run tokens`.
4. **Align Tailwind** — update the color groups + spacing/radius/shadow keys in `tailwind.config.js` to match your semantic token names.
5. **Document foundations** — fill in `design-system/foundations/*.md` (the eval judge reads these).
6. **Build components** — for each: write the spec (`_TEMPLATE.md`), implement in `src/components/` (tokens only, spec-linked), add to the gallery, then **`/eval-component <Name>`** (or `npm run eval <Name>`) until it PASSES.

## What's generic vs. what you replace

| Reuse as-is | Replace per client |
|---|---|
| `design-system/tokens/build.mjs` (generator) | `design-system/tokens/*.json` (values) |
| `eval/**`, `.claude/skills/eval-component`, `.github/workflows/eval.yml` | `design-system/foundations/*.md`, `design-system/components/*.md` |
| `_TEMPLATE.md`, configs (vite/ts/postcss), `src/lib`, `src/main.tsx`, `src/styles.css` | `tailwind.config.js` color/scale map (to match your token groups), `src/components/*`, `src/App.tsx` |

The eval's deterministic rules are brand-agnostic (no hex, no arbitrary px, no default Tailwind palette, focus ring on interactive, spec linked). If your semantic groups differ a lot from the example, skim `eval/static-checks.mjs`.

## Enabling the LLM judge

Set `ANTHROPIC_API_KEY` (env locally, or a repo secret for CI) and the judge runs in `npm run eval` / CI. Without it, the deterministic gate still runs. In a Claude Code session, `/eval-component` judges in-session with no key. `EVAL_MODEL` overrides the model.

## Use as a template

Mark this repo a **GitHub template** (Settings → Template repository) or `gh repo create <client-ds> --template <this-repo>` to start each client from it.
