/**
 * DataQualityGrid — Field completion heatmap: platforms as rows, data fields as columns
 */
import React from 'react';
import type { CSSProperties } from 'react';
import type { CensusRow } from './useDataPulse';

const S = {
  section: {
    border: '2px solid #333',
    background: '#222',
    padding: '12px',
    overflowX: 'auto' as const,
  } as CSSProperties,
  title: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
    color: 'var(--text-disabled)',
    marginBottom: '8px',
  } as CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '10px',
    fontFamily: '"Courier New", monospace',
  } as CSSProperties,
  th: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    color: 'var(--text-disabled)',
    padding: '4px 8px',
    textAlign: 'left' as const,
    borderBottom: '1px solid #333',
  } as CSSProperties,
  td: {
    padding: '3px 8px',
    borderBottom: '1px solid #2a2a2a',
  } as CSSProperties,
  platformName: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    color: 'var(--border)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap' as const,
  } as CSSProperties,
};

function pctColor(pct: number): string {
  if (pct >= 90) return '#16825d';
  if (pct >= 70) return '#1a7a4a';
  if (pct >= 50) return '#b05a00';
  if (pct >= 25) return '#c44000';
  return '#d13438';
}

function cellBg(pct: number): string {
  if (pct >= 90) return 'rgba(22, 130, 93, 0.15)';
  if (pct >= 70) return 'rgba(22, 130, 93, 0.08)';
  if (pct >= 50) return 'rgba(176, 90, 0, 0.1)';
  if (pct >= 25) return 'rgba(209, 52, 56, 0.08)';
  return 'rgba(209, 52, 56, 0.15)';
}

function pct(num: number, total: number): number {
  return total > 0 ? Math.round((num / total) * 100) : 0;
}

function PctCell({ num, total }: { num: number; total: number }) {
  const p = pct(num, total);
  return (
    <td style={{ ...S.td, color: pctColor(p), background: cellBg(p), textAlign: 'right' }}>
      {p}%
    </td>
  );
}

interface DataQualityGridProps {
  census: CensusRow[];
}

export const DataQualityGrid: React.FC<DataQualityGridProps> = ({ census }) => {
  // Only show platforms with > 10 vehicles
  const rows = census.filter((c) => c.total_vehicles > 10);

  return (
    <div style={S.section}>
      <div style={S.title}>DATA QUALITY BY PLATFORM</div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>PLATFORM</th>
            <th style={{ ...S.th, textAlign: 'right' }}>TOTAL</th>
            <th style={{ ...S.th, textAlign: 'right' }}>VIN</th>
            <th style={{ ...S.th, textAlign: 'right' }}>DESC</th>
            <th style={{ ...S.th, textAlign: 'right' }}>PRICE</th>
            <th style={{ ...S.th, textAlign: 'right' }}>SOLD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.canonical_platform}>
              <td style={{ ...S.td, ...S.platformName }}>{c.platform_display_name}</td>
              <td style={{ ...S.td, textAlign: 'right', color: 'var(--surface-hover)' }}>
                {c.total_vehicles.toLocaleString()}
              </td>
              <PctCell num={c.has_vin} total={c.total_vehicles} />
              <PctCell num={c.has_description} total={c.total_vehicles} />
              <PctCell num={c.has_price} total={c.total_vehicles} />
              <PctCell num={c.sold_count} total={c.total_vehicles} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
