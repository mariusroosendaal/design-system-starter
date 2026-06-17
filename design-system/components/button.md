# Button

> Example component spec. A clickable action; renders a real `<button>`. Use it as the reference for the spec→code→eval loop, then replace/extend for your system.

**Status:** built
**Code:** `src/components/Button.tsx`

## Anatomy

- `<button>` — root
  - state-layer overlay (`::after`) — translucent hover/press tint
  - label span — children, above the overlay

## Variants

| Prop | Values | Default | Notes |
|---|---|---|---|
| `variant` | `primary` \| `secondary` \| `ghost` | `primary` | |
| `size` | `sm` \| `md` | `md` | maps to `--interactive-height-sm/md` |
| `fullWidth` | boolean | `false` | stretch to container |

## States

| State | Visual | Tokens |
|---|---|---|
| hover | state layer | `--interactive-hovered` |
| pressed | stronger state layer | `--interactive-pressed` |
| focus (keyboard) | focus ring | `--shadow-focus` on `:focus-visible` |
| disabled | 40% opacity, no pointer | — |

## Tokens used

- Color: `--interactive-default`, `--interactive-hovered`, `--interactive-pressed`, `--text-inverse`, `--text-default`, `--border-input`
- Spacing: `--space-3`, `--space-4` (padding)
- Radius: `--radius-interactive`
- Height: `--interactive-height-sm/md`
- Type: `.type-ui-sm-2xl-strong`
- Elevation: `--shadow-focus`

## Behavior

Renders `<button type="button">` by default; pass `type="submit"` in forms.

## Accessibility

Native `<button>` (keyboard + role for free); focus ring on `:focus-visible`; icon-only buttons must set `aria-label`.

## Do / Don't

- ✅ `<Button variant="primary">Save</Button>`
- ❌ Don't hardcode colors/sizes — variants are token-driven.
