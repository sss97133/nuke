/**
 * MarketDashboard — Real vehicle market experience.
 *
 * Composes existing feed primitives (useFeedQuery, FeedLayout, VehicleCard, etc.)
 * into a market-first browse page. No new edge functions or DB tables.
 *
 * Default sort: deal_score (surfaces best deals first).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { BrandHeartbeat } from '../feed/components/heartbeat/BrandHeartbeat';
import { FeedStatCard } from '../feed/components/FeedStatCard';
import type { FeedVehicle } from '../feed/types/feed';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MarketSegment {
  segment_id: string;
  slug: string;
  name: string;
  vehicle_count: number;
  market_cap_usd: number | null;
  change_7d_pct: number | null;
  fund_symbol: string | null;
}

/* ------------------------------------------------------------------ */
/*  Formatters                                                         */
/* ------------------------------------------------------------------ */

const fmtLargeUSD = (v: number) => {
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
/*  MarketSegmentsStrip — horizontal segment cards                     */
/* ------------------------------------------------------------------ */

function MarketSegmentsStrip({ segments, loading }: { segments: MarketSegment[]; loading: boolean }) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div style={{ display: 'flex', gap: 8, padding: '8px 16px', overflowX: 'auto' }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              minWidth: 180,
              height: 64,
              border: '2px solid var(--border)',
              padding: '10px 14px',
              background: 'var(--surface)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        ))}
      </div>
    );
  }

  if (segments.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '8px 16px',
        overflowX: 'auto',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {segments.map((seg) => {
        const pct = fmtPct(seg.change_7d_pct);
        const isUp = (seg.change_7d_pct ?? 0) > 0;
        const isDown = (seg.change_7d_pct ?? 0) < 0;
        return (
          <button
            key={seg.segment_id}
            onClick={() => navigate(`/market/segments/${seg.slug}`)}
            style={{
              minWidth: 180,
              border: '2px solid var(--border)',
              padding: '10px 14px',
              background: 'var(--surface)',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 900 }}>
                {seg.fund_symbol ?? seg.slug.toUpperCase()}
              </span>
              {pct && (
                <span
                  style={{
                    fontFamily: "'Courier New', monospace",
                    fontSize: 10,
                    fontWeight: 700,
                    color: isUp ? 'var(--success)' : isDown ? 'var(--error)' : 'var(--text)',
                  }}
                >
                  {pct}
                </span>
              )}
            </div>
            <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 9, color: 'var(--text-secondary)' }}>
              {seg.name}
            </span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: 'var(--text-secondary)' }}>
                {fmtCount(seg.vehicle_count)} vehicles
              </span>
              {seg.market_cap_usd != null && (
                <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10 }}>
                  {fmtLargeUSD(seg.market_cap_usd)}
                </span>
              )}
            </div>
          </button>
        );
      })}

      {/* View All card */}
      <button
        onClick={() => navigate('/market/segments')}
        style={{
          minWidth: 120,
          border: '2px dashed var(--border)',
          padding: '10px 14px',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontFamily: 'Arial, sans-serif',
          fontSize: 9,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-secondary)',
        }}
      >
        VIEW ALL &rarr;
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MarketDashboard — main page                                        */
/* ------------------------------------------------------------------ */

export default function MarketDashboard() {
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

  // Local display state
  const [fontSize, setFontSize] = useState(12);
  const [filtersCollapsed, setFiltersCollapsed] = useState(() => window.innerWidth < 768);
  const [showScores, setShowScores] = useState(false);
  const [introVisible, setIntroVisible] = useState(() => !localStorage.getItem('nuke_market_intro_dismissed'));

  // Segments (direct supabase query, no edge function)
  const [segments, setSegments] = useState<MarketSegment[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('market_segments_index')
      .select('segment_id, slug, name, vehicle_count, market_cap_usd, change_7d_pct, fund_symbol')
      .order('market_cap_usd', { ascending: false, nullsFirst: false })
      .limit(8)
      .then(({ data }) => {
        setSegments((data ?? []).filter(s => Number(s.vehicle_count || 0) > 0));
        setSegmentsLoading(false);
      });
  }, []);

  // Feed query — default sort is deal_score for market page
  const effectiveSortBy = sortBy === 'popular' ? 'deal_score' : sortBy;
  const feedQuery = useFeedQuery({
    filters,
    sortBy: effectiveSortBy,
    sortDirection,
    searchText,
  });

  const vehicles = useMemo(
    () => feedQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [feedQuery.data],
  );

  const stats = feedQuery.data?.pages[0]?.stats ?? null;

  // Card renderer
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

  // Brand heartbeat
  const singleMake = filters.makes.length === 1 ? filters.makes[0] : undefined;
  const singleModel = singleMake && filters.models.length === 1 ? filters.models[0] : undefined;

  // Stat card renderer
  const renderStatCard = useCallback(
    (index: number) => <FeedStatCard index={index} stats={stats} vehicleCount={vehicles.length} />,
    [stats, vehicles.length],
  );

  // CSS custom property for font size
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

  return (
    <AuctionClockProvider>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>

      <div className="fullscreen-content" style={feedStyle}>
        {/* Segments strip */}
        <MarketSegmentsStrip segments={segments} loading={segmentsLoading} />

        {/* First-visit context */}
        {introVisible && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            fontSize: 10,
            fontFamily: "'Courier New', monospace",
            color: 'var(--text-secondary)',
          }}>
            <span>NUKE MARKET — 590K+ collector vehicles across 15 auction sources. Sorted by deal_score.</span>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem('nuke_market_intro_dismissed', '1');
                setIntroVisible(false);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-disabled)',
                cursor: 'pointer',
                fontSize: 10,
                fontFamily: 'Arial, sans-serif',
                fontWeight: 700,
                padding: '2px 4px',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Feed stats strip — sticky search + result count */}
        <FeedStatsStrip
          stats={stats}
          isLoading={feedQuery.isLoading}
          searchText={searchText}
          onSearchChange={setSearchText}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={resetAll}
        />

        {/* Toolbar — sort, view mode, density */}
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
            {singleMake && !feedQuery.isLoading && (
              <BrandHeartbeat make={singleMake} model={singleModel} />
            )}

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
                sort={effectiveSortBy}
                sortDirection={sortDirection}
                onSortChange={setSortBy}
                onDirectionChange={setSortDirection}
              />
            )}
          </div>
        </div>
      </div>
    </AuctionClockProvider>
  );
}
