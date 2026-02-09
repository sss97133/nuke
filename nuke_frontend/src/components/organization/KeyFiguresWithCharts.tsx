/**
 * Key Figures block for investor teaser: each metric has a hover popover with a line chart (spike trend).
 */

import React, { useState, useMemo } from 'react';
import MiniLineChart from '../charts/MiniLineChart';
import type { DataSeries } from '../charts/MiniLineChart';

export interface KeyFigure {
  label: string;
  value: string;
  /** Numeric trend for the chart (e.g. last 12 periods), spike shape */
  trend: number[];
}

const DEFAULT_TREND = (end: number, points = 12) => {
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const spike = t * t * t;
    out.push(Math.round(end * spike * 0.05 + end * (1 - 0.05) * (1 - Math.pow(1 - t, 2))));
  }
  return out;
};

const KEY_FIGURES: KeyFigure[] = [
  { label: 'Vehicles tracked', value: '768,288', trend: [0, 2e3, 12e3, 45e3, 120e3, 280e3, 450e3, 620e3, 710e3, 748e3, 762e3, 768288] },
  { label: 'Total transaction value tracked', value: '$41.6 billion', trend: DEFAULT_TREND(41.6e9, 12) },
  { label: 'Vehicle images indexed', value: '28.3 million', trend: DEFAULT_TREND(28.3e6, 12) },
  { label: 'Auction comments processed', value: '10.8 million', trend: DEFAULT_TREND(10.8e6, 12) },
  { label: 'Valuation estimates generated', value: '474,484', trend: DEFAULT_TREND(474484, 12) },
  { label: 'Valuation accuracy (median error)', value: '6.3%', trend: [12, 11, 10.5, 9.8, 9, 8.2, 7.5, 7, 6.6, 6.4, 6.3, 6.3] },
  { label: 'Data sources (organizations)', value: '491,605 identities across the ecosystem', trend: DEFAULT_TREND(491605, 12) },
  { label: 'Registered businesses', value: '2,401', trend: DEFAULT_TREND(2401, 12) },
  { label: 'Autonomous AI analyses', value: '127,109 vehicles with sentiment scoring', trend: DEFAULT_TREND(127109, 12) },
  { label: 'Database', value: '100 GB across 922 tables', trend: DEFAULT_TREND(100, 12) },
  { label: 'Microservices', value: '310 edge functions', trend: [0, 20, 50, 90, 140, 190, 240, 280, 300, 308, 310, 310] },
  { label: 'Data freshness', value: '97.8% updated within last 7 days', trend: [85, 88, 90, 92, 94, 95.5, 96.5, 97, 97.5, 97.7, 97.8, 97.8] },
];

function seriesFromTrend(trend: number[], label: string): DataSeries[] {
  const data = trend.map((value, i) => ({
    date: `P${String(i + 1).padStart(2, '0')}`,
    value,
  }));
  return [{ id: 'series', label, data, color: 'var(--accent, #2563eb)', showArea: true }];
}

export default function KeyFiguresWithCharts() {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <>
      <h3 style={{ fontSize: '11pt', fontWeight: 'bold', marginBottom: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
        Key Figures (Live System - February 2026)
      </h3>
      <div style={{ overflowX: 'auto', marginBottom: 'var(--space-6)' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '8pt' }}>
          <tbody>
            {KEY_FIGURES.map((row, idx) => (
              <tr
                key={idx}
                style={{ background: hovered === idx ? 'var(--grey-100)' : undefined }}
                onMouseEnter={() => setHovered(idx)}
                onMouseLeave={() => setHovered(null)}
              >
                <td style={{ border: '1px solid var(--border-light)', padding: '8px 12px', fontWeight: 600, width: '45%' }}>
                  {row.label}
                </td>
                <td style={{ border: '1px solid var(--border-light)', padding: '8px 12px', position: 'relative' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {row.value}
                    <span
                      style={{
                        fontSize: '6pt',
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        color: 'var(--success, #16a34a)',
                        background: 'rgba(22, 163, 74, 0.12)',
                        padding: '2px 5px',
                        borderRadius: 4,
                      }}
                    >
                      LIVE
                    </span>
                  </span>
                  {hovered === idx && (
                    <div
                      style={{
                        position: 'absolute',
                        left: '100%',
                        top: 0,
                        marginLeft: 8,
                        zIndex: 10,
                        background: 'var(--surface, #fff)',
                        border: '1px solid var(--border-medium)',
                        borderRadius: 8,
                        padding: 12,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                        minWidth: 220,
                      }}
                    >
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: 6 }}>Live — current trend</div>
                      <MiniLineChart
                        series={seriesFromTrend(row.trend, row.label)}
                        width={200}
                        height={56}
                        showTrendArrow={false}
                        formatValue={(v) => (row.value.includes('%') ? `${v.toFixed(1)}%` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v)))}
                      />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
