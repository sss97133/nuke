/**
 * CardPrice — Floating price badge on vehicle image.
 *
 * Handles all auction states: live bid (pulsing), SOLD (green accent),
 * RESULT/RNM (yellow accent), asking price, estimate.
 */

import type { CSSProperties } from 'react';
import type { ResolvedPrice } from '../../types/feed';

export interface CardPriceProps {
  price: ResolvedPrice;
  compact?: boolean;
}

export function CardPrice({ price, compact = false }: CardPriceProps) {
  if (price.source === 'none' && !price.amount) return null;

  // Determine border accent color
  const borderColor = price.isSold
    ? '#10b98180'
    : price.isResult
      ? '#f59e0b80'
      : price.isLive
        ? 'rgba(59,130,246,0.55)'
        : 'rgba(255,255,255,0.18)';

  // Parse badge into label + value
  const badgeUpper = price.badgeText.toUpperCase();
  let label: string | null = null;
  let value: string | null = null;

  if (badgeUpper.startsWith('SOLD ')) {
    label = 'SOLD';
    value = price.badgeText.slice(5).trim() || null;
  } else if (badgeUpper.startsWith('RESULT ')) {
    label = 'RESULT';
    value = price.badgeText.slice(7).trim() || null;
  } else if (badgeUpper === 'ENDED') {
    label = 'ENDED';
  } else if (badgeUpper === 'BID') {
    label = 'BID';
  } else if (price.isLive && price.amount) {
    label = 'BID';
    value = price.formatted;
  } else {
    value = price.badgeText;
  }

  const labelColor =
    label === 'SOLD'
      ? 'var(--success)'
      : label === 'RESULT'
        ? 'var(--warning)'
        : 'rgba(255,255,255,0.92)';

  const baseStyle: CSSProperties = {
    position: 'absolute',
    top: compact ? '4px' : '6px',
    right: compact ? '4px' : '6px',
    background: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(6px)',
    color: 'white',
    padding: compact ? '3px 6px' : '4px 8px',
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    maxWidth: '85%',
    border: `1px solid ${borderColor}`,
    zIndex: 10,
    pointerEvents: 'none',
  };

  // Pulse animation for live auctions
  if (price.isLive) {
    baseStyle.animation = 'nuke-auction-pulse 3s ease-in-out infinite';
  }

  // Fade out old sold badges
  if (price.isSold && !price.showSoldBadge) {
    baseStyle.opacity = 0.4;
  }

  return (
    <div style={baseStyle}>
      {label && (
        <div
          style={{
            fontSize: compact ? '6px' : '7px',
            fontWeight: 800,
            lineHeight: 1,
            color: labelColor,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          {label}
        </div>
      )}
      {value && (
        <div
          style={{
            fontSize: compact ? '10px' : '12px',
            fontWeight: 800,
            lineHeight: 1,
            fontFamily: "'Courier New', monospace",
          }}
        >
          {value}
        </div>
      )}
    </div>
  );
}
