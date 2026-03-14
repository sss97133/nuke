/**
 * MarketSegmentDetail — Segment detail page using the feed system.
 *
 * Loads segment metadata, then renders the full vehicle feed pre-filtered
 * by the segment's criteria (year range, makes, keywords).
 * No debug info, no 50-vehicle cap, proper infinite scroll.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useFeedSearchParams } from '../feed/hooks/useFeedSearchParams';
import { useFeedQuery } from '../feed/hooks/useFeedQuery';
import { AuctionClockProvider } from '../feed/components/AuctionClockProvider';
import { FeedStatsStrip } from '../feed/components/FeedStatsStrip';
import { FeedToolbar } from '../feed/components/FeedToolbar';
import { FeedFilterSidebar } from '../feed/components/FeedFilterSidebar';
import { FeedLayout } from '../feed/components/FeedLayout';
import { FeedSkeleton } from '../feed/components/FeedSkeleton';
import { FeedEmptyState } from '../feed/components/FeedEmptyState';
import { VehicleCard } from '../feed/components/VehicleCard';
import { FeedStatCard } from '../feed/components/FeedStatCard';
import type { FeedVehicle } from '../feed/types/feed';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SegmentMeta {
  segment_id: string;
  slug: string;
  name: string;
  description: string | null;
  year_min: number | null;
  year_max: number | null;
  makes: string[] | null;
  model_keywords: string[] | null;
  vehicle_count: number;
  market_cap_usd: number;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
  fund_symbol: string | null;
}

/* ------------------------------------------------------------------ */
/*  Formatters                                                         */
/* ------------------------------------------------------------------ */

const fmtUSD = (v: number) => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

const fmtCount = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
};

const fmtPct = (v: number | null) => {
  if (v === null || Number.isNaN(v)) return null;
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
};

/* ------------------------------------------------------------------ */
/*  SegmentHeader                                                      */
/* ------------------------------------------------------------------ */

function SegmentHeader({ seg }: { seg: SegmentMeta }) {
  const navigate = useNavigate();
  const pct7 = fmtPct(seg.change_7d_pct);
  const pct30 = fmtPct(seg.change_30d_pct);

  // Build subtitle from criteria
  const parts: string[] = [];
  if (seg.year_min && seg.year_max && seg.year_min === seg.year_max) {
    parts.push(`${seg.year_min}`);
  } else if (seg.year_min || seg.year_max) {
    parts.push(`${seg.year_min ?? '...'}\u2013${seg.year_max ?? '...'}`);
  }
  if (seg.makes?.length) parts.push(seg.makes.join(', '));
  if (seg.model_keywords?.length) parts.push(seg.model_keywords.join(', '));

  return (
    <div style={{ borderBottom: '2px solid var(--border)', padding: '16px', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900 }}>{seg.name}</h1>
            {seg.fund_symbol && (
              <span style={{
                fontFamily: "'Courier New', monospace",
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 6px',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}>
                {seg.fund_symbol}
              </span>
            )}
          </div>
          {seg.description && (
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>{seg.description}</div>
          )}
          {parts.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-disabled)', fontFamily: "'Courier New', monospace" }}>
              {parts.join(' / ')}
            </div>
          )}
        </div>

        <button
          className="button button-secondary"
          onClick={() => navigate('/market/segments')}
          style={{ fontSize: 11, padding: '4px 10px' }}
        >
          ALL SEGMENTS
        </button>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'flex',
        gap: 24,
        marginTop: 12,
        flexWrap: 'wrap',
      }}>
        {[
          { label: 'VEHICLES', value: fmtCount(seg.vehicle_count) },
          { label: 'MARKET CAP', value: fmtUSD(seg.market_cap_usd) },
          ...(pct7 ? [{ label: '7D', value: pct7, color: (seg.change_7d_pct ?? 0) >= 0 ? 'var(--success)' : 'var(--error)' }] : []),
          ...(pct30 ? [{ label: '30D', value: pct30, color: (seg.change_30d_pct ?? 0) >= 0 ? 'var(--success)' : 'var(--error)' }] : []),
        ].map((s) => (
          <div key={s.label}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-disabled)' }}>
              {s.label}
            </div>
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 700, color: (s as any).color ?? 'var(--text)' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function MarketSegmentDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  // Segment metadata
  const [segment, setSegment] = useState<SegmentMeta | null>(null);
  const [segLoading, setSegLoading] = useState(true);

  // Feed state
  const {
    filters,
    sortBy,
    sortDirection,
    searchText,
    viewMode,
    cardsPerRow,
    hasActiveFilters,
    setFilters,
    setSortBy,
    setSortDirection,
    setSearchText,
    setViewMode,
    setCardsPerRow,
    resetAll,
  } = useFeedSearchParams();

  const [fontSize, setFontSize] = useState(10);
  const [filtersCollapsed, setFiltersCollapsed] = useState(() => window.innerWidth < 768);
  const [showScores, setShowScores] = useState(false);

  // Load segment metadata
  useEffect(() => {
    if (!slug) return;
    supabase
      .from('market_segments_index')
      .select('segment_id, slug, name, description, year_min, year_max, makes, model_keywords, vehicle_count, market_cap_usd, change_7d_pct, change_30d_pct, fund_symbol')
      .eq('slug', slug)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSegment({
            segment_id: data.segment_id,
            slug: data.slug,
            name: data.name,
            description: data.description,
            year_min: data.year_min,
            year_max: data.year_max,
            makes: data.makes,
            model_keywords: data.model_keywords,
            vehicle_count: Number(data.vehicle_count || 0),
            market_cap_usd: Number(data.market_cap_usd || 0),
            change_7d_pct: data.change_7d_pct != null ? Number(data.change_7d_pct) : null,
            change_30d_pct: data.change_30d_pct != null ? Number(data.change_30d_pct) : null,
            fund_symbol: data.fund_symbol ?? null,
          });
        }
        setSegLoading(false);
      });
  }, [slug]);

  // Apply segment criteria to feed filters on load
  useEffect(() => {
    if (!segment) return;
    setFilters({
      ...filters,
      yearMin: segment.year_min,
      yearMax: segment.year_max,
      makes: segment.makes ?? [],
    });
  }, [segment?.segment_id]); // only once when segment loads

  // Feed query — default to deal_score for segment pages too
  const effectiveSortBy = sortBy === 'popular' ? 'deal_score' : sortBy;
  const feedQuery = useFeedQuery({ filters, sortBy: effectiveSortBy, sortDirection, searchText });
  const vehicles = useMemo(() => feedQuery.data?.pages.flatMap((p) => p.items) ?? [], [feedQuery.data]);
  const stats = feedQuery.data?.pages[0]?.stats ?? null;

  const renderCard = useCallback(
    (vehicle: FeedVehicle) => (
      <VehicleCard
        key={vehicle.id}
        vehicle={vehicle}
        viewMode={viewMode}
        compact={viewMode === 'grid' && cardsPerRow > 8}
        showScores={showScores}
      />
    ),
    [viewMode, cardsPerRow, showScores],
  );

  const renderStatCard = useCallback(
    (index: number) => <FeedStatCard index={index} stats={stats} vehicleCount={vehicles.length} />,
    [stats, vehicles.length],
  );

  const feedStyle = useMemo(
    () =>
      ({
        '--feed-font-size': `${fontSize}px`,
        '--feed-font-size-sm': `${Math.max(6, fontSize - 2)}px`,
        '--feed-font-size-xs': `${Math.max(6, fontSize - 3)}px`,
        maxWidth: viewMode === 'technical' ? 'none' : '1600px',
        margin: '0 auto',
        minHeight: '100vh',
        fontSize: `${fontSize}px`,
      }) as React.CSSProperties,
    [fontSize, viewMode],
  );

  // Not found
  if (!segLoading && !segment) {
    return (
      <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 12 }}>
        Segment not found.
        <div style={{ marginTop: 10 }}>
          <button className="button button-secondary" onClick={() => navigate('/market/segments')}>
            All Segments
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuctionClockProvider>
      <div className="fullscreen-content" style={feedStyle}>
        {/* Segment header with metadata */}
        {segment && <SegmentHeader seg={segment} />}
        {segLoading && (
          <div style={{ height: 80, background: 'var(--surface)', borderBottom: '2px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        )}

        {/* Feed stats strip */}
        <FeedStatsStrip
          stats={stats}
          isLoading={feedQuery.isLoading}
          searchText={searchText}
          onSearchChange={setSearchText}
          resultCount={vehicles.length}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={resetAll}
        />

        {/* Toolbar */}
        <FeedToolbar
          sort={effectiveSortBy}
          direction={sortDirection}
          viewMode={viewMode}
          cardsPerRow={cardsPerRow}
          fontSize={fontSize}
          showScores={showScores}
          onSortChange={setSortBy}
          onDirectionChange={setSortDirection}
          onViewModeChange={setViewMode}
          onCardsPerRowChange={setCardsPerRow}
          onFontSizeChange={setFontSize}
          onToggleScores={() => setShowScores(!showScores)}
        />

        {/* Sidebar + Grid */}
        <div style={{ display: 'flex', minHeight: 'calc(100vh - 72px)' }}>
          <FeedFilterSidebar
            filters={filters}
            onFiltersChange={setFilters}
            onResetAll={resetAll}
            hasActiveFilters={hasActiveFilters}
            collapsed={filtersCollapsed}
            onToggleCollapsed={() => setFiltersCollapsed(!filtersCollapsed)}
          />

          <div style={{ flex: 1, minWidth: 0, padding: viewMode === 'grid' ? '4px' : '0' }}>
            {feedQuery.isLoading ? (
              <FeedSkeleton cardsPerRow={cardsPerRow} rows={4} />
            ) : vehicles.length === 0 ? (
              <FeedEmptyState hasFilters={hasActiveFilters} onResetFilters={resetAll} />
            ) : (
              <FeedLayout
                vehicles={vehicles}
                viewMode={viewMode}
                cardsPerRow={cardsPerRow}
                showScores={showScores}
                hasNextPage={feedQuery.hasNextPage ?? false}
                isFetchingNextPage={feedQuery.isFetchingNextPage}
                fetchNextPage={() => feedQuery.fetchNextPage()}
                renderCard={renderCard}
                renderStatCard={renderStatCard}
                statCardInterval={5}
              />
            )}
          </div>
        </div>
      </div>
    </AuctionClockProvider>
  );
}
