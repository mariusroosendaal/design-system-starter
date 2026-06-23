# Decision Log — <Design System Name>

A running record of non-trivial design and system decisions: **what** was decided,
**why**, and **what was rejected**. Append a dated entry whenever you make a call that a
future session (or a client) would otherwise have to reverse-engineer. Newest first.

---

## 2026-06-22

**Breakpoints are single-sourced from `design-system/tokens/dimension.json`.** They had
drifted across three files (`build.mjs` hardcoded five, `dimension.json` declared three,
`tailwind.config.js` exposed two). `build.mjs` now derives the scale from the `breakpoint.*`
tokens, and `tailwind.config.js` derives `screens` from the same JSON. Added the missing
`xl` (1200px) and `2xl` (1500px). Rejected: hand-syncing the values in each file (the status
quo that caused the drift).

**Only `colors` is locked down in Tailwind; `spacing`/`radius`/`shadow`/`fontFamily` stay on
`extend`.** Replacing `spacing` the way `colors` is replaced would delete load-bearing keys
(`0`, `px`, `auto`) and break `Button`'s `after:inset-0` overlay and `gap` utilities. So the
non-token escape hatch (`p-10`, `gap-12`) is left open at the Tailwind layer and caught by the
LLM judge instead (rubric criteria 1 & 4), not the deterministic static checks. Rejected:
"lock everything down like colors." Trade-off: the judge must be enabled in CI
(`ANTHROPIC_API_KEY`) for that backstop to actually run.

**Did not add status colors or a wireframe theme.** Docs referenced `--border-negative`/
`--text-negative` and a `wireframe` theme that don't exist. Treated as doc drift, not a feature
gap: reconciled the docs to what ships (light/dark, no status tokens) and left breadcrumbs for
where to add them. Rejected: inventing status/wireframe tokens to satisfy stale docs — that's
an additive brand decision, not a cleanup.

**Started this decision log + `GUARDRAILS.md`.** Rationale must survive across sessions and
handoffs rather than living in chat history. Guardrails reference token *names* (not example
literals) so they stay valid after a Figma token re-sync.

---

<!-- template for new entries:
## YYYY-MM-DD
**Decision in one line.** Why. What was rejected.
-->
