import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/cx';

// Spec: design-system/components/button.md
// Reference component for the SNAP system. SNAP controls are square (radius 0)
// and signal interaction by swapping color tokens — not a translucent overlay.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

const base = cx(
  'inline-flex items-center justify-center gap-2 rounded-none',
  'select-none whitespace-nowrap transition-colors type-body-medium',
  'focus-visible:outline-none focus-visible:shadow-focus',
  'disabled:bg-background-disabled disabled:text-text-disabled disabled:border-border-disabled disabled:pointer-events-none',
);

const variantClass: Record<ButtonVariant, string> = {
  // Primary: navy fill → bright fill on hover/press, label flips to ink for contrast.
  primary: cx(
    'bg-background-interactive-primary text-text-inverse',
    'hover:bg-background-interactive-primary-hovered hover:text-text-default',
    'active:bg-background-interactive-primary-hovered active:text-text-default',
  ),
  // Secondary: outlined; translucent ink overlay tokens carry hover/press.
  secondary: cx(
    'border border-border-strong bg-transparent text-text-default',
    'hover:bg-background-overlay active:bg-background-overlay-strong',
  ),
  // Ghost: text-only; same overlay tokens for hover/press.
  ghost: cx(
    'bg-transparent text-text-default',
    'hover:bg-background-overlay active:bg-background-overlay-strong',
  ),
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-control-sm px-3',
  md: 'h-control-md px-4',
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
      {children}
    </button>
  );
});
