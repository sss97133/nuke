/**
 * CardIdentity — Vehicle Year Make Model display.
 *
 * Primary line: Year Make Model
 * Secondary line: Series / Trim (if available and not compact)
 */

import type { CSSProperties } from 'react';

export interface CardIdentityProps {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  series?: string | null;
  trim?: string | null;
  compact?: boolean;
}

export function CardIdentity({
  year,
  make,
  model,
  series,
  trim,
  compact = false,
}: CardIdentityProps) {
  const primary = [year, make, model].filter(Boolean).join(' ') || 'Vehicle';
  const secondary = [series, trim].filter(Boolean).join(' ');

  const primaryStyle: CSSProperties = {
    fontFamily: 'Arial, sans-serif',
    fontSize: compact ? 'var(--feed-font-size-sm, 9px)' : 'var(--feed-font-size, 11px)',
    fontWeight: 700,
    lineHeight: 1.2,
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const secondaryStyle: CSSProperties = {
    fontFamily: 'Arial, sans-serif',
    fontSize: 'var(--feed-font-size-sm, 9px)',
    color: 'var(--text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.2,
  };

  return (
    <div style={{ padding: compact ? '4px' : '4px 8px', minWidth: 0 }}>
      <div style={primaryStyle}>{primary}</div>
      {!compact && secondary && <div style={secondaryStyle}>{secondary}</div>}
    </div>
  );
}
