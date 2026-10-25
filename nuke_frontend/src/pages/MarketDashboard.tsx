/**
 * MarketDashboard — Real vehicle market experience.
 *
 * Composes existing feed primitives (useFeedQuery, FeedLayout, VehicleCard, etc.)
 * into a market-first browse page. No new edge functions or DB tables.
 *
 * Sort follows the URL and the shared feed contract, including Rank versus Deals.
 */

import { useCallback, useMemo, useState } from 'react';
import { PrefetchLink as Link } from '../components/PrefetchLink';
import { useMarketSegments, type SegmentIndexRow } from '../hooks/useMarketSegments';
import { usePageTitle } from '../hooks/usePageTitle';
import './MarketPages.css';
import { useFeedSearchParams } from '../feed/hooks/useFeedSearchParams';
import { useFeedQuery } from '../feed/hooks/useFeedQuery';
import { AuctionClockProvider } from '../feed/components/AuctionClockProvider';
import { MarketResultsBar } from './MarketResultsBar';
import { FeedToolbar } from '../feed/components/FeedToolbar';
import { FeedFilterSidebar } from '../feed/components/FeedFilterSidebar';
import { FeedLayout } from '../feed/components/FeedLayout';
import { FeedSkeleton } from '../feed/components/FeedSkeleton';
import { FeedEmptyState } from '../feed/components/FeedEmptyState';
import { VehicleCard } from '../feed/components/VehicleCard';
import { BrandHeartbeat } from '../feed/components/heartbeat/BrandHeartbeat';
import type { FeedVehicle } from '../feed/types/feed';

// The current index supplies definitions; its count is a placeholder and its
// market_cap_usd is fund AUM. Neither establishes measured vehicle coverage.
function MarketSegmentsStrip({ segments, loading }: { segments: SegmentIndexRow[]; loading: boolean }) {
  if (loading) return <p className="market-page-note" role="status">Loading segment definitions…</p>;
  if (!segments.length) return null;
  return <section className="market-segment-strip" aria-label="Segment definitions">
    {segments.map(segment => <Link key={segment.segment_id} to={`/market/segments/${segment.slug}`} className="market-segment-preview">
      <strong>{segment.name}</strong>
      <span>{segment.description || 'Browse vehicles matching this definition'}</span>
    </Link>)}
    <Link className="market-segment-preview market-segment-more" to="/market/segments">All segment definitions →</Link>
  </section>;
}

/* ------------------------------------------------------------------ */
/*  MarketDashboard — main page                                        */
/* ------------------------------------------------------------------ */

export default function MarketDashboard() {
  usePageTitle('Vehicle market');
  const {
    filters,
    sortBy,
    sortDirection,
    searchText,
    viewMode,
    cardsPerRow,
    imageFit,
    setImageFit,
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
  const [fontSize, setFontSize] = useState(14);
  const [filtersCollapsed, setFiltersCollapsed] = useState(() => window.innerWidth < 768);
  const [showScores, setShowScores] = useState(false);
  const [introVisible, setIntroVisible] = useState(() => !localStorage.getItem('nuke_market_intro_dismissed'));

  // Reuse the segment page's existing reader/cache, displaying only the
  // definition fields that this index actually supports.
  const segmentQuery = useMarketSegments();
  const segments = useMemo(() => [...(segmentQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8), [segmentQuery.data]);

  const feedQuery = useFeedQuery({
    filters,
    sortBy,
    sortDirection,
    searchText,
  });

  const vehicles = useMemo(
    () => feedQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [feedQuery.data],
  );


  // Card renderer
  const renderCard = useCallback(
    (vehicle: FeedVehicle) => (
      <VehicleCard
        key={vehicle.id}
        vehicle={vehicle}
        viewMode={viewMode}
        compact={viewMode === 'grid' && cardsPerRow > 8}
        showScores={showScores}
        imageFit={imageFit === 'auto' ? 'cover' : imageFit}
      />
    ),
    [viewMode, cardsPerRow, showScores, imageFit],
  );

  // Brand heartbeat
  const singleMake = filters.makes.length === 1 ? filters.makes[0] : undefined;
  const singleModel = singleMake && filters.models.length === 1 ? filters.models[0] : undefined;

  const feedStyle = useMemo(
    () =>
      ({
        '--feed-font-size': `${fontSize}px`,
        '--feed-font-size-sm': `${Math.max(10, fontSize - 2)}px`,
        '--feed-font-size-xs': `${Math.max(10, fontSize - 3)}px`,
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

      <div className="fullscreen-content market-browse-page" style={feedStyle}>
        {/* Segments strip */}
        {segmentQuery.error && <div role="alert" className="market-reader-error">
          <span>Segment definitions could not be refreshed. {segments.length > 0 ? 'Showing previous definitions.' : 'Vehicle browsing is still available below.'}</span>
          <button className="button" disabled={segmentQuery.isFetching} onClick={() => void segmentQuery.refetch()}>Retry segments</button>
        </div>}
        <MarketSegmentsStrip segments={segments} loading={segmentQuery.isLoading} />

        {/* First-visit context */}
        {introVisible && (
          <div className="market-intro" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            fontSize: 'var(--text-callout)',
            fontFamily: 'var(--font-family)',
            color: 'var(--text-secondary)',
          }}>
            <span>Captured vehicle records · scope and ordering follow the selected filters</span>
            <button
              type="button"
              aria-label="Dismiss market introduction"
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
                fontFamily: 'var(--font-family)',
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
        <MarketResultsBar
          count={vehicles.length}
          unavailable={feedQuery.isError && vehicles.length === 0}
          hasMore={feedQuery.hasNextPage ?? false}
          isLoading={feedQuery.isLoading}
          searchText={searchText}
          onSearchChange={setSearchText}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={resetAll}
        />

        {/* Toolbar — sort, view mode, density */}
        <FeedToolbar
          sort={sortBy}
          direction={sortDirection}
          viewMode={viewMode}
          cardsPerRow={cardsPerRow}
          fontSize={fontSize}
          showScores={showScores}
          imageFit={imageFit}
          onImageFitChange={setImageFit}
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

            {feedQuery.isError && <div role="alert" className="market-reader-error">
              <span>Vehicle results could not be refreshed. {vehicles.length > 0 ? 'Showing the last successful results.' : 'No result count is available.'}</span>
              <button className="button" disabled={feedQuery.isFetching} onClick={() => void (feedQuery.isFetchNextPageError ? feedQuery.fetchNextPage() : feedQuery.refetch())}>Retry vehicles</button>
            </div>}
            {feedQuery.isLoading ? (
              <FeedSkeleton cardsPerRow={cardsPerRow} rows={4} />
            ) : feedQuery.isError && vehicles.length === 0 ? null : vehicles.length === 0 ? (
              <FeedEmptyState hasFilters={hasActiveFilters} onResetFilters={resetAll} />
            ) : (
              <FeedLayout
                vehicles={vehicles}
                viewMode={viewMode}
                cardsPerRow={cardsPerRow}
                showScores={showScores}
                hasNextPage={!feedQuery.isError && (feedQuery.hasNextPage ?? false)}
                isFetchingNextPage={feedQuery.isFetchingNextPage}
                fetchNextPage={() => feedQuery.fetchNextPage()}
                renderCard={renderCard}
                sort={sortBy}
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
