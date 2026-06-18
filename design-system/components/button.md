# Button

> A clickable action; renders a real `<button>`. Reference component for the SNAP spec→code→eval loop.

**Status:** built
**Code:** `src/components/Button.tsx`
**Figma:** `.button` component set (variant axis: `state` = default / hovered / pressed)

## Anatomy

- `<button>` — root; square corners (SNAP controls use radius 0)
  - label — children (text and/or icon), centered, `--space-2` gap

## Variants

| Prop | Values | Default | Notes |
|---|---|---|---|
| `variant` | `primary` \| `secondary` \| `ghost` | `primary` | Only `primary` is defined in the SNAP Figma button; `secondary`/`ghost` are token-derived conventions pending Figma definition. |
| `size` | `sm` \| `md` | `md` | maps to `--interactive-height-sm/md` (40 / 48px) |
| `fullWidth` | boolean | `false` | stretch to container |

## States

SNAP signals interaction by **swapping color tokens** (not a translucent state-layer). On `primary`, the fill brightens and the label flips to ink so contrast holds.

| State | Visual | Tokens |
|---|---|---|
| default (primary) | navy fill, white label | `--background-interactive-primary`, `--text-inverse` |
| hover / pressed (primary) | bright fill, ink label | `--background-interactive-primary-hovered`, `--text-default` |
| hover / pressed (secondary, ghost) | subtle ink overlay | `--background-overlay`, `--background-overlay-strong` |
| focus (keyboard) | 2px focus ring | `--shadow-focus` (= `--border-focus`) on `:focus-visible` |
| disabled | muted fill + label, no pointer | `--background-disabled`, `--text-disabled`, `--border-disabled` |

## Tokens used

- Color: `--background-interactive-primary`, `--background-interactive-primary-hovered`, `--background-overlay`, `--background-overlay-strong`, `--background-disabled`, `--text-inverse`, `--text-default`, `--text-disabled`, `--border-strong`, `--border-disabled`
- Spacing: `--space-2` (gap), `--space-3` / `--space-4` (padding-x)
- Radius: none — SNAP controls are square (`rounded-none`)
- Height: `--interactive-height-sm/md`
- Type: `.type-body-medium`
- Elevation: `--shadow-focus`

## Behavior

Renders `<button type="button">` by default; pass `type="submit"` in forms. Color transitions via `transition-colors`.

## Accessibility

- Native `<button>` — keyboard operable (Enter/Space) and exposes the button role for free.
- Focus ring on `:focus-visible` (`--shadow-focus`); never removed without replacement.
- Disabled uses `disabled` attribute (removes from tab order) plus muted tokens — not color alone.
- Icon-only buttons must set `aria-label`.
- Contrast: confirmed AA in the SNAP light theme (only theme defined in Figma).

## Do / Don't

- ✅ `<Button variant="primary">Save</Button>`
- ✅ `<Button variant="ghost" aria-label="Close"><CloseIcon /></Button>`
- ❌ Don't hardcode colors/sizes — variants are token-driven.
- ❌ Don't add rounded corners — SNAP controls are square.
