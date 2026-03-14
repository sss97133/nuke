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
import { BrandHeartbeat } from './heartbeat/BrandHeartbeat';
import { FeedStatCard } from './FeedStatCard';
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
    setSearchText,
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

  // Brand heartbeat: show when exactly one make is selected
  const singleMake = filters.makes.length === 1 ? filters.makes[0] : undefined;
  const singleModel = singleMake && filters.models.length === 1 ? filters.models[0] : undefined;

  // Stat card renderer for FeedLayout
  const renderStatCard = useCallback(
    (index: number) => (
      <FeedStatCard index={index} stats={stats} vehicleCount={vehicles.length} />
    ),
    [stats, vehicles.length],
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
        {/* Stats strip — full width, includes inline search + filter result count */}
        <FeedStatsStrip
          stats={stats}
          isLoading={feedQuery.isLoading}
          searchText={searchText}
          onSearchChange={setSearchText}
          resultCount={vehicles.length}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={resetAll}
        />

        {/* Toolbar — full width */}
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
            {/* Brand heartbeat — shown when filtering by a single make */}
            {singleMake && !feedQuery.isLoading && (
              <BrandHeartbeat make={singleMake} model={singleModel} />
            )}

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
