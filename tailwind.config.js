/**
 * Tailwind theme mapped to the SNAP design tokens.
 *
 * Every value points at a CSS custom property from design-system/dist/tokens.css
 * (via var()), NOT a literal — so utilities inherit the responsive cascade for
 * free. `colors` is REPLACED (not extended): only semantic SNAP tokens exist,
 * so there is no `bg-gray-200` escape hatch.
 *
 * When you change your token GROUPS (e.g. add a status color), update the map
 * here to match. Keys mirror the semantic token names in color.json /
 * dimension.json / typography.json.
 */
const dimension = require('./design-system/tokens/dimension.json');

// Derive screens from the breakpoint.* tokens (single source of truth) so they
// can never drift from tokens.css. The 0px base is mobile-first → not a screen.
const screens = Object.fromEntries(
  Object.entries(dimension.breakpoint)
    .filter(([key, v]) => !key.startsWith('$') && parseInt(v.$value, 10) > 0)
    .map(([key, v]) => [key, v.$value]),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens,
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      background: {
        default: 'var(--background-default)',
        surface: 'var(--background-surface)',
        inverse: 'var(--background-inverse)',
        overlay: 'var(--background-overlay)',
        'overlay-strong': 'var(--background-overlay-strong)',
        'accent-1': 'var(--background-accent-1)',
        'accent-2': 'var(--background-accent-2)',
        info: 'var(--background-info)',
        positive: 'var(--background-positive)',
        negative: 'var(--background-negative)',
        disabled: 'var(--background-disabled)',
        'interactive-primary': 'var(--background-interactive-primary)',
        'interactive-primary-hovered': 'var(--background-interactive-primary-hovered)',
        'interactive-accent': 'var(--background-interactive-accent)',
        'interactive-negative': 'var(--background-interactive-negative)',
        'interactive-negative-hovered': 'var(--background-interactive-negative-hovered)',
      },
      border: {
        default: 'var(--border-default)',
        subtle: 'var(--border-subtle)',
        input: 'var(--border-input)',
        strong: 'var(--border-strong)',
        inverse: 'var(--border-inverse)',
        info: 'var(--border-info)',
        positive: 'var(--border-positive)',
        negative: 'var(--border-negative)',
        disabled: 'var(--border-disabled)',
        'interactive-accent': 'var(--border-interactive-accent)',
        focus: 'var(--border-focus)',
      },
      text: {
        default: 'var(--text-default)',
        secondary: 'var(--text-secondary)',
        inverse: 'var(--text-inverse)',
        'accent-1': 'var(--text-accent-1)',
        'accent-2': 'var(--text-accent-2)',
        info: 'var(--text-info)',
        positive: 'var(--text-positive)',
        negative: 'var(--text-negative)',
        disabled: 'var(--text-disabled)',
        'interactive-accent': 'var(--text-interactive-accent)',
        'interactive-accent-hovered': 'var(--text-interactive-accent-hovered)',
      },
    },
    extend: {
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        7: 'var(--space-7)',
        8: 'var(--space-8)',
        9: 'var(--space-9)',
        10: 'var(--space-10)',
        11: 'var(--space-11)',
        12: 'var(--space-12)',
        13: 'var(--space-13)',
        14: 'var(--space-14)',
      },
      borderRadius: {
        none: 'var(--radius-none)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        focus: 'var(--shadow-focus)',
      },
      height: {
        'control-sm': 'var(--interactive-height-sm)',
        'control-md': 'var(--interactive-height-md)',
      },
      minHeight: {
        'control-sm': 'var(--interactive-height-sm)',
        'control-md': 'var(--interactive-height-md)',
      },
      maxWidth: {
        'content-narrow': 'var(--content-width-narrow)',
        'content-standard': 'var(--content-width-standard)',
        'content-wide': 'var(--content-width-wide)',
      },
      fontFamily: {
        sans: ['var(--font-family-sans)'],
        serif: ['var(--font-family-serif)'],
      },
    },
  },
  plugins: [],
};
