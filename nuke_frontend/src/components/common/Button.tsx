import React from 'react';
import { Link, type LinkProps } from 'react-router-dom';

// ─── Types ───────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'danger' | 'utility' | 'ghost' | 'tag';
type Size    = 'xs' | 'sm' | 'md';

interface BaseProps {
  variant?: Variant;
  size?: Size;
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
}

// Button renders a <button> element
type ButtonElementProps = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & {
    as?: 'button';
    to?: never;
  };

// Link renders a react-router-dom <Link> element (for navigation)
type LinkElementProps = BaseProps &
  Omit<LinkProps, keyof BaseProps | 'to'> & {
    as: 'link';
    to: string;
    disabled?: boolean;
  };

// Anchor renders a plain <a> element (for external hrefs)
type AnchorElementProps = BaseProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps> & {
    as: 'a';
    to?: never;
  };

type ButtonProps = ButtonElementProps | LinkElementProps | AnchorElementProps;

// ─── Class builder ───────────────────────────────────────────────────────────

const VARIANT_CLASS: Record<Variant, string> = {
  primary:   'btn-primary',
  secondary: 'btn-secondary',
  danger:    'btn-danger',
  utility:   'btn-utility',
  ghost:     'btn-ghost',
  tag:       'btn-tag',
};

const SIZE_CLASS: Record<Size, string> = {
  xs: 'btn-xs',
  sm: 'btn-sm',
  md: 'btn-md',
};

function buildClassName(
  variant: Variant = 'secondary',
  size: Size = 'md',
  active = false,
  extra?: string,
): string {
  const classes = ['btn-base', VARIANT_CLASS[variant], SIZE_CLASS[size]];
  if (active) classes.push('active');
  if (extra)  classes.push(extra);
  return classes.join(' ');
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Canonical Nuke button.
 *
 * Usage:
 *   <Button variant="primary">Save</Button>
 *   <Button variant="secondary" size="sm" onClick={fn}>Cancel</Button>
 *   <Button as="link" to="/vehicles" variant="ghost">Browse</Button>
 *   <Button as="a" href="https://..." variant="utility" target="_blank">Docs</Button>
 *
 * Replaces: .button .button-primary, .button .button-secondary, .btn-utility,
 *           .btn-primary, .cursor-button, .tag-btn, .admin-button, .button-win95
 *
 * Do NOT add inline styles. Add variants to unified-design-system.css instead.
 */
export const Button = React.forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonProps
>((props, ref) => {
  const { variant = 'secondary', size = 'md', active = false, className, children } = props;
  const cls = buildClassName(variant, size, active, className);

  if (props.as === 'link') {
    const { as: _a, variant: _v, size: _s, active: _ac, ...rest } = props as LinkElementProps;
    const { disabled } = rest;
    return (
      <Link
        {...rest}
        className={cls}
        aria-disabled={disabled || undefined}
        onClick={disabled ? (e) => e.preventDefault() : rest.onClick}
      >
        {children}
      </Link>
    );
  }

  if (props.as === 'a') {
    const { as: _a, variant: _v, size: _s, active: _ac, ...rest } = props as AnchorElementProps;
    return (
      <a ref={ref as React.Ref<HTMLAnchorElement>} {...rest} className={cls}>
        {children}
      </a>
    );
  }

  const { as: _a, variant: _v, size: _s, active: _ac, ...rest } = props as ButtonElementProps;
  return (
    <button ref={ref as React.Ref<HTMLButtonElement>} {...rest} className={cls}>
      {children}
    </button>
  );
});

Button.displayName = 'Button';
export default Button;
