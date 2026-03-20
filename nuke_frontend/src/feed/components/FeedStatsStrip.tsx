/**
 * FeedStatsStrip — Sticky stats bar above the feed.
 *
 * Shows total vehicles, total value, for-sale count, active auctions,
 * deals count, and today's additions. Courier New for numbers.
 */

import type { CSSProperties } from 'react';
import type { FeedStats } from '../types/feed';

export interface FeedStatsStripProps {
  stats: FeedStats | null | undefined;
  isLoading?: boolean;
  searchText?: string;
  onSearchChange?: (text: string) => void;
  resultCount?: number;
  hasActiveFilters?: boolean;
  onResetFilters?: () => void;
}

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
  fontSize: '10px',
  fontWeight: 700,
  color: 'var(--text)',
  lineHeight: 1,
};

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ ...valueStyle, color: color ?? 'var(--text)' }}>{value}</span>
    </div>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

export function FeedStatsStrip({ stats, isLoading, searchText, onSearchChange, resultCount, hasActiveFilters, onResetFilters }: FeedStatsStripProps) {
  if (isLoading || !stats) {
    return (
      <div style={{
        height: '32px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }} />
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '0 12px',
        height: '32px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        overflowX: 'auto',
      }}
    >
      <Stat label="VEHICLES" value={formatCompact(stats.total_vehicles)} />
      <Stat label="VALUE" value={`$${formatCompact(stats.total_value)}`} />
      {stats.vehicles_added_today > 0 && (
        <Stat
          label="TODAY"
          value={`+${stats.vehicles_added_today}`}
          color="var(--success)"
        />
      )}
      <Stat label="FOR SALE" value={formatCompact(stats.for_sale_count)} />
      {stats.active_auctions > 0 && (
        <Stat label="LIVE" value={String(stats.active_auctions)} color="var(--error)" />
      )}

      {/* Filter result count + clear */}
      {hasActiveFilters && resultCount != null && (
        <>
          <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
          <span style={{
            fontFamily: "'Courier New', monospace",
            fontSize: '9px',
            fontWeight: 700,
            color: 'var(--text)',
          }}>
            {resultCount.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={onResetFilters}
            style={{
              fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 700,
              textTransform: 'uppercase', padding: '1px 4px',
              border: '1px solid var(--error)', background: 'transparent',
              color: 'var(--error)', cursor: 'pointer', }}
          >
            CLEAR
          </button>
        </>
      )}

      {/* Inline search — right-aligned */}
      {onSearchChange && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <input
            type="text"
            value={searchText ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="SEARCH"
            aria-label="Search vehicles"
            style={{
              fontFamily: "'Courier New', monospace",
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              padding: '2px 6px',
              height: '20px',
              width: '120px',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              outline: 'none', }}
          />
        </div>
      )}
    </div>
  );
}
