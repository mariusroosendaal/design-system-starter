# <Design System Name> — Agentic Design System

> Replace `<Design System Name>` and this line with the client/system. This repo is the **code source of truth** for the design system. It exists so Claude Code can build new, on-system components on demand. Design decisions live in Figma; this repo is the extracted, machine-readable contract + the rules for using it.

**Figma source:** `<link to the client's Figma file>`. Tokens here were extracted from its variable collections, text styles, and effect styles.

## Layout

```
design-system/
  tokens/          W3C Design Tokens JSON — the source of truth (edit these)
    primitives.json     raw values (color ramps, size/radius scale, font sizes)
    color.json          semantic color, themed (light/dark/…)
    dimension.json      semantic spacing/layout, responsive across breakpoints
    typography.json     font weights + the composite type ramp
    elevation.json      shadows + focus ring
    build.mjs           generator: JSON → dist/tokens.css (no dependencies)
  dist/tokens.css   GENERATED — CSS custom properties + .type-* classes. Do not edit.
  foundations/     docs: color, typography, spacing-layout, radius-elevation
  components/      component specs (.md). _TEMPLATE.md is the required format.
  fonts/           @font-face declarations + binaries in files/
src/
  components/      React + TS component implementations
  App.tsx          live gallery with a theme switcher
  styles.css       imports fonts.css + tokens.css, then Tailwind layers
eval/              style-guide eval (deterministic checks + LLM judge)
```

Consuming apps import fonts then tokens:

```css
@import "design-system/fonts/fonts.css";
@import "design-system/dist/tokens.css";
```

## Non-negotiable rules for building components

1. **Tokens only — never hardcode.** No raw hex, px, rem, font names, or shadows in a component. Use the CSS custom properties from `dist/tokens.css` (e.g. `var(--text-default)`, `var(--space-6)`, `var(--radius-container)`).
2. **Semantic over primitive.** Use `--text-default`, not `--color-neutral-900`. If no semantic token fits, flag the gap — don't reach past it.
3. **Theme-agnostic.** Build once on semantic color tokens; themes work for free via `[data-theme]`. Never hand-author a theme override in a component.
4. **Mobile-first & responsive.** Default to the smallest breakpoint; layer `@media (min-width: …)` upward. Use `--space-*` for spacing.
5. **Type via the ramp.** Apply a `.type-*` class or compose from `--font-*` tokens. Pick the role by meaning.
6. **Accessibility is part of "done":** focus ring on `:focus-visible` (`--shadow-focus`); never signal state with color alone; meet WCAG AA contrast; semantic HTML + ARIA.
7. **Spec before code.** Every component gets a spec in `components/` following `_TEMPLATE.md`. The spec is the contract.
8. **Honour the ledgers.** Read `GUARDRAILS.md` before building (the anti-drift rules; every eval failure gets appended there). Log non-trivial design/system calls — what, why, what was rejected — in `DECISIONS.md`, newest first.

## Workflow: building a new component

1. **Read the relevant foundations** (`design-system/foundations/*.md`).
2. **Write/open the spec** in `design-system/components/<name>.md` using the template.
3. **Implement** against the spec, tokens only — React + TS in `src/components/<Name>.tsx`, Tailwind utilities mapped to tokens (see "Component stack"). Link the spec at the top (`// Spec: design-system/components/<name>.md`).
4. **Verify:** every value traces to a token; all states + focus ring handled; works in every theme + across breakpoints. Run the gallery (`npm run dev`).
5. **Evaluate — required before "done".** Run `/eval-component <Name>` (in-session) or `npm run eval <Name>` (CLI). Must **PASS** both the deterministic checks and the spec-adherence judge. CI runs `eval:all` on every PR. See `eval/README.md`. **On any failure, append the cause to `GUARDRAILS.md`** so it can't recur.

## Workflow: re-syncing tokens from Figma

Re-extract the variables/styles, update the JSON in `tokens/`, then regenerate:

```bash
node design-system/tokens/build.mjs
```

Edit `tokens/*.json`; `dist/tokens.css` is always generated. Commit both.

## Component stack

React 19 + TypeScript + Tailwind CSS v3 (Vite). `tailwind.config.js` maps every theme value to `var(--token)`, so utilities inherit theming + the responsive cascade. `colors` is *replaced* (not extended) — only semantic tokens exist. When you change token groups, update the Tailwind color map to match.

```bash
npm install
npm run dev      # gallery at localhost:5173
npm run build    # typecheck + production build
npm run tokens   # regenerate dist/tokens.css
npm run eval:all # gate every component against the style guide
```

State layers (`--interactive-hovered/pressed`) are translucent overlays — implement as an `::after` overlay toggled on `hover`/`active`, content in a `relative z-10` layer above it (see `Button.tsx`).
