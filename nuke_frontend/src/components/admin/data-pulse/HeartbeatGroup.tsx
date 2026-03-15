/**
 * HeartbeatGroup — Collapsible section of platform cards grouped by heartbeat type
 */
import React, { useState } from 'react';
import type { CSSProperties } from 'react';
import { PlatformCard } from './PlatformCard';
import type { CensusRow, TimeSeriesRow, VelocityRow } from './useDataPulse';
import type { HeartbeatType } from './heartbeatConfig';
import { getHeartbeatLabel } from './heartbeatConfig';

const S = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    padding: '8px 0',
    borderBottom: '1px solid #333',
    marginBottom: '8px',
    userSelect: 'none' as const,
  } as CSSProperties,
  title: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
    color: '#888',
  } as CSSProperties,
  count: {
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    fontWeight: 700,
    color: '#666',
  } as CSSProperties,
  chevron: {
    fontFamily: '"Courier New", monospace',
    fontSize: '10px',
    color: '#666',
    width: '12px',
  } as CSSProperties,
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
    gap: '8px',
    marginBottom: '16px',
  } as CSSProperties,
};

interface HeartbeatGroupProps {
  type: HeartbeatType;
  platforms: CensusRow[];
  timeSeries: TimeSeriesRow[];
  lastIngested: Record<string, string>;
  velocity: Record<string, VelocityRow>;
}

export const HeartbeatGroup: React.FC<HeartbeatGroupProps> = ({
  type,
  platforms,
  timeSeries,
  lastIngested,
  velocity,
}) => {
  const [expanded, setExpanded] = useState(true);

  if (platforms.length === 0) return null;

  const totalVehicles = platforms.reduce((a, p) => a + p.total_vehicles, 0);

  return (
    <div>
      <div style={S.header} onClick={() => setExpanded(!expanded)}>
        <span style={S.chevron}>{expanded ? '▼' : '▶'}</span>
        <span style={S.title}>{getHeartbeatLabel(type)}</span>
        <span style={S.count}>
          {platforms.length} PLATFORMS · {totalVehicles.toLocaleString()} VEHICLES
        </span>
      </div>
      {expanded && (
        <div style={S.grid}>
          {platforms
            .sort((a, b) => b.total_vehicles - a.total_vehicles)
            .map((census) => (
              <PlatformCard
                key={census.canonical_platform}
                census={census}
                timeSeries={timeSeries.filter(
                  (t) => t.canonical_platform === census.canonical_platform
                )}
                lastIngested={lastIngested[census.canonical_platform] || null}
                velocity={velocity[census.canonical_platform] || null}
              />
            ))}
        </div>
      )}
    </div>
  );
};
