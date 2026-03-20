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
  S: 'var(--error)',
  A: 'var(--warning)',
  B: 'var(--info)',
  C: 'var(--success)',
  D: 'var(--text-secondary)',
  E: 'var(--text-disabled)',
  F: '#a855f7',
};

export function CardTier({ tier }: CardTierProps) {
  if (!tier) return null;

  const color = TIER_COLORS[tier] || 'var(--text-secondary)';

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
