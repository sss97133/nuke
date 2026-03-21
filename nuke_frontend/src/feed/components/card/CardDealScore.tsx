/**
 * CardDealScore — Deal/heat score indicator pill.
 *
 * Shows "GREAT DEAL", "GOOD DEAL", "FAIR", "OVERPRICED" etc.
 * Only renders when score exists and isn't "fair" (the default/neutral state).
 */

import type { CSSProperties } from 'react';

export interface CardDealScoreProps {
  dealScore?: number | null;
  dealScoreLabel?: string | null;
  heatScore?: number | null;
  heatScoreLabel?: string | null;
}

// Colors matching DEAL_SCORE_CONFIG from constants/dealScore.ts
const DEAL_COLORS: Record<string, { bg: string; text: string; display: string; tooltip: string }> = {
  plus_3:  { bg: '#16825d', text: 'var(--surface-elevated)', display: 'STEAL', tooltip: 'Price significantly below comparable vehicles' },
  plus_2:  { bg: '#16825d', text: 'var(--surface-elevated)', display: 'GREAT DEAL', tooltip: 'Price well below market average' },
  plus_1:  { bg: '#2d9d78', text: 'var(--surface-elevated)', display: 'GOOD DEAL', tooltip: 'Price below market average' },
  fair:    { bg: 'transparent', text: 'var(--text-secondary)', display: 'FAIR', tooltip: 'Price in line with market' },
  minus_1: { bg: '#b05a00', text: 'var(--surface-elevated)', display: 'ABOVE MARKET', tooltip: 'Price above market average' },
  minus_2: { bg: '#d13438', text: 'var(--surface-elevated)', display: 'OVERPRICED', tooltip: 'Price well above comparable vehicles' },
  minus_3: { bg: '#d13438', text: 'var(--surface-elevated)', display: 'WAY OVER', tooltip: 'Price significantly above market' },
};

const HEAT_COLORS: Record<string, { color: string; display: string; tooltip: string }> = {
  volcanic: { color: '#d13438', display: 'VOLCANIC', tooltip: 'Extremely high interest and engagement' },
  fire:     { color: 'var(--error)', display: 'FIRE', tooltip: 'Very high interest from buyers' },
  hot:      { color: 'var(--warning)', display: 'HOT', tooltip: 'Above-average buyer interest' },
  warm:     { color: '#b05a00', display: 'WARM', tooltip: 'Moderate buyer interest' },
  cold:     { color: 'var(--text-disabled)', display: 'COLD', tooltip: 'Low buyer interest' },
};

export function CardDealScore({
  dealScoreLabel,
  heatScoreLabel,
}: CardDealScoreProps) {
  const dealConfig = dealScoreLabel ? DEAL_COLORS[dealScoreLabel] : null;
  const heatConfig = heatScoreLabel ? HEAT_COLORS[heatScoreLabel] : null;

  // Don't render if both are neutral/missing
  const showDeal = dealConfig && dealScoreLabel !== 'fair';
  const showHeat = heatConfig && heatScoreLabel !== 'cold';

  if (!showDeal && !showHeat) return null;

  const pillStyle: CSSProperties = {
    display: 'inline-block',
    fontSize: 'var(--feed-font-size-sm, 8px)',
    fontWeight: 800,
    fontFamily: 'Arial, sans-serif',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    padding: '1px 4px',
    lineHeight: 1.4,
    border: '1px solid var(--border)',
  };

  return (
    <div
      style={{
        padding: '0 8px 4px',
        display: 'flex',
        gap: '4px',
        flexWrap: 'wrap',
      }}
    >
      {showDeal && (
        <span
          title={dealConfig.tooltip}
          style={{
            ...pillStyle,
            background: dealConfig.bg,
            color: dealConfig.text,
            borderColor: dealConfig.bg === 'transparent' ? 'var(--border)' : dealConfig.bg,
          }}
        >
          {dealConfig.display}
        </span>
      )}
      {showHeat && (
        <span
          title={heatConfig.tooltip}
          style={{
            ...pillStyle,
            color: heatConfig.color,
            borderColor: heatConfig.color,
          }}
        >
          {heatConfig.display}
        </span>
      )}
    </div>
  );
}
