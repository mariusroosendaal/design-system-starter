# SNAP — Agentic Design System

**Figma source:** `https://www.figma.com/design/40hPEX7A9Wt5VsMHxk3xCr/%F0%9F%8E%A8-USCC-%E2%80%94-SNAP-DS?node-id=2-1929&p=f&t=Fy3cgaf8euHGyt2A-0`. Tokens here were extracted from its variable collections, text styles, and effect styles.

## Layout

```
design-system/
  tokens/          W3C Design Tokens JSON — the source of truth (edit these)
    primitives.json     raw values (color ramps, size/radius scale, font sizes)
    color.json          semantic color (SNAP defines a single 'light' mode)
    dimension.json      semantic spacing/layout, responsive across sm–2xl
    typography.json     font weights + the composite, responsive type ramp
    elevation.json      shadows + focus ring
    build.mjs           generator: JSON → dist/tokens.css (no dependencies)
  dist/tokens.css   GENERATED — CSS custom properties + .type-* classes. Do not edit.
  foundations/     docs: color, typography, spacing-layout, radius-elevation
  components/      component specs (.md). _TEMPLATE.md is the required format.
  fonts/           @font-face declarations (GT America, Tobias) + binaries in files/
src/
  components/      React + TS component implementations
  App.tsx          live gallery
  styles.css       imports fonts.css + tokens.css, then Tailwind layers
eval/              style-guide eval (deterministic checks + LLM judge)
```

Consuming apps import fonts then tokens:

```css
@import "design-system/fonts/fonts.css";
@import "design-system/dist/tokens.css";
```

## Non-negotiable rules for building components

1. **Tokens only — never hardcode.** No raw hex, px, rem, font names, or shadows in a component. Use the CSS custom properties from `dist/tokens.css` (e.g. `var(--text-default)`, `var(--space-6)`, `var(--background-surface)`).
2. **Semantic over primitive.** Use `--text-default`, not `--color-ink-100`. If no semantic token fits, flag the gap — don't reach past it. (SNAP has no semantic radius token; controls are square — `rounded-none`.)
3. **Theme-agnostic.** Build once on semantic color tokens — never hand-author a theme override in a component. SNAP currently defines only a `light` mode in Figma; the `[data-theme]` plumbing stays so modes can be added without touching components.
4. **Mobile-first & responsive.** Default to the smallest breakpoint; layer `@media (min-width: …)` upward. Use `--space-*` for spacing.
5. **Type via the ramp.** Apply a `.type-*` class or compose from `--font-*` tokens. Pick the role by meaning.
6. **Accessibility is part of "done":** focus ring on `:focus-visible` (`--shadow-focus`); never signal state with color alone; meet WCAG AA contrast; semantic HTML + ARIA.
7. **Spec before code.** Every component gets a spec in `components/` following `_TEMPLATE.md`. The spec is the contract.

## Workflow: building a new component

1. **Read the relevant foundations** (`design-system/foundations/*.md`).
2. **Write/open the spec** in `design-system/components/<name>.md` using the template.
3. **Implement** against the spec, tokens only — React + TS in `src/components/<Name>.tsx`, Tailwind utilities mapped to tokens (see "Component stack"). Link the spec at the top (`// Spec: design-system/components/<name>.md`).
4. **Verify:** every value traces to a token; all states + focus ring handled; works across breakpoints (and every theme, once more than `light` exists). Run the gallery (`npm run dev`).
5. **Evaluate — required before "done".** Run `/eval-component <Name>` (in-session) or `npm run eval <Name>` (CLI). Must **PASS** both the deterministic checks and the spec-adherence judge. CI runs `eval:all` on every PR. See `eval/README.md`.

## Workflow: re-syncing tokens from Figma

Automated, deterministic (no LLM): a Figma plugin reads the variables/styles and a
local server runs a pure transformer that rewrites `tokens/*.json`, then `build.mjs`.
One-way — Figma owns values; the JSON is regenerated from them.

```bash
npm run sync:serve     # start the local receiver, then click "Sync" in the
                       # "SNAP Token Sync" plugin (Figma → Plugins → Development)
# or, from a downloaded export:
npm run sync -- <figma-export.json> [--dry-run|--report|--only=color,dimension]
```

Or run `/sync-tokens` to orchestrate it (test → sync → diff → `eval:all`). The whole
thing lives in `design-system/tokens/figma-sync/` — `transform.mjs` is the brain
(`npm run sync:test`), and its `CONFIG`/`README.md` document the
collection→file mapping and how to tune it if Figma's names drift.

Manual fallback: edit `tokens/*.json` by hand, then `node design-system/tokens/build.mjs`.
`dist/tokens.css` is always generated. Commit both.

## Component stack

React 19 + TypeScript + Tailwind CSS v3 (Vite). `tailwind.config.js` maps every theme value to `var(--token)`, so utilities inherit theming + the responsive cascade. `colors` is *replaced* (not extended) — only semantic tokens exist. When you change token groups, update the Tailwind color map to match.

```bash
npm install
npm run dev      # gallery at localhost:5173
npm run build    # typecheck + production build
npm run tokens   # regenerate dist/tokens.css
npm run eval:all # gate every component against the style guide
```

Interaction states: SNAP signals hover/press by **swapping semantic color tokens**, not a translucent state-layer. Primary controls go `--background-interactive-primary` → `--background-interactive-primary-hovered` (with the label flipping to `--text-default` for contrast); outlined/ghost controls layer the translucent `--background-overlay` / `--background-overlay-strong` tokens on hover/press. Drive both with `transition-colors` (see `Button.tsx`).
