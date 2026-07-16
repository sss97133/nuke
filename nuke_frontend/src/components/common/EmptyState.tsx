import React from 'react';
import { Button } from './Button';

// ─── Types ───────────────────────────────────────────────────────────────────

type EmptyStateAction =
  | { label: string; onClick: () => void }
  | { label: string; to: string };

interface EmptyStateProps {
  title: string;
  message?: string;
  action?: EmptyStateAction;
  className?: string;
}

// ─── Locked typography (per design-book/02-components.md "Empty States") ────
// V-16: no decorative icons. V-09: no dead-end empty states without a next action.
// Title style is fixed; message style is fixed. Action is a Button primitive.

const TITLE_STYLE: React.CSSProperties = {
  textTransform: 'uppercase',
  fontSize: 'var(--fs-12)',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-family)',
  letterSpacing: '0.06em',
  margin: 0,
};

const MESSAGE_STYLE: React.CSSProperties = {
  fontSize: 'var(--fs-10)',
  color: 'var(--text-disabled)',
  fontFamily: 'var(--font-family)',
  marginTop: 8,
  maxWidth: '36em',
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Canonical empty state.
 *
 * Required when a list could be empty. Per frontend.md "No Empty Shells" and
 * V-09 (no dead ends), every list-rendering site wraps `.map()` with:
 *
 *   if (!items.length) return <EmptyState title="NO RESULTS" message="..." action={{...}} />;
 *
 * No icons. No emoji. No "Oops!" copy. Title is uppercase 12px; message is sentence-case 10px.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  message,
  action,
  className,
}) => {
  return (
    <div
      role="status"
      className={['flex flex-col items-center text-center py-16 px-4', className]
        .filter(Boolean)
        .join(' ')}
    >
      <h2 style={TITLE_STYLE}>{title}</h2>
      {message && <p style={MESSAGE_STYLE}>{message}</p>}
      {action && (
        <div style={{ marginTop: 16 }}>
          {'onClick' in action ? (
            <Button variant="secondary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" as="link" to={action.to}>
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
