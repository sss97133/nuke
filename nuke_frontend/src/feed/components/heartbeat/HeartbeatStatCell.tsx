import type { CSSProperties } from 'react';

const labelStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  color: 'var(--text-disabled)',
  lineHeight: 1,
};

const valueStyle: CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--text)',
  lineHeight: 1,
};

export function HeartbeatStatCell({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ ...valueStyle, color: color ?? 'var(--text)' }}>{value}</span>
    </div>
  );
}
