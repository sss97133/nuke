/**
 * PlatformCard — Individual platform health card
 * Shows what's working, what's broken, and what to fix
 */
import React, { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { MiniLineChart } from '../../charts/MiniLineChart';
import type { CensusRow, TimeSeriesRow, VelocityRow } from './useDataPulse';
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
    color: 'var(--surface-hover)',
  } as CSSProperties,
  typeLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    color: 'var(--text-secondary)',
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
    color: 'var(--text-disabled)',
    marginTop: '2px',
  } as CSSProperties,
  metricValue: {
    fontFamily: '"Courier New", monospace',
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--surface-hover)',
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
    color: 'var(--text-disabled)',
  } as CSSProperties,
  gapRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginTop: '4px',
    flexWrap: 'wrap' as const,
  } as CSSProperties,
  gapBadge: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '7px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
    padding: '1px 4px',
    border: '1px solid #d13438',
    color: '#d13438',
  } as CSSProperties,
  lastSeen: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: 'var(--text-secondary)',
    marginTop: '6px',
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
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
  velocityBadge: (dir: 'up' | 'down' | 'flat') => ({
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    fontWeight: 700,
    color: dir === 'up' ? '#16825d' : dir === 'down' ? '#d13438' : 'var(--text-secondary)',
  } as CSSProperties),
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
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
  velocity: VelocityRow | null;
}

export const PlatformCard: React.FC<PlatformCardProps> = ({ census, timeSeries, lastIngested, velocity }) => {
  const platform = census.canonical_platform;
  const status = getHealthStatus(platform, lastIngested);
  const heartbeat = getHeartbeatType(platform);

  const vinPct = fillPct(census.has_vin, census.total_vehicles);
  const descPct = fillPct(census.has_description, census.total_vehicles);
  const pricePct = fillPct(census.has_price, census.total_vehicles);
  const grade = getDataGrade({ vin: vinPct, desc: descPct, price: pricePct });

  // Compute missing counts (absolute, not %)
  const missingVin = census.total_vehicles - census.has_vin;
  const missingDesc = census.total_vehicles - census.has_description;
  const missingPrice = census.sold_count - census.has_price;

  // Velocity direction
  const velDir = velocity
    ? velocity.this_week > velocity.last_week ? 'up' as const
    : velocity.this_week < velocity.last_week ? 'down' as const
    : 'flat' as const
    : 'flat' as const;
  const velArrow = velDir === 'up' ? '\u2191' : velDir === 'down' ? '\u2193' : '';

  // Identify biggest gaps for actionable badges
  const gaps: string[] = [];
  if (vinPct < 50 && missingVin > 10) gaps.push(`${fmt(missingVin)} NO VIN`);
  if (descPct < 50 && missingDesc > 10) gaps.push(`${fmt(missingDesc)} NO DESC`);
  if (pricePct < 80 && missingPrice > 10) gaps.push(`${fmt(missingPrice)} NO PRICE`);
  if (status === 'red') gaps.push('STALE');

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
        <span style={S.gradeBadge(grade)}>{grade}</span>
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
        {velocity && velocity.this_week > 0 && (
          <div>
            <div style={{ ...S.metricValue, color: '#16825d' }}>+{velocity.this_week}</div>
            <div style={S.metricLabel}>THIS WEEK</div>
          </div>
        )}
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

      {/* Fill rates */}
      <div style={S.fillRow}>
        <span style={{ ...S.fillLabel, color: fillColor(vinPct) }}>VIN {vinPct}%</span>
        <span style={{ ...S.fillLabel, color: fillColor(descPct) }}>DESC {descPct}%</span>
        <span style={{ ...S.fillLabel, color: fillColor(pricePct) }}>PRICE {pricePct}%</span>
        {velocity && velArrow && (
          <span style={{ ...S.velocityBadge(velDir), marginLeft: 'auto' }}>
            {velArrow}{velocity.this_week}
          </span>
        )}
      </div>

      {/* Actionable gaps */}
      {gaps.length > 0 && (
        <div style={S.gapRow}>
          {gaps.map((g) => (
            <span key={g} style={S.gapBadge}>{g}</span>
          ))}
        </div>
      )}

      {/* Last seen */}
      <div style={S.lastSeen}>
        <span>LAST: {lastIngested ? timeAgo(lastIngested) : 'NEVER'}</span>
      </div>
    </div>
  );
};
