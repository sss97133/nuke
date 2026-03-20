/**
 * CardMeta — Metadata strip below vehicle title.
 *
 * Shows mileage, transmission, drivetrain, body style, and relative time.
 * Courier New for numeric data. Chip-style badges for body/drivetrain.
 */

import type { CSSProperties } from 'react';

export interface CardMetaProps {
  mileage?: number | null;
  transmission?: string | null;
  drivetrain?: string | null;
  bodyStyle?: string | null;
  timeLabel?: string | null;
  compact?: boolean;
}

const chipStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 'var(--feed-font-size-xs, 7px)',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  padding: '1px 4px',
  border: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
};

export function CardMeta({ mileage, transmission, drivetrain, bodyStyle, timeLabel, compact = false }: CardMetaProps) {
  // Data line: mileage / trans / drivetrain
  const dataParts: string[] = [];
  if (typeof mileage === 'number' && mileage > 0) {
    dataParts.push(`${Math.floor(mileage).toLocaleString()} mi`);
  }
  if (transmission) {
    const t = transmission.toLowerCase();
    if (t.includes('manual') || t.includes('stick')) dataParts.push('Manual');
    else if (t.includes('auto')) dataParts.push('Auto');
    else if (t.includes('sequential')) dataParts.push('Seq');
    else dataParts.push(transmission.slice(0, 12));
  }
  if (drivetrain) {
    const d = drivetrain.toUpperCase();
    if (d.includes('4WD') || d.includes('4X4')) dataParts.push('4WD');
    else if (d.includes('AWD')) dataParts.push('AWD');
    else if (d.includes('RWD')) dataParts.push('RWD');
    else if (d.includes('FWD')) dataParts.push('FWD');
  }

  const hasData = dataParts.length > 0;
  const hasChips = !!bodyStyle;
  const hasTime = !!timeLabel;

  if (!hasData && !hasChips && !hasTime) return null;

  return (
    <div style={{ padding: compact ? '0 4px 2px' : '0 8px 4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {/* Data line */}
      {hasData && (
        <div
          style={{
            fontSize: compact ? 'var(--feed-font-size-sm, 8px)' : 'var(--feed-font-size-sm, 9px)',
            fontFamily: "'Courier New', monospace",
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
          }}
        >
          {dataParts.join(' / ')}
        </div>
      )}

      {/* Chips row: body style + time label */}
      {(hasChips || hasTime) && !compact && (
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', alignItems: 'center' }}>
          {bodyStyle && (
            <span style={chipStyle}>
              {bodyStyle.length > 14 ? bodyStyle.slice(0, 12) + '..' : bodyStyle}
            </span>
          )}
          {timeLabel && (
            <span style={{
              ...chipStyle,
              fontFamily: "'Courier New', monospace",
              fontSize: '7px',
              color: timeLabel.startsWith('sold') ? 'var(--success)'
                : timeLabel.startsWith('ends') ? 'var(--error)'
                : timeLabel.startsWith('listed') ? 'var(--info)'
                : 'var(--text-disabled)',
              borderColor: 'transparent',
              padding: '1px 2px',
            }}>
              {timeLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
