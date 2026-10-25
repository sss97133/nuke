/**
 * MarketSegmentDetail — Segment detail page using the feed system.
 *
 * Loads segment metadata, then renders the full vehicle feed pre-filtered
 * by the segment's criteria (year range, makes, keywords).
 * No debug info, no 50-vehicle cap, proper infinite scroll.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../components/PrefetchLink';
import { usePageTitle } from '../hooks/usePageTitle';
import './MarketPages.css';
import { supabase } from '../lib/supabase';
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
}

/* ------------------------------------------------------------------ */
/*  Formatters                                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  SegmentHeader                                                      */
/* ------------------------------------------------------------------ */

function SegmentHeader({ seg }: { seg: SegmentMeta }) {
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
    <div className="market-segment-detail-header" style={{ borderBottom: '2px solid var(--border)', padding: '16px', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 'var(--text-title)', fontWeight: 700 }}>{seg.name}</h1>
          </div>
          {seg.description && (
            <div style={{ marginTop: 4, fontSize: 'var(--text-callout)', color: 'var(--text-secondary)' }}>{seg.description}</div>
          )}
          {parts.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 'var(--text-callout)', color: 'var(--text-secondary)', fontFamily: 'var(--font-family)' }}>
              {parts.join(' / ')}
            </div>
          )}
        </div>

        <Link
          to="/market/segments"
          className="button button-secondary"
          style={{ textDecoration: 'none', color: 'inherit', fontSize: 'var(--text-callout)', padding: '4px 10px' }}
        >
          All segments
        </Link>
      </div>

      <p className="market-page-note">Browse captured vehicles matching this definition. The definition index does not supply a measured vehicle total or market value.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function MarketSegmentDetailPage() {
  const { slug } = useParams();

  // Segment metadata
  const [segment, setSegment] = useState<SegmentMeta | null>(null);
  usePageTitle(segment?.name ?? 'Market segment');
  const [segLoading, setSegLoading] = useState(true);
  const [segError, setSegError] = useState<string | null>(null);

  // Feed state
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

  const [fontSize, setFontSize] = useState(14);
  const [filtersCollapsed, setFiltersCollapsed] = useState(() => window.innerWidth < 768);
  const [showScores, setShowScores] = useState(false);

  const [metadataAttempt, setMetadataAttempt] = useState(0);

  // Load segment metadata
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setSegLoading(true);
    setSegment(null);
    setSegError(null);
    void Promise.resolve(supabase
      .from('market_segments_index')
      .select('segment_id, slug, name, description, year_min, year_max, makes, model_keywords')
      .eq('slug', slug)
      .maybeSingle())
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setSegError('The segment definition could not be read.');
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
          });
        }
        setSegLoading(false);
      }).catch(() => {
        if (!cancelled) { setSegError('The segment definition could not be read.'); setSegLoading(false); }
      });
    return () => { cancelled = true; };
  }, [slug, metadataAttempt]);

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

  // Keep the URL sort and segment membership in the existing feed contract.
  const feedQuery = useFeedQuery({ filters, sortBy, sortDirection, searchText }, !!segment && !segError, segment?.segment_id);
  const vehicles = useMemo(() => feedQuery.data?.pages.flatMap((p) => p.items) ?? [], [feedQuery.data]);

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

  // Not found
  if (!segLoading && !segment) {
    return (
      <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 12 }}>
        <p role={segError ? 'alert' : undefined}>{segError || 'Segment not found.'}</p>
        {segError && <button className="button" onClick={() => setMetadataAttempt(value => value + 1)}>Retry definition</button>}
        <div style={{ marginTop: 10 }}>
          <Link to="/market/segments" className="button button-secondary" style={{ textDecoration: 'none', color: 'inherit' }}>
            All Segments
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AuctionClockProvider>
      <div className="fullscreen-content market-browse-page" style={feedStyle}>
        {/* Segment header with metadata */}
        {segment && <SegmentHeader seg={segment} />}
        {segLoading && (
          <div style={{ height: 80, background: 'var(--surface)', borderBottom: '2px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        )}

        {/* Feed stats strip */}
        <MarketResultsBar
          count={vehicles.length}
          unavailable={feedQuery.isError && vehicles.length === 0}
          hasMore={feedQuery.hasNextPage ?? false}
          isLoading={segLoading || feedQuery.isLoading}
          searchText={searchText}
          onSearchChange={setSearchText}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={resetAll}
        />

        {/* Toolbar */}
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
              />
            )}
          </div>
        </div>
      </div>
    </AuctionClockProvider>
  );
}
