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
const DEAL_COLORS: Record<string, { bg: string; text: string; display: string }> = {
  plus_3:  { bg: '#16825d', text: '#ffffff', display: 'STEAL' },
  plus_2:  { bg: '#16825d', text: '#ffffff', display: 'GREAT DEAL' },
  plus_1:  { bg: '#2d9d78', text: '#ffffff', display: 'GOOD DEAL' },
  fair:    { bg: 'transparent', text: 'var(--text-secondary)', display: 'FAIR' },
  minus_1: { bg: '#b05a00', text: '#ffffff', display: 'ABOVE MARKET' },
  minus_2: { bg: '#d13438', text: '#ffffff', display: 'OVERPRICED' },
  minus_3: { bg: '#d13438', text: '#ffffff', display: 'WAY OVER' },
};

const HEAT_COLORS: Record<string, { color: string; display: string }> = {
  volcanic: { color: '#d13438', display: 'VOLCANIC' },
  fire:     { color: '#ef4444', display: 'FIRE' },
  hot:      { color: '#f59e0b', display: 'HOT' },
  warm:     { color: '#b05a00', display: 'WARM' },
  cold:     { color: 'var(--text-disabled)', display: 'COLD' },
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
