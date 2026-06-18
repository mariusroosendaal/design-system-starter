# Radius & elevation

## Radius

SNAP exposes a radius scale as primitives — `--radius-none` (0) · `sm` 4 · `md` 8 · `lg` 16 · `xl` 32 · `2xl` 128 · `full` 9999 (Tailwind `rounded-none|sm|md|lg|xl|2xl|full`).

There is **no semantic radius token**, and SNAP **controls are square** — buttons/inputs use `rounded-none`. Containers (cards, sheets) may use a scale value; pick the smallest that reads as intended and keep it consistent.

## Shadows

- `--shadow-sm` — subtle resting lift (`shadow-sm`).
- `--shadow-md` — raised surface: menus, popovers, cards (`shadow-md`). Two-layer.

## Focus ring

`--shadow-focus` — a 2px ring in `--border-focus` (`blue/bold`). Apply on **`:focus-visible`** for every interactive element:

```
focus-visible:outline-none focus-visible:shadow-focus
```

Never remove the focus indicator without an equivalent replacement.
