/**
 * CensusSummaryBar — Top-line numbers: scale, velocity, and fixable gaps
 */
import type { CSSProperties } from 'react';
import type { DataPulseResult } from './useDataPulse';

const bigNum: CSSProperties = {
  fontFamily: '"Courier New", monospace',
  fontSize: '22px',
  fontWeight: 700,
  lineHeight: 1,
  color: 'var(--surface-hover)',
};

const label: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '1px',
  color: 'var(--text-disabled)',
  marginTop: '4px',
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

export function CensusSummaryBar({ totals, activePlatforms }: {
  totals: DataPulseResult['totals'];
  activePlatforms: number;
}) {
  return (
    <div style={{
      display: 'flex',
      gap: '20px',
      padding: '12px 16px',
      border: '2px solid #333',
      background: '#222',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={bigNum}>{fmt(totals.total_vehicles)}</div>
        <div style={label}>TOTAL VEHICLES</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ ...bigNum, color: totals.added_7d > 0 ? '#16825d' : '#d13438' }}>
          +{fmt(totals.added_7d)}
        </div>
        <div style={label}>THIS WEEK</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={bigNum}>{activePlatforms}</div>
        <div style={label}>PLATFORMS ACTIVE</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ ...bigNum, color: '#d13438' }}>{fmt(totals.missing_vin)}</div>
        <div style={label}>MISSING VIN</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ ...bigNum, color: '#d13438' }}>{fmt(totals.missing_desc)}</div>
        <div style={label}>MISSING DESC</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ ...bigNum, color: totals.missing_price > 1000 ? '#d13438' : '#b05a00' }}>
          {fmt(totals.missing_price)}
        </div>
        <div style={label}>SOLD NO PRICE</div>
      </div>
    </div>
  );
}
