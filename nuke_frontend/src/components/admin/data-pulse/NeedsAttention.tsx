/**
 * NeedsAttention — Actionable priority list for agents
 * Shows platforms ranked by fixable data gaps * vehicle count
 * "What should I work on next?"
 */
import React from 'react';
import type { CSSProperties } from 'react';
import type { CensusRow, VelocityRow } from './useDataPulse';
import { getHealthStatus, HEALTH_COLORS, timeAgo } from './heartbeatConfig';
import type { HealthStatus } from './heartbeatConfig';

const S = {
  section: {
    border: '2px solid #d13438',
    background: '#222',
    padding: '12px',
    marginBottom: '16px',
  } as CSSProperties,
  title: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
    color: '#d13438',
    marginBottom: '8px',
  } as CSSProperties,
  subtitle: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    color: 'var(--text-disabled)',
    marginBottom: '10px',
  } as CSSProperties,
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 0',
    borderBottom: '1px solid #2a2a2a',
    fontSize: '10px',
    fontFamily: 'Arial, sans-serif',
  } as CSSProperties,
  rank: {
    fontFamily: '"Courier New", monospace',
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    width: '18px',
    textAlign: 'right' as const,
    flexShrink: 0,
  } as CSSProperties,
  dot: (status: HealthStatus) => ({
    display: 'inline-block',
    width: '6px',
    height: '6px',
    background: HEALTH_COLORS[status],
    flexShrink: 0,
  } as CSSProperties),
  name: {
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: 'var(--surface-hover)',
    minWidth: '140px',
    fontSize: '9px',
  } as CSSProperties,
  issue: {
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    color: '#d13438',
    fontWeight: 700,
  } as CSSProperties,
  action: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    color: 'var(--text-disabled)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginLeft: 'auto',
    flexShrink: 0,
  } as CSSProperties,
  allGood: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '10px',
    color: '#16825d',
    textAlign: 'center' as const,
    padding: '12px',
  } as CSSProperties,
};

interface Issue {
  platform: string;
  displayName: string;
  status: HealthStatus;
  issue: string;
  action: string;
  impact: number; // sort weight: vehicles affected
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

interface NeedsAttentionProps {
  census: CensusRow[];
  lastIngested: Record<string, string>;
  velocity: Record<string, VelocityRow>;
}

export const NeedsAttention: React.FC<NeedsAttentionProps> = ({ census, lastIngested, velocity }) => {
  const issues: Issue[] = [];

  for (const c of census) {
    const last = lastIngested[c.canonical_platform] || null;
    const status = getHealthStatus(c.canonical_platform, last);
    const vel = velocity[c.canonical_platform];

    // Stale ingestion (red status)
    if (status === 'red') {
      issues.push({
        platform: c.canonical_platform,
        displayName: c.platform_display_name,
        status,
        issue: `STALE ${last ? timeAgo(last) : 'NEVER'}`,
        action: 'CHECK EXTRACTOR',
        impact: c.total_vehicles,
      });
    }

    // Massive VIN gap (>100 vehicles missing VIN, <50% fill)
    const missingVin = c.total_vehicles - c.has_vin;
    if (missingVin > 100 && (c.has_vin / c.total_vehicles) < 0.5) {
      issues.push({
        platform: c.canonical_platform,
        displayName: c.platform_display_name,
        status: 'yellow',
        issue: `${fmt(missingVin)} MISSING VIN`,
        action: 'RUN VIN DECODER',
        impact: missingVin,
      });
    }

    // Missing descriptions (>100 vehicles, <50% fill)
    const missingDesc = c.total_vehicles - c.has_description;
    if (missingDesc > 100 && (c.has_description / c.total_vehicles) < 0.5) {
      issues.push({
        platform: c.canonical_platform,
        displayName: c.platform_display_name,
        status: 'yellow',
        issue: `${fmt(missingDesc)} MISSING DESC`,
        action: 'RE-EXTRACT SNAPSHOTS',
        impact: missingDesc,
      });
    }

    // Velocity crash (had >10 last week, 0 this week)
    if (vel && vel.last_week > 10 && vel.this_week === 0 && status !== 'red') {
      issues.push({
        platform: c.canonical_platform,
        displayName: c.platform_display_name,
        status: 'yellow',
        issue: `DROPPED TO 0 (WAS ${vel.last_week}/WK)`,
        action: 'CHECK PIPELINE',
        impact: vel.last_week * 52,
      });
    }
  }

  // Sort by impact descending, dedupe by platform (keep highest impact)
  const seen = new Set<string>();
  const sorted = issues
    .sort((a, b) => b.impact - a.impact)
    .filter((i) => {
      const key = `${i.platform}:${i.issue.split(' ')[1] || i.issue}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);

  if (sorted.length === 0) {
    return (
      <div style={S.section}>
        <div style={S.title}>NEEDS ATTENTION</div>
        <div style={S.allGood}>ALL PLATFORMS HEALTHY. NO CRITICAL GAPS.</div>
      </div>
    );
  }

  return (
    <div style={S.section}>
      <div style={S.title}>NEEDS ATTENTION</div>
      <div style={S.subtitle}>TOP ISSUES RANKED BY VEHICLE IMPACT — WORK THESE FIRST</div>
      {sorted.map((issue, i) => (
        <div key={`${issue.platform}-${issue.issue}`} style={S.row}>
          <span style={S.rank}>{i + 1}</span>
          <span style={S.dot(issue.status)} />
          <span style={S.name}>{issue.displayName}</span>
          <span style={S.issue}>{issue.issue}</span>
          <span style={S.action}>{issue.action}</span>
        </div>
      ))}
    </div>
  );
};
