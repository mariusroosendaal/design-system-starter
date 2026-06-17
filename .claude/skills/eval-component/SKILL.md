---
name: eval-component
description: Evaluate a component against the design-system style guide. Runs the deterministic static checks, then judges spec-adherence in-session against eval/rubric.md, and reports PASS/FAIL with findings. Use when asked to eval/check/audit a component, verify it follows the style guide or its spec, or before merging a new component. Usage - /eval-component <ComponentName>
---

# Evaluate a component against the style guide

Goal: decide whether `<ComponentName>` (e.g. `Button`) follows the design system. Two layers — run both, then combine.

## 1. Deterministic checks (the hard gate)

Run the static engine and read its JSON:

```bash
node eval/run.mjs <ComponentName> --no-judge --json
```

Any `error`-severity finding is an automatic FAIL. Report each with its file:line. (These cover hardcoded hex/rgb, arbitrary px/rem, default Tailwind palette, primitive `var()`, missing focus ring, missing spec.)

If the runner reports the component or spec is missing, stop and say so.

## 2. Judge spec-adherence (you are the judge)

You don't need the API for this — do the judgment yourself. Read, in this order:

1. `eval/rubric.md` — the 7 scoring criteria and the output shape. Follow it exactly.
2. `design-system/components/<kebab-name>.md` — the component's spec (the coverage rubric). `<kebab-name>` is the component name kebab-cased (e.g. `TextField` → `text-field`).
3. `src/components/<ComponentName>.tsx` — the implementation.
4. As needed for token names: `design-system/foundations/*.md` and the semantic tokens in `design-system/dist/tokens.css` (only `--background-*/--text-*/--border-*/--interactive-*/--space-*/--radius-interactive|container/--shadow-*/--font-*` and `.type-*` are allowed; `--color-*`/`--size-*`/raw `--radius-md` are primitives and forbidden).

Score each of the rubric's criteria `pass`/`warn`/`fail` with a one-line note, list concrete violations (criterion + detail + line + suggestion), and give a 0–100 score. Be strict and cite lines; don't invent issues. Any criterion `fail` → judge `fail`.

Pay special attention to **spec coverage**: every variant/size/state the spec lists must exist in the code, the spec's "Tokens used" must match reality, and documented a11y behaviors must be implemented. Flag missing or undocumented-but-present behavior.

## 3. Report

Combine into one verdict:

- **Static:** N errors, M warnings (list them).
- **Judge:** per-criterion table, violations, score, summary.
- **Result: PASS / FAIL** — FAIL if any static error OR any judge criterion failed.

End with the most important fixes, ordered by severity. If it FAILs and the user wants, offer to apply the fixes (tokens only — never reach past the semantic tokens; if a needed token is missing, flag the gap instead of hardcoding).
