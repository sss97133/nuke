/**
 * PlatformCard — Individual platform health card with sparkline + data grades
 */
import React, { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { MiniLineChart } from '../../charts/MiniLineChart';
import type { CensusRow, TimeSeriesRow } from './useDataPulse';
import {
  getHeartbeatType, getHeartbeatLabel, getHealthStatus, getDataGrade,
  HEALTH_COLORS, timeAgo,
} from './heartbeatConfig';
import type { HealthStatus } from './heartbeatConfig';

const S = {
  card: {
    border: '2px solid #333',
    background: '#222',
    padding: '10px 12px',
    minWidth: '280px',
  } as CSSProperties,
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '2px',
  } as CSSProperties,
  platformName: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    color: '#e0e0e0',
  } as CSSProperties,
  typeLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    color: '#666',
    marginBottom: '8px',
  } as CSSProperties,
  metricsRow: {
    display: 'flex',
    gap: '16px',
    marginBottom: '6px',
  } as CSSProperties,
  metricLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '7px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#888',
    marginTop: '2px',
  } as CSSProperties,
  metricValue: {
    fontFamily: '"Courier New", monospace',
    fontSize: '13px',
    fontWeight: 700,
    color: '#e0e0e0',
    lineHeight: 1,
  } as CSSProperties,
  fillRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginTop: '6px',
  } as CSSProperties,
  fillLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#888',
  } as CSSProperties,
  lastSeen: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#666',
    marginTop: '6px',
  } as CSSProperties,
  dot: (status: HealthStatus) => ({
    display: 'inline-block',
    width: '8px',
    height: '8px',
    background: HEALTH_COLORS[status],
    marginRight: '6px',
    flexShrink: 0,
  } as CSSProperties),
  gradeBadge: (grade: string) => ({
    fontFamily: '"Courier New", monospace',
    fontSize: '11px',
    fontWeight: 700,
    padding: '1px 5px',
    border: `1px solid ${grade === 'A' ? '#16825d' : grade === 'B' ? '#4a9eff' : grade === 'C' ? '#b05a00' : '#d13438'}`,
    color: grade === 'A' ? '#16825d' : grade === 'B' ? '#4a9eff' : grade === 'C' ? '#b05a00' : '#d13438',
  } as CSSProperties),
  trustBadge: {
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    fontWeight: 700,
    color: '#888',
  } as CSSProperties,
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function fmtPrice(n: number | null): string {
  if (n == null || n === 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fillPct(num: number, total: number): number {
  return total > 0 ? Math.round((num / total) * 100) : 0;
}

function fillColor(pct: number): string {
  if (pct >= 80) return '#16825d';
  if (pct >= 50) return '#b05a00';
  return '#d13438';
}

interface PlatformCardProps {
  census: CensusRow;
  timeSeries: TimeSeriesRow[];
  lastIngested: string | null;
}

export const PlatformCard: React.FC<PlatformCardProps> = ({ census, timeSeries, lastIngested }) => {
  const platform = census.canonical_platform;
  const status = getHealthStatus(platform, lastIngested);
  const heartbeat = getHeartbeatType(platform);

  const vinPct = fillPct(census.has_vin, census.total_vehicles);
  const descPct = fillPct(census.has_description, census.total_vehicles);
  const pricePct = fillPct(census.has_price, census.total_vehicles);
  const grade = getDataGrade({ vin: vinPct, desc: descPct, price: pricePct });

  const sparkData = useMemo(() => {
    if (!timeSeries.length) return [];
    return [{
      id: platform,
      label: platform,
      data: timeSeries.map(t => ({ date: t.day, value: t.cnt })),
      color: '#4a9eff',
    }];
  }, [timeSeries, platform]);

  return (
    <div style={S.card}>
      {/* Header */}
      <div style={S.headerRow}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={S.dot(status)} />
          <span style={S.platformName}>{census.platform_display_name}</span>
        </div>
        <span style={S.trustBadge}>
          TRUST {Math.round((vinPct + descPct + pricePct) / 3)}
        </span>
      </div>
      <div style={S.typeLabel}>{getHeartbeatLabel(heartbeat)}</div>

      {/* Big metrics */}
      <div style={S.metricsRow}>
        <div>
          <div style={S.metricValue}>{fmt(census.total_vehicles)}</div>
          <div style={S.metricLabel}>TOTAL</div>
        </div>
        <div>
          <div style={S.metricValue}>{fmt(census.sold_count)}</div>
          <div style={S.metricLabel}>SOLD</div>
        </div>
        <div>
          <div style={S.metricValue}>{fmtPrice(census.median_sold_price)}</div>
          <div style={S.metricLabel}>MEDIAN</div>
        </div>
      </div>

      {/* Sparkline */}
      {sparkData.length > 0 && sparkData[0].data.length > 1 && (
        <MiniLineChart
          series={sparkData}
          width={260}
          height={32}
          showTrendArrow={false}
          showLegend={false}
          formatValue={(v) => String(v)}
          style={{ margin: '4px 0' }}
        />
      )}

      {/* Fill rates + grade */}
      <div style={S.fillRow}>
        <span style={{ ...S.fillLabel, color: fillColor(vinPct) }}>VIN {vinPct}%</span>
        <span style={{ ...S.fillLabel, color: fillColor(descPct) }}>DESC {descPct}%</span>
        <span style={{ ...S.fillLabel, color: fillColor(pricePct) }}>PRICE {pricePct}%</span>
        <span style={{ marginLeft: 'auto' }}>
          <span style={S.gradeBadge(grade)}>{grade}</span>
        </span>
      </div>

      {/* Last seen */}
      <div style={S.lastSeen}>
        LAST: {lastIngested ? timeAgo(lastIngested) : 'NEVER'}
      </div>
    </div>
  );
};
