# Typography

Apply a `.type-*` ramp class chosen by **meaning**. Prefer the responsive family class (`.type-heading-large`) over a discrete per-breakpoint class (`.type-heading-large-md`) unless you need fixed control.

## Families

- **sans → "GT America"** (`--font-family-sans`): headings, body, labels, captions.
- **serif → "Tobias"** (`--font-family-serif`): `heading-expressive/*` (editorial display) and `numeral`.

Both are licensed brand faces and are not bundled — fallback stacks render until the WOFF2 files are added (see `../fonts/fonts.css`).

## Weights

`light` 300 · `regular` 400 · `bold` 700. (GT America headings are Light; `heading-small` and labels are Bold; body is Light with a `-strong` Bold variant.)

## Ramp roles

- `heading-display | -large | -medium | -small` — UI headings (GT America). Sizes scale up sm→2xl.
- `heading-expressive-display | -large | -medium | -small` — editorial headings (Tobias).
- `body-large | -medium | -small` — running text and control labels; each has a `-strong` (Bold) variant.
- `label-medium` — bold inline labels.
- `label-small` — **uppercase** eyebrow (bold, tracked).
- `caption` — small secondary text.
- `numeral` — large Tobias display numbers.

## Rules

- No ad-hoc `font-size` / `line-height` / `font-weight` / `letter-spacing` — it's all in the ramp.
- Type sizes are **responsive**: the family class re-sizes at `md/lg/xl/2xl` automatically.
- Match role to meaning (a button label is `body-medium`, not `heading-small`).
