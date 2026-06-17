# Foundations

Document the system's rules here — one `.md` per area — so humans and Claude Code use the right tokens. Mirror what's in `../tokens/*.json` and add usage guidance + do/don't.

Suggested docs (create as you extract tokens):

- `color.md` — semantic color tokens, the themes, the "semantic-only" rule, contrast notes.
- `typography.md` — families, weights, the `.type-*` ramp (responsive vs discrete), which role for which meaning.
- `spacing-layout.md` — the `--space-*` scale, breakpoints, grid/content widths.
- `radius-elevation.md` — radii + shadows + the focus ring.

Keep each short and rule-focused; the eval judge reads these (and `../components/*.md`) when scoring adherence.
