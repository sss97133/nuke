/**
 * CardTier — Data completeness tier badge (F through SSS).
 *
 * Shows a small colored letter indicating data quality.
 */

export interface CardTierProps {
  tier: string;
}

const TIER_COLORS: Record<string, string> = {
  SSS: '#7c3aed',
  SS: '#8b5cf6',
  S: '#ef4444',
  A: '#f59e0b',
  B: '#3b82f6',
  C: '#10b981',
  D: '#6b7280',
  E: '#9ca3af',
  F: '#a855f7',
};

export function CardTier({ tier }: CardTierProps) {
  if (!tier) return null;

  const color = TIER_COLORS[tier] || '#6b7280';

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 'var(--feed-font-size-sm, 8px)',
        fontWeight: 800,
        fontFamily: 'Arial, sans-serif',
        color,
        lineHeight: 1,
        padding: '1px 3px',
        border: `1px solid ${color}40`,
      }}
      title={`Data completeness: ${tier}`}
    >
      {tier}
    </span>
  );
}
