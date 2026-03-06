/**
 * FeedPage — New composable feed page.
 *
 * Replaces CursorHomepage with URL-driven state, React Query fetching,
 * virtualized rendering, and atomic cards.
 */

import { useCallback, useMemo, useState } from 'react';
import { useFeedSearchParams } from '../hooks/useFeedSearchParams';
import { useFeedQuery } from '../hooks/useFeedQuery';
import { AuctionClockProvider } from './AuctionClockProvider';
import { FeedStatsStrip } from './FeedStatsStrip';
import { FeedToolbar } from './FeedToolbar';
import { FeedFilterSidebar } from './FeedFilterSidebar';
import { FeedLayout } from './FeedLayout';
import { FeedSkeleton } from './FeedSkeleton';
import { FeedEmptyState } from './FeedEmptyState';
import { VehicleCard } from './VehicleCard';
import type { FeedVehicle } from '../types/feed';

export default function FeedPage() {
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
    setViewMode,
    setCardsPerRow,
    resetAll,
  } = useFeedSearchParams();

  // Local display settings (not URL-persisted)
  const [fontSize, setFontSize] = useState(10);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [showScores, setShowScores] = useState(false);

  const feedQuery = useFeedQuery({ filters, sortBy, sortDirection, searchText });

  const vehicles = useMemo(
    () => feedQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [feedQuery.data],
  );

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

  // CSS custom property for font size control
  const feedStyle = useMemo(() => ({
    '--feed-font-size': `${fontSize}px`,
    '--feed-font-size-sm': `${Math.max(6, fontSize - 2)}px`,
    '--feed-font-size-xs': `${Math.max(6, fontSize - 3)}px`,
    maxWidth: viewMode === 'technical' ? 'none' : '1600px',
    margin: '0 auto',
    minHeight: '100vh',
    fontSize: `${fontSize}px`,
  } as React.CSSProperties), [fontSize, viewMode]);

  return (
    <AuctionClockProvider>
      <div className="fullscreen-content" style={feedStyle}>
        {/* Stats strip — full width */}
        <FeedStatsStrip stats={stats} isLoading={feedQuery.isLoading} />

        {/* Toolbar — full width */}
        <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FeedToolbar
            sort={sortBy}
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
        </div>

        {/* Active filter indicator */}
        {hasActiveFilters && (
          <div style={{
            padding: '3px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <span style={{
              fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
              textTransform: 'uppercase', color: 'var(--text-disabled)',
            }}>
              SHOWING {vehicles.length.toLocaleString()} RESULTS
            </span>
            <button
              type="button"
              onClick={resetAll}
              style={{
                fontFamily: 'Arial, sans-serif', fontSize: '7px', fontWeight: 700,
                textTransform: 'uppercase', padding: '1px 4px',
                border: '1px solid #ef4444', background: 'transparent',
                color: '#ef4444', cursor: 'pointer',
              }}
            >
              CLEAR ALL
            </button>
          </div>
        )}

        {/* Sidebar + Content */}
        <div style={{ display: 'flex', minHeight: 'calc(100vh - 72px)' }}>
          {/* Filter sidebar */}
          <FeedFilterSidebar
            filters={filters}
            onFiltersChange={setFilters}
            onResetAll={resetAll}
            hasActiveFilters={hasActiveFilters}
            collapsed={filtersCollapsed}
            onToggleCollapsed={() => setFiltersCollapsed(!filtersCollapsed)}
          />

          {/* Main content */}
          <div style={{ flex: 1, minWidth: 0, padding: viewMode === 'grid' ? '4px' : '0' }}>
            {feedQuery.isLoading ? (
              <FeedSkeleton cardsPerRow={cardsPerRow} rows={4} />
            ) : vehicles.length === 0 ? (
              <FeedEmptyState
                hasFilters={hasActiveFilters}
                onResetFilters={resetAll}
              />
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
              />
            )}
          </div>
        </div>
      </div>
    </AuctionClockProvider>
  );
}
