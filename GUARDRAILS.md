# Project guardrails — <Design System Name>

This project MUST follow the design system in this repo. The single source of truth for
tokens is the **generated** `design-system/dist/tokens.css` (built from `design-system/tokens/*.json`).
Consuming files link fonts FIRST, then tokens:

```css
@import "design-system/fonts/fonts.css";
@import "design-system/dist/tokens.css";
```

These guardrails are the **anti-drift ledger**. They start from the non-negotiable rules
(also in `CLAUDE.md`) and the deterministic eval rules (`eval/static-checks.mjs`). Whenever a
component **fails an eval**, append the *cause* as a new row/rule below (see "Learned guardrails")
so a future session can't repeat it. Reference token NAMES, never raw values — values are
re-synced from Figma and will change.

## Canonical foundations — do not substitute

| Aspect | Correct (semantic token) | Drift to reject | Eval rule |
|---|---|---|---|
| Color | `--text-*` / `--background-*` / `--border-*` / `--interactive-*` | raw hex, `rgb()`/`hsl()` | `no-hardcoded-hex`, `no-rgb-hsl` |
| Color source | semantic tokens only | primitives (`--color-*`, `--size-*`, raw `--radius-md`) | `no-primitive-var` |
| Color palette | semantic Tailwind utilities only | default palette (`bg-gray-200`) or `*-white`/`*-black` | `no-default-palette` |
| Primary action | `bg-interactive-default` + `text-text-inverse`, `rounded-interactive` | hardcoded fills, arbitrary radius |  |
| Secondary action | `bg-transparent` + 1px `border-border-input` | solid black/hardcoded borders |  |
| Spacing | `--space-1…7` (`p-/m-/gap-1…7`) | non-token Tailwind defaults (`p-10`, `gap-12`), arbitrary `[12px]` | `no-arbitrary-dimension` |
| Radii | `rounded-interactive` (controls), `rounded-container` (cards), `rounded-full` (pills/avatars) | arbitrary radius, `rounded-full` on rectangular controls |  |
| Type | `.type-*` ramp class or `--font-*` tokens | ad-hoc `font-size`/`line-height`/`font-weight` |  |
| Weight ceiling | `--font-weight-strong` (600) | 700+/bold |  |
| Theming | semantic tokens only; themes apply via `[data-theme]` | hand-authored light/dark branching, conditional colors |  |
| Focus | `focus-visible:shadow-focus focus-visible:outline-none` | no focus ring; state signalled by color alone | `focus-visible-on-interactive` |

## Rules

1. **Tokens only — never hardcode.** Every visual value traces to a `var(--token)` or a
   token-backed Tailwind utility. An unresolved `var()` silently falls back to a browser
   default — that's drift.
2. **Semantic over primitive.** Use `--text-default`, not `--color-neutral-900`. If no
   semantic token fits, flag the gap — don't reach past it.
3. **Theme-agnostic.** Build once on semantic tokens; never hand-author a per-theme override
   in a component.
4. **Spec before code, eval before done.** Every component has a spec in
   `design-system/components/` and MUST pass `npm run eval <Name>` (static checks + judge)
   before it's "done." CI runs `eval:all` on every PR.
5. **Every eval failure becomes a guardrail.** When a component fails, append the cause to
   "Learned guardrails" below so the same drift can't recur. This file grows; it is never
   trimmed to hide a past mistake.
6. **Keep a decision log.** Record every non-trivial design/system decision in `DECISIONS.md`
   — what was decided, why, and what was rejected — so rationale survives handoffs. Don't rely
   on chat history.
7. **Audit before delivery.** Run `npm run eval:all`, and grep your output for `#` hex,
   `rgb(`, default-palette names, and `var(--color-`/`var(--size-`. Any hit is drift.

## Learned guardrails (appended on eval failure)

_None yet — no component has failed an eval. Append entries here as failures occur._

<!-- template for a learned guardrail:
- **<Component> — <one-line cause>** (YYYY-MM-DD). What failed and the rule that now prevents it.
  e.g. "Card — used `p-10` (non-token). Spacing must come from `--space-1…7`; `p-8`+ are Tailwind defaults."
-->
