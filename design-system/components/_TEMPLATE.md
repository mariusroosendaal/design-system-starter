# <Component name>

> One-sentence purpose: what it is and when to use it. Copy this file to `<component-name>.md` and fill every section. Delete the parenthetical guidance as you go. The spec is the contract — write it before implementing, and keep it in sync with the code.

**Status:** draft | spec'd | built
**Figma:** <link to the component node, if any>

## Anatomy

(List the structural parts, outer → inner. A small ASCII/box sketch helps.)

- Root: <element + role>
  - <part> — <what it is>
  - <part> — <slot for caller content?>

## Variants

(The distinct visual/functional forms. Mirror the Figma variant properties where they exist.)

| Prop | Values | Default | Notes |
|---|---|---|---|
| `variant` | … | … | |
| `size` | … | … | map to `--interactive-height-*` if a control |

## States

(Cover every interaction/condition and which token drives it.)

| State | Visual change | Tokens |
|---|---|---|
| default | | |
| hover | state layer | `--interactive-hovered` |
| pressed | state layer | `--interactive-pressed` |
| focus (keyboard) | focus ring | `--shadow-focus` on `:focus-visible` |
| disabled | reduced emphasis, no pointer | |
| error / invalid | | status token, if your system defines one (add to color.json) |
| loading | | |

## Tokens used

(Enumerate the semantic tokens this component consumes. This is the audit surface — if a value isn't here as a token, it shouldn't be in the code.)

- Color: `--…`
- Spacing: `--space-…`
- Radius: `--radius-…`
- Type: `.type-…` / `--font-…`
- Elevation: `--shadow-…`

## Behavior

(Keyboard interaction, focus management, responsive changes by breakpoint, motion. Note which `--space-*` tokens drive responsive layout.)

## Accessibility

- Semantic element / ARIA role: <…>
- Keyboard: <tab order, Enter/Space/Esc/arrows as applicable>
- Labels: <how the accessible name is set>
- Contrast: confirmed AA in every defined theme (e.g. light, dark)
- State not conveyed by color alone: <icon/text used>

## Do / Don't

- ✅ <correct usage>
- ❌ <misuse to avoid>

## Examples

(Markup/usage snippets once a target framework is chosen. Tokens only — no hardcoded values.)
