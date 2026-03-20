/**
 * DataPulse — Platform ingestion telemetry page
 *
 * An agent work queue disguised as a dashboard.
 * Shows what's broken, what to fix, and where the data gaps are.
 */
import React, { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useDataPulse } from '../../components/admin/data-pulse/useDataPulse';
import { CensusSummaryBar } from '../../components/admin/data-pulse/CensusSummaryBar';
import { NeedsAttention } from '../../components/admin/data-pulse/NeedsAttention';
import { HeartbeatGroup } from '../../components/admin/data-pulse/HeartbeatGroup';
import { IngestionTimeline } from '../../components/admin/data-pulse/IngestionTimeline';
import { DataQualityGrid } from '../../components/admin/data-pulse/DataQualityGrid';
import { getHeartbeatType, getHealthStatus, HEALTH_COLORS } from '../../components/admin/data-pulse/heartbeatConfig';
import type { HeartbeatType } from '../../components/admin/data-pulse/heartbeatConfig';

const S = {
  page: {
    fontFamily: 'Arial, sans-serif',
    background: 'var(--text)',
    color: 'var(--surface-hover)',
    minHeight: '100vh',
    padding: '16px 20px',
  } as CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    borderBottom: '2px solid #333',
    paddingBottom: '8px',
  } as CSSProperties,
  title: {
    fontSize: '14px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
  } as CSSProperties,
  subtitle: {
    fontSize: '9px',
    color: 'var(--text-disabled)',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  } as CSSProperties,
  meta: {
    fontSize: '9px',
    color: 'var(--text-disabled)',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  } as CSSProperties,
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '50vh',
    fontSize: '9px',
    color: 'var(--text-disabled)',
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
  } as CSSProperties,
  legend: {
    display: 'flex',
    gap: '16px',
    marginBottom: '16px',
    flexWrap: 'wrap' as const,
  } as CSSProperties,
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: 'var(--text-disabled)',
  } as CSSProperties,
  dot: (color: string) => ({
    display: 'inline-block',
    width: '6px',
    height: '6px',
    background: color,
  } as CSSProperties),
};

const HEARTBEAT_ORDER: HeartbeatType[] = [
  'continuous_auction',
  'event_auction',
  'marketplace',
  'dealer_other',
];

const DataPulse: React.FC = () => {
  const { data, error, loading, lastFetch } = useDataPulse();

  const grouped = useMemo(() => {
    if (!data) return null;
    const groups: Record<HeartbeatType, typeof data.census> = {
      event_auction: [],
      continuous_auction: [],
      marketplace: [],
      dealer_other: [],
    };
    for (const c of data.census) {
      const type = getHeartbeatType(c.canonical_platform);
      groups[type].push(c);
    }
    return groups;
  }, [data]);

  const activePlatforms = useMemo(() => {
    if (!data) return 0;
    return data.census.filter((c) => {
      const last = data.last_ingested[c.canonical_platform];
      const status = getHealthStatus(c.canonical_platform, last || null);
      return status === 'green' || status === 'yellow';
    }).length;
  }, [data]);

  if (loading && !data) {
    return <div style={{ ...S.page, ...S.loading }}>LOADING DATA PULSE...</div>;
  }

  if (error && !data) {
    return (
      <div style={{ ...S.page, ...S.loading, color: '#d13438' }}>
        ERROR: {error}
      </div>
    );
  }

  if (!data || !grouped) return null;

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.title}>DATA PULSE</div>
          <div style={S.subtitle}>PLATFORM INGESTION TELEMETRY</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={S.meta}>
            REFRESHES EVERY 60S
            {lastFetch && ` · LAST: ${lastFetch.toLocaleTimeString()}`}
          </div>
        </div>
      </div>

      {/* Health Legend */}
      <div style={S.legend}>
        <div style={S.legendItem}><span style={S.dot(HEALTH_COLORS.green)} /> ON SCHEDULE</div>
        <div style={S.legendItem}><span style={S.dot(HEALTH_COLORS.yellow)} /> BEHIND CADENCE</div>
        <div style={S.legendItem}><span style={S.dot(HEALTH_COLORS.red)} /> LIKELY BROKEN</div>
        <div style={S.legendItem}><span style={S.dot(HEALTH_COLORS.gray)} /> DORMANT</div>
      </div>

      {/* Summary Bar */}
      <CensusSummaryBar totals={data.totals} activePlatforms={activePlatforms} />

      {/* NEEDS ATTENTION — the agent work queue */}
      <div style={{ marginTop: '16px' }}>
        <NeedsAttention
          census={data.census}
          lastIngested={data.last_ingested || {}}
          velocity={data.velocity || {}}
        />
      </div>

      {/* Heartbeat Groups */}
      <div>
        {HEARTBEAT_ORDER.map((type) => (
          <HeartbeatGroup
            key={type}
            type={type}
            platforms={grouped[type]}
            timeSeries={data.time_series || []}
            lastIngested={data.last_ingested || {}}
            velocity={data.velocity || {}}
          />
        ))}
      </div>

      {/* Ingestion Timeline */}
      <div style={{ marginTop: '16px' }}>
        <IngestionTimeline timeSeries={data.time_series || []} />
      </div>

      {/* Data Quality Grid */}
      <div style={{ marginTop: '16px' }}>
        <DataQualityGrid census={data.census} />
      </div>

      {/* Footer */}
      <div style={{ ...S.meta, marginTop: '12px', textAlign: 'center' }}>
        DATA FROM data_pulse() RPC · MV_VEHICLE_CENSUS MATERIALIZED VIEW
        {error && <span style={{ color: '#d13438' }}> · LAST REFRESH ERROR: {error}</span>}
      </div>
    </div>
  );
};

export default DataPulse;
