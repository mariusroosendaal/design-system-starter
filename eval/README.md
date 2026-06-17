# Component eval

Checks that a component follows the style guide. **Layered:**

1. **Deterministic checks** (`static-checks.mjs`) — the hard rules from `CLAUDE.md`/foundations that a regex can verify: no hardcoded hex/rgb, no arbitrary `px`/`rem` values, no default Tailwind palette, no primitive `var()`, focus ring on interactive elements, spec-must-exist, and the component must link its spec (`// Spec: …`). Pure Node, runs everywhere, **fails the build** on any error.
2. **LLM judge** (`judge.mjs`, rubric in `rubric.md`) — scores the nuanced stuff a regex can't: semantic-over-primitive intent, theme-agnosticism, type-via-ramp, a11y, and **spec coverage** (does the code deliver every variant/state the spec promises?). Runs when an Anthropic API key is available; otherwise skipped (deterministic gate still applies).

The component's spec (`design-system/components/<name>.md`) is the rubric for coverage.

## Run it

```bash
npm run eval Button            # one component (static + judge)
npm run eval Button -- --no-judge
npm run eval:all               # every component with a spec
node eval/run.mjs Card --json  # machine-readable
```

Exit code is non-zero if any component has a static error or a judge `fail` — so it gates CI.

### Enabling the judge

Install the SDK (already a devDependency) and set a key:

```bash
export ANTHROPIC_API_KEY=sk-...
npm run eval Button            # now includes the LLM judge
# EVAL_MODEL overrides the model (default: claude-sonnet-4-6)
```

Without a key the judge is skipped with a notice; the deterministic checks still run and gate.

## In a Claude Code session

Use the **`/eval-component <Name>`** skill. It runs the deterministic checks via Node, then performs the judge step in-session (no API key needed — the agent is the judge) against the same `rubric.md`.

## Files

| File | Role |
|---|---|
| `run.mjs` | CLI: resolves component + spec, runs both layers, prints report, sets exit code |
| `static-checks.mjs` | Deterministic rules (the hard gate) |
| `judge.mjs` | LLM judge via Anthropic SDK |
| `rubric.md` | The 7 scoring criteria — shared by `judge.mjs` and the skill |
| `lib/context.mjs` | Repo paths + the allowed-token reference passed to the judge |

## Adding a rule

Deterministic rule → add to `RULES` in `static-checks.mjs` (id, severity, regex). Judgment rule → add a criterion to `rubric.md`. Keep deterministic rules false-positive-free (they block builds); push anything fuzzy to the rubric.
