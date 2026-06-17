/**
 * Tailwind theme mapped to the design tokens.
 *
 * Every value points at a CSS custom property from design-system/dist/tokens.css
 * (via var()), NOT a literal — so utilities inherit theming + the responsive
 * cascade for free. `colors` is REPLACED (not extended): only semantic tokens
 * exist, so there is no `bg-gray-200` escape hatch.
 *
 * When you change your token GROUPS (e.g. add a status color), update the map
 * here to match. Keys mirror the semantic token names in color.json.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      md: '600px',
      lg: '900px',
    },
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      background: {
        default: 'var(--background-default)',
        secondary: 'var(--background-secondary)',
        inverse: 'var(--background-inverse)',
      },
      text: {
        default: 'var(--text-default)',
        secondary: 'var(--text-secondary)',
        inverse: 'var(--text-inverse)',
      },
      border: {
        default: 'var(--border-default)',
        input: 'var(--border-input)',
      },
      interactive: {
        default: 'var(--interactive-default)',
        hovered: 'var(--interactive-hovered)',
        pressed: 'var(--interactive-pressed)',
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
      },
      borderRadius: {
        interactive: 'var(--radius-interactive)',
        container: 'var(--radius-container)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
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
      fontFamily: {
        sans: ['var(--font-family-sans)'],
        mono: ['var(--font-family-mono)'],
      },
    },
  },
  plugins: [],
};
