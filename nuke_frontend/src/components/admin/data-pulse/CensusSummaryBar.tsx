/**
 * CensusSummaryBar — Top-line big numbers for the Data Pulse page
 */
import type { CSSProperties } from 'react';
import type { DataPulseResult } from './useDataPulse';

const bigNum: CSSProperties = {
  fontFamily: '"Courier New", monospace',
  fontSize: '22px',
  fontWeight: 700,
  lineHeight: 1,
  color: '#e0e0e0',
};

const label: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '1px',
  color: '#888',
  marginTop: '4px',
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function fmtPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export function CensusSummaryBar({ totals, activePlatforms }: {
  totals: DataPulseResult['totals'];
  activePlatforms: number;
}) {
  const qualityPct = totals.total_vehicles > 0
    ? Math.round(((totals.with_vin + totals.with_description + totals.sold_with_price) / (totals.total_vehicles * 3)) * 100)
    : 0;

  return (
    <div style={{
      display: 'flex',
      gap: '24px',
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
        <div style={bigNum}>{activePlatforms}</div>
        <div style={label}>PLATFORMS ACTIVE</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={bigNum}>{fmt(totals.sold_with_price)}</div>
        <div style={label}>SOLD W/ PRICE</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={bigNum}>{fmtPrice(totals.median_sold_price)}</div>
        <div style={label}>MEDIAN SOLD</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ ...bigNum, color: qualityPct >= 70 ? '#16825d' : qualityPct >= 45 ? '#b05a00' : '#d13438' }}>
          {qualityPct}%
        </div>
        <div style={label}>DATA QUALITY</div>
      </div>
    </div>
  );
}
