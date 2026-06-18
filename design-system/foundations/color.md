# Color

Components use **semantic** color tokens only (never the primitive ramps). SNAP defines a single **`light`** mode in Figma — there is no dark/wireframe theme — so build on the semantic tokens and theming stays a non-issue.

## Palette intent (primitives — do not use directly)

SNAP's hues use an emotive 5-step scale instead of numeric weights:

- `optimistic` — lightest tint (subtle backgrounds)
- `bright` — vivid accent (highlights, hover fills)
- `bold` — saturated core (focus ring `blue/bold`)
- `insightful` — mid-dark (status text/borders)
- `impactful` — darkest (primary fills, inverse backgrounds)

Plus `ink` (deep navy `#0a152b` at opacity steps 4–100), `white` (+ opacity steps), and a `gray` 50–950 ramp.

## Semantic groups (use these)

- **background** — `default` (app), `surface` (cards), `inverse`, `overlay` / `overlay-strong` (translucent ink), `accent-1/2`, status `info` / `positive` / `negative`, `disabled`, and interactive fills `interactive-primary` (+ `-hovered`), `interactive-accent`, `interactive-negative` (+ `-hovered`).
- **text** — `default`, `secondary`, `inverse`, `accent-1/2`, status `info` / `positive` / `negative`, `disabled`, `interactive-accent` (+ `-hovered`).
- **border** — `default`, `subtle`, `input`, `strong`, `inverse`, status colors, `disabled`, `interactive-accent`, `focus`.

## Rules

- Pick by **role + intent**, not hue: a save button is `background-interactive-primary`, not "navy".
- **Never signal state with color alone** — pair status color with an icon/label.
- Interaction = **token swap** (see spacing/components), not opacity tricks.
- Contrast: confirmed AA in `light`. When pairing fills with text, mind that `interactive-primary-hovered` (bright cyan) needs **dark** text (`text-default`), not `text-inverse`.
