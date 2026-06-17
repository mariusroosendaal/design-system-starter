import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

// Spec: design-system/components/button.md
// Example component — shows the token-only + state-layer + focus-ring pattern.
const base = cx(
  'relative isolate inline-flex items-center justify-center gap-2 rounded-interactive',
  'select-none whitespace-nowrap transition-colors',
  'focus-visible:outline-none focus-visible:shadow-focus',
  'disabled:opacity-40 disabled:pointer-events-none',
  "after:content-[''] after:absolute after:inset-0 after:rounded-[inherit] after:pointer-events-none",
  'after:opacity-0 after:transition-opacity hover:after:opacity-100',
  'after:bg-interactive-hovered active:after:bg-interactive-pressed',
);

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-interactive-default text-text-inverse',
  secondary: 'bg-transparent text-text-default border border-border-input',
  ghost: 'bg-transparent text-text-default',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-control-sm px-3 type-ui-sm-2xl-strong',
  md: 'h-control-md px-4 type-ui-sm-2xl-strong',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', fullWidth = false, type = 'button', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(base, variantClass[variant], sizeClass[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </button>
  );
});
