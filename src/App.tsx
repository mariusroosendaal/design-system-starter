import { useEffect, useRef, useState } from 'react';
import { Button } from './components';

type TypeSpec = {
  /** The .type-* class to apply. */
  className: string;
  /** Sample copy to render in the style. */
  sample: string;
};

type TypeGroup = {
  title: string;
  note: string;
  styles: TypeSpec[];
};

const PANGRAM = 'The quick brown fox jumps over the lazy dog';

const TYPE_RAMP: TypeGroup[] = [
  {
    title: 'Headings',
    note: 'GT America. Display/large/medium are Light; small is Bold.',
    styles: [
      { className: 'type-heading-display', sample: 'Heading display' },
      { className: 'type-heading-large', sample: 'Heading large' },
      { className: 'type-heading-medium', sample: 'Heading medium' },
      { className: 'type-heading-small', sample: 'Heading small' },
    ],
  },
  {
    title: 'Expressive headings',
    note: 'Tobias Regular — editorial display.',
    styles: [
      { className: 'type-heading-expressive-display', sample: 'Expressive display' },
      { className: 'type-heading-expressive-large', sample: 'Expressive large' },
      { className: 'type-heading-expressive-medium', sample: 'Expressive medium' },
      { className: 'type-heading-expressive-small', sample: 'Expressive small' },
    ],
  },
  {
    title: 'Body',
    note: 'GT America Light; -strong is Bold.',
    styles: [
      { className: 'type-body-large', sample: `Body large. ${PANGRAM}.` },
      { className: 'type-body-large-strong', sample: `Body large strong. ${PANGRAM}.` },
      { className: 'type-body-medium', sample: `Body medium. ${PANGRAM}.` },
      { className: 'type-body-medium-strong', sample: `Body medium strong. ${PANGRAM}.` },
      { className: 'type-body-small', sample: `Body small. ${PANGRAM}.` },
      { className: 'type-body-small-strong', sample: `Body small strong. ${PANGRAM}.` },
    ],
  },
  {
    title: 'Labels & captions',
    note: 'GT America. Labels are Bold; label-small is an uppercase eyebrow.',
    styles: [
      { className: 'type-label-medium', sample: 'Label medium' },
      { className: 'type-label-small', sample: 'Label small' },
      { className: 'type-caption', sample: 'Caption — supporting helper text.' },
    ],
  },
  {
    title: 'Numeral',
    note: 'Tobias Regular — tabular display numerals.',
    styles: [{ className: 'type-numeral', sample: '0123456789' }],
  },
];

type ColorSpec = {
  /** Semantic token name within its group, e.g. "interactive-primary". */
  name: string;
  /** The backing CSS custom property, e.g. "--background-interactive-primary". */
  cssVar: string;
  note?: string;
};

type ColorGroup = {
  title: string;
  note: string;
  /** How the swatch is rendered: filled tile, text sample, or bordered box. */
  kind: 'fill' | 'text' | 'border';
  colors: ColorSpec[];
};

const COLOR_SYSTEM: ColorGroup[] = [
  {
    title: 'Background',
    note: 'Surface fills, overlays, and interactive action fills.',
    kind: 'fill',
    colors: [
      { name: 'default', cssVar: '--background-default' },
      { name: 'surface', cssVar: '--background-surface' },
      { name: 'inverse', cssVar: '--background-inverse' },
      { name: 'overlay', cssVar: '--background-overlay' },
      { name: 'overlay-strong', cssVar: '--background-overlay-strong' },
      { name: 'accent-1', cssVar: '--background-accent-1' },
      { name: 'accent-2', cssVar: '--background-accent-2' },
      { name: 'info', cssVar: '--background-info' },
      { name: 'positive', cssVar: '--background-positive' },
      { name: 'negative', cssVar: '--background-negative' },
      { name: 'disabled', cssVar: '--background-disabled' },
      { name: 'interactive-primary', cssVar: '--background-interactive-primary' },
      { name: 'interactive-primary-hovered', cssVar: '--background-interactive-primary-hovered' },
      { name: 'interactive-accent', cssVar: '--background-interactive-accent' },
      { name: 'interactive-negative', cssVar: '--background-interactive-negative' },
      { name: 'interactive-negative-hovered', cssVar: '--background-interactive-negative-hovered' },
    ],
  },
  {
    title: 'Text',
    note: 'Foreground type colors. Never signal state with color alone.',
    kind: 'text',
    colors: [
      { name: 'default', cssVar: '--text-default' },
      { name: 'secondary', cssVar: '--text-secondary' },
      { name: 'inverse', cssVar: '--text-inverse', note: 'shown on inverse bg' },
      { name: 'accent-1', cssVar: '--text-accent-1' },
      { name: 'accent-2', cssVar: '--text-accent-2' },
      { name: 'info', cssVar: '--text-info' },
      { name: 'positive', cssVar: '--text-positive' },
      { name: 'negative', cssVar: '--text-negative' },
      { name: 'disabled', cssVar: '--text-disabled' },
      { name: 'interactive-accent', cssVar: '--text-interactive-accent' },
      { name: 'interactive-accent-hovered', cssVar: '--text-interactive-accent-hovered' },
    ],
  },
  {
    title: 'Border',
    note: 'Dividers, input outlines, and the focus ring color.',
    kind: 'border',
    colors: [
      { name: 'default', cssVar: '--border-default' },
      { name: 'subtle', cssVar: '--border-subtle' },
      { name: 'input', cssVar: '--border-input' },
      { name: 'strong', cssVar: '--border-strong' },
      { name: 'inverse', cssVar: '--border-inverse', note: 'shown on inverse bg' },
      { name: 'info', cssVar: '--border-info' },
      { name: 'positive', cssVar: '--border-positive' },
      { name: 'negative', cssVar: '--border-negative' },
      { name: 'disabled', cssVar: '--border-disabled' },
      { name: 'interactive-accent', cssVar: '--border-interactive-accent' },
      { name: 'focus', cssVar: '--border-focus' },
    ],
  },
];

function ColorSwatch({ kind, color }: { kind: ColorGroup['kind']; color: ColorSpec }) {
  const onInverse = color.note === 'shown on inverse bg';

  let preview;
  if (kind === 'fill') {
    preview = (
      <div
        className="h-14 w-full border border-border-subtle"
        style={{ background: `var(${color.cssVar})` }}
      />
    );
  } else if (kind === 'text') {
    preview = (
      <div
        className={`flex h-14 w-full items-center justify-center border ${
          onInverse ? 'border-border-subtle bg-background-inverse' : 'border-border-subtle bg-background-surface'
        }`}
      >
        <span className="type-heading-small" style={{ color: `var(${color.cssVar})` }}>
          Aa
        </span>
      </div>
    );
  } else {
    preview = (
      <div
        className={`h-14 w-full ${onInverse ? 'bg-background-inverse' : 'bg-background-surface'}`}
        style={{ border: `2px solid var(${color.cssVar})` }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {preview}
      <code className="type-caption text-text-default">{color.name}</code>
      <code className="type-caption text-text-secondary">{color.cssVar}</code>
    </div>
  );
}

/** The semantic spacing scale — every step is responsive via the token cascade. */
const SPACING_SCALE = Array.from({ length: 14 }, (_, i) => {
  const step = i + 1;
  return { name: `space-${step}`, cssVar: `--space-${step}` };
});

function SpacingBar({ name, cssVar }: { name: string; cssVar: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setPx(Math.round(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex items-center gap-4">
      <code className="type-caption w-24 shrink-0 text-text-default">{name}</code>
      <div className="flex flex-1 items-center gap-3">
        <div
          ref={ref}
          className="h-2 bg-background-accent-1"
          style={{ width: `var(${cssVar})` }}
        />
        <code className="type-caption shrink-0 text-text-secondary">
          {px !== null ? `${px}px` : ''}
        </code>
      </div>
    </div>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-background-default p-6 lg:p-10">
      <div className="mx-auto flex max-w-content-standard flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="type-label-small text-text-secondary">SNAP — Agentic Design System</p>
          <h1 className="type-heading-display text-text-default">Foundations & components</h1>
          <p className="type-body-large text-text-secondary">
            Everything here is driven by semantic SNAP tokens — no hardcoded values.
          </p>
        </header>

        <section className="flex flex-col gap-4 border border-border-default bg-background-surface p-6">
          <p className="type-label-small text-text-secondary">Button — variants</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
          </div>

          <p className="type-label-small text-text-secondary">Button — sizes</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="md" fullWidth>
              Full width
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-8 border border-border-default bg-background-surface p-6">
          <p className="type-label-small text-text-secondary">Type ramp</p>
          {TYPE_RAMP.map((group) => (
            <div key={group.title} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 border-b border-border-default pb-2">
                <h2 className="type-heading-small text-text-default">{group.title}</h2>
                <p className="type-body-small text-text-secondary">{group.note}</p>
              </div>
              {group.styles.map((style) => (
                <div
                  key={style.className}
                  className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-6"
                >
                  <code className="type-caption shrink-0 text-text-secondary md:w-64">
                    .{style.className}
                  </code>
                  <p className={`${style.className} text-text-default`}>{style.sample}</p>
                </div>
              ))}
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-8 border border-border-default bg-background-surface p-6">
          <p className="type-label-small text-text-secondary">Color system</p>
          {COLOR_SYSTEM.map((group) => (
            <div key={group.title} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 border-b border-border-default pb-2">
                <h2 className="type-heading-small text-text-default">{group.title}</h2>
                <p className="type-body-small text-text-secondary">{group.note}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {group.colors.map((color) => (
                  <ColorSwatch key={color.cssVar} kind={group.kind} color={color} />
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-4 border border-border-default bg-background-surface p-6">
          <div className="flex flex-col gap-1 border-b border-border-default pb-2">
            <p className="type-label-small text-text-secondary">Responsive spacing</p>
            <h2 className="type-heading-small text-text-default">Spacing scale</h2>
            <p className="type-body-small text-text-secondary">
              Each bar's width is the token itself. Resize the window — values step up at the
              sm → md → lg → xl → 2xl breakpoints via the token cascade.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {SPACING_SCALE.map((token) => (
              <SpacingBar key={token.cssVar} name={token.name} cssVar={token.cssVar} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
