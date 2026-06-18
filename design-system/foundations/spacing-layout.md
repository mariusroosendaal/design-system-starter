# Spacing & layout

## Spacing scale

`--space-1 … --space-14` (Tailwind `p-/m-/gap-1…14`). The scale is **responsive** — most steps grow at larger breakpoints (e.g. `--space-6` is 24px at `sm`, 32px at `lg`, 40px at `2xl`). `--space-1` (4px) and `--space-2` (8px) are constant.

Use the scale for **all** padding, margin, and gap. No raw spacing values.

## Breakpoints (min-width, mobile-first)

`sm` 0 · `md` 600 · `lg` 900 · `xl` 1200 · `2xl` 1500. Default to `sm` and layer upward with the system screens (`md:`, `lg:`, `xl:`, `2xl:`).

## Grid & content width

- `--layout-columns` = 12; `--layout-gutter` and `--layout-margin` scale 16→24→32 across breakpoints.
- `--content-width-narrow | -standard | -wide` — responsive max content widths (Tailwind `max-w-content-narrow|standard|wide`). Use to constrain readable measure.

## Control sizing

Control heights are semantic: `--interactive-height-sm` (40px) and `--interactive-height-md` (48px) — Tailwind `h-control-sm` / `h-control-md`. Don't hardcode control heights.
