# Component eval rubric

You are auditing a single component implementation against the design system. You are given: the component source, its spec (`design-system/components/<name>.md`), and a reference list of the allowed design tokens. Deterministic checks (hex/px/palette/focus) have already run separately — focus your judgment on adherence and spec coverage that a regex can't see.

Be strict. Cite line numbers. Any criterion you mark `fail` makes the overall result `fail`.

## Criteria

1. **Tokens only** — Every visual value (color, spacing, radius, shadow, type, sizing) traces to a design token (a Tailwind utility mapped to a token, a `.type-*` class, or `var(--semantic-token)`). No hardcoded hex/px/rem/font-name/shadow. (Regex covers the obvious cases; flag anything subtler — e.g. a magic number smuggled through an arbitrary value or inline style.)

2. **Semantic over primitive** — Uses semantic tokens (`--background-*`, `--text-*`, `--border-*`, `--interactive-*`, `--space-*`, `--radius-interactive/container`) and never primitives (`--color-*`, `--size-*`, raw `--radius-md`). Color is chosen by role + intent, not hue.

3. **Theme-agnostic** — No hand-authored light/dark/wireframe branching. The component must work in all three themes purely because it uses semantic tokens. Flag any `data-theme`-specific code or conditional colors.

4. **Responsive & spacing** — Spacing/gaps/padding use the fluid scale (`--space-*` via `p-/m-/gap-1…14`); layout sizing uses `--content-width-*`, `--cell-*`, control heights use `--interactive-height-*`. Breakpoints use the system's `md/lg/xl/2xl` (mobile-first). No raw spacing.

5. **Typography via the ramp** — Text uses a `.type-*` ramp class (responsive `type-<role>` preferred) or `--font-*` tokens. Correct role for meaning (heading vs body vs label vs ui). No ad-hoc font-size/line-height/weight.

6. **Accessibility** — Semantic HTML / correct ARIA; keyboard operable; focus ring on `:focus-visible`; **state never conveyed by color alone** (icon/text accompanies status); labels/names present (e.g. icon-only buttons have `aria-label`, inputs have associated labels); status `role` appropriate.

7. **Spec coverage** — The implementation actually delivers what the component's spec promises: every documented variant, size, and state exists; the "Tokens used" list matches reality; documented a11y behaviors are implemented. Flag missing or undocumented-but-present variants/states.

## Output

Return a single structured verdict:
- `overall`: `pass` | `fail` (fail if any criterion fails)
- `score`: 0–100 (holistic)
- `criteria`: one entry per criterion above — `{ name, status: pass|warn|fail, notes }`
- `violations`: `{ severity: error|warn, criterion, detail, line, suggestion }`
- `summary`: 2–3 sentences

`warn` = real but minor (style/nit); `error` = a guide violation that should block. Prefer precision over volume; don't invent issues to seem thorough.
