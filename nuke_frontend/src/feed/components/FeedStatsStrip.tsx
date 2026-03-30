/**
 * FeedStatsStrip — Sticky stats bar above the feed.
 *
 * Shows SHOWING (filtered/total), VALUE (of filtered set),
 * plus for-sale count and live auctions. All numbers in Courier New.
 *
 * Stats reflect the FILTERED set, not the global database.
 */

import { useState, type CSSProperties } from 'react';
import type { FeedStats } from '../types/feed';

export interface FilteredStats {
  /** Number of vehicles currently loaded (filtered set) */
  count: number;
  /** Sum of display_price for loaded vehicles */
  totalValue: number;
  /** Number of for-sale vehicles in loaded set */
  forSaleCount: number;
  /** Number with active auction (live bid) in loaded set */
  liveCount: number;
}

export interface FeedStatsStripProps {
  /** Global stats from the server cache (for total vehicle count) */
  stats: FeedStats | null | undefined;
  /** Stats computed from the filtered/loaded vehicle set */
  filteredStats?: FilteredStats | null;
  isLoading?: boolean;
  searchText?: string;
  onSearchChange?: (text: string) => void;
  hasActiveFilters?: boolean;
  onResetFilters?: () => void;
  /** Called when a metric is clicked to apply a filter preset */
  onMetricClick?: (metric: 'vehicles' | 'value' | 'today' | 'for_sale' | 'live') => void;
  /** Currently active metric filter (for highlight state) */
  activeMetric?: string | null;
}

const labelStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
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

function Stat({
  label,
  value,
  color,
  onClick,
  active,
  hoverHint,
}: {
  label: string;
  value: string;
  color?: string;
  onClick?: () => void;
  active?: boolean;
  hoverHint?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const isClickable = !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={hoverHint}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        background: active ? 'var(--surface-hover)' : 'transparent',
        border: active ? '2px solid var(--text)' : '2px solid transparent',
        padding: '2px 6px',
        margin: '-2px 0',
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        borderBottom: hovered && isClickable && !active ? '2px solid var(--text-disabled)' : undefined,
      }}
    >
      <span style={labelStyle}>{label}</span>
      <span style={{ ...valueStyle, color: color ?? 'var(--text)' }}>{value}</span>
    </button>
  );
}

/** Format a number compactly: 1.2B, 345.6M, 12.3K, 1,234 */
function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

/** Format a dollar amount compactly: $1.2B, $345.6M, $12K, $1,234 */
function formatDollarCompact(n: number): string {
  return `$${formatCompact(n)}`;
}

export function FeedStatsStrip({
  stats,
  filteredStats,
  isLoading,
  searchText,
  onSearchChange,
  hasActiveFilters,
  onResetFilters,
  onMetricClick,
  activeMetric,
}: FeedStatsStripProps) {
  if (isLoading || !stats) {
    return (
      <div style={{
        height: '36px',
        borderBottom: '2px solid var(--border)',
        background: 'var(--surface)',
      }} />
    );
  }

  const filtered = filteredStats ?? {
    count: 0,
    totalValue: 0,
    forSaleCount: 0,
    liveCount: 0,
  };

  const isFiltered = hasActiveFilters && filtered.count !== stats.total_vehicles;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 12px',
        height: '36px',
        borderBottom: '2px solid var(--border)',
        background: 'var(--surface)',
        overflowX: 'auto',
      }}
    >
      {/* SHOWING: filtered / total */}
      <Stat
        label="SHOWING"
        value={isFiltered
          ? `${formatCompact(filtered.count)} / ${formatCompact(stats.total_vehicles)}`
          : formatCompact(filtered.count > 0 ? filtered.count : stats.total_vehicles)}
        onClick={() => onMetricClick?.('vehicles')}
        active={activeMetric === 'vehicles'}
        hoverHint="Reset to all vehicles"
      />

      {/* VALUE: filtered set total */}
      <Stat
        label="VALUE"
        value={formatDollarCompact(isFiltered ? filtered.totalValue : stats.total_value)}
        onClick={() => onMetricClick?.('value')}
        active={activeMetric === 'value'}
        hoverHint="Sort by price"
      />

      {/* TODAY */}
      {stats.vehicles_added_today > 0 && (
        <Stat
          label="TODAY"
          value={`+${stats.vehicles_added_today}`}
          color="var(--success)"
          onClick={() => onMetricClick?.('today')}
          active={activeMetric === 'today'}
          hoverHint="Show only vehicles added today"
        />
      )}

      {/* FOR SALE */}
      <Stat
        label="FOR SALE"
        value={formatCompact(isFiltered ? filtered.forSaleCount : stats.for_sale_count)}
        onClick={() => onMetricClick?.('for_sale')}
        active={activeMetric === 'for_sale'}
        hoverHint="Show only for-sale vehicles"
      />

      {/* LIVE auctions */}
      {(isFiltered ? filtered.liveCount : stats.active_auctions) > 0 && (
        <Stat
          label="LIVE"
          value={String(isFiltered ? filtered.liveCount : stats.active_auctions)}
          color="var(--error)"
          onClick={() => onMetricClick?.('live')}
          active={activeMetric === 'live'}
          hoverHint="Show live auctions only"
        />
      )}

      {/* Active filter clear button */}
      {hasActiveFilters && (
        <>
          <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
          <button
            type="button"
            onClick={onResetFilters}
            style={{
              fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 700,
              textTransform: 'uppercase', padding: '1px 4px',
              border: '1px solid var(--error)', background: 'transparent',
              color: 'var(--error)', cursor: 'pointer',
            }}
          >
            CLEAR
          </button>
        </>
      )}

      {/* Inline search -- right-aligned */}
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
              outline: 'none',
            }}
          />
        </div>
      )}
    </div>
  );
}
