/**
 * CardDealScore — Deal/heat score indicator pill.
 *
 * Shows "GREAT DEAL", "GOOD DEAL", "FAIR", "OVERPRICED" etc.
 * Each badge is a BadgePortal — click to see all vehicles with that deal score.
 * Only renders when score exists and isn't "fair" (the default/neutral state).
 */

import { BadgePortal } from '../../../components/badges/BadgePortal';

export interface CardDealScoreProps {
  dealScore?: number | null;
  dealScoreLabel?: string | null;
  heatScore?: number | null;
  heatScoreLabel?: string | null;
}

const DEAL_CONFIG: Record<string, { bg: string; text: string; display: string; tooltip: string }> = {
  plus_3:  { bg: '#16825d', text: 'var(--surface-elevated)', display: 'STEAL', tooltip: 'Price significantly below comparable vehicles' },
  plus_2:  { bg: '#16825d', text: 'var(--surface-elevated)', display: 'GREAT DEAL', tooltip: 'Price well below market average' },
  plus_1:  { bg: '#2d9d78', text: 'var(--surface-elevated)', display: 'GOOD DEAL', tooltip: 'Price below market average' },
  fair:    { bg: 'transparent', text: 'var(--text-secondary)', display: 'FAIR', tooltip: 'Price in line with market' },
  minus_1: { bg: '#b05a00', text: 'var(--surface-elevated)', display: 'ABOVE MARKET', tooltip: 'Price above market average' },
  minus_2: { bg: '#d13438', text: 'var(--surface-elevated)', display: 'OVERPRICED', tooltip: 'Price well above comparable vehicles' },
  minus_3: { bg: '#d13438', text: 'var(--surface-elevated)', display: 'WAY OVER', tooltip: 'Price significantly above market' },
};

export function CardDealScore({
  dealScoreLabel,
  heatScoreLabel,
}: CardDealScoreProps) {
  const dealConfig = dealScoreLabel ? DEAL_CONFIG[dealScoreLabel] : null;

  const showDeal = dealConfig && dealScoreLabel !== 'fair';
  const showHeat = heatScoreLabel && heatScoreLabel !== 'cold';

  if (!showDeal && !showHeat) return null;

  return (
    <div
      style={{
        padding: '0 8px 4px',
        display: 'flex',
        gap: '4px',
        flexWrap: 'wrap',
      }}
    >
      {showDeal && dealScoreLabel && (
        <BadgePortal
          dimension="deal_score"
          value={dealScoreLabel}
          label={dealConfig.display}
          bg={dealConfig.bg}
          color={dealConfig.text}
          borderColor={dealConfig.bg === 'transparent' ? undefined : dealConfig.bg}
          tooltip={dealConfig.tooltip}
        />
      )}
      {showHeat && heatScoreLabel && (
        <BadgePortal
          dimension="status"
          value={heatScoreLabel}
          label={heatScoreLabel.toUpperCase()}
          variant="status"
          static
          tooltip={
            heatScoreLabel === 'volcanic' ? 'Extremely high interest'
            : heatScoreLabel === 'fire' ? 'Very high interest'
            : heatScoreLabel === 'hot' ? 'Above-average interest'
            : 'Moderate interest'
          }
        />
      )}
    </div>
  );
}
