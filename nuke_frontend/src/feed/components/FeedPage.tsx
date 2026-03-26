/**
 * FeedPage — New composable feed page.
 *
 * Replaces CursorHomepage with URL-driven state, React Query fetching,
 * virtualized rendering, and atomic cards.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFeedSearchParams } from '../hooks/useFeedSearchParams';
import { useFeedQuery } from '../hooks/useFeedQuery';
import { useFeedScrollRestore } from '../hooks/useFeedScrollRestore';
import { AuctionClockProvider } from './AuctionClockProvider';
import { FeedStatsStrip, type FilteredStats } from './FeedStatsStrip';
import { FeedToolbar } from './FeedToolbar';
import { FeedFilterSidebar } from './FeedFilterSidebar';
import { FeedLayout } from './FeedLayout';
import { FeedSkeleton } from './FeedSkeleton';
import { FeedEmptyState } from './FeedEmptyState';
import { VehicleCard } from './VehicleCard';
import { BrandHeartbeat } from './heartbeat/BrandHeartbeat';
import { FeedStatCard } from './FeedStatCard';
import { SignalCard, useSignalCards } from './SignalCard';
import { InterestsBar } from './InterestsBar';
import { RecentlyViewed } from './RecentlyViewed';
import { ReturnVisitBanner } from './ReturnVisitBanner';
import { FreshFindsStrip } from './FreshFindsStrip';
import { HeroPanel, type HeroDimension, type HeroFilter } from './HeroPanel';
import { DEFAULT_FILTERS } from '../../lib/filterPersistence';
import { useInterests } from '../../hooks/useInterests';
import { useViewHistory } from '../../hooks/useViewHistory';
import type { FeedVehicle } from '../types/feed';

export default function FeedPage() {
  const {
    filters,
    sortBy,
    sortDirection,
    searchText,
    viewMode,
    cardsPerRow,
    imageFit,
    hasActiveFilters,
    setFilters,
    setSortBy,
    setSortDirection,
    setSearchText,
    setViewMode,
    setCardsPerRow,
    setImageFit,
    resetAll,
  } = useFeedSearchParams();

  // Restore scroll position when returning via back navigation
  useFeedScrollRestore();

  // Interest memory — tracks makes/models the user engages with
  const {
    topMakes,
    topModels,
    hasInterests,
    previousVisit,
    recordInterest,
    touchLastVisit,
    clearInterests,
  } = useInterests();

  // View history — tracks which vehicles user has seen
  const { viewedIds, getViewedWithPrices } = useViewHistory();

  // Get viewed vehicles with price data (for return-visit price-drop detection)
  const viewedWithPrices = useMemo(() => getViewedWithPrices(), [getViewedWithPrices]);

  // Update lastVisit on mount so we can count "new since last visit"
  useEffect(() => {
    touchLastVisit();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wrap setFilters to also record interest when makes/models change
  const handleFiltersChange = useCallback(
    (newFilters: typeof filters) => {
      // Record new makes
      for (const make of newFilters.makes) {
        if (!filters.makes.includes(make)) {
          recordInterest('make', make);
        }
      }
      // Record new models
      for (const model of newFilters.models) {
        if (!filters.models.includes(model)) {
          recordInterest('model', model);
        }
      }
      setFilters(newFilters);
    },
    [filters.makes, filters.models, recordInterest, setFilters],
  );

  // Interest chip click handlers — apply make or model as filter
  const handleInterestMakeClick = useCallback(
    (make: string) => {
      recordInterest('make', make);
      setFilters({ ...DEFAULT_FILTERS, makes: [make] });
      setSortBy('popular');
    },
    [recordInterest, setFilters, setSortBy],
  );

  const handleInterestModelClick = useCallback(
    (model: string) => {
      recordInterest('model', model);
      // Try to infer the make from the model's top association
      setFilters({ ...DEFAULT_FILTERS, models: [model] });
      setSortBy('popular');
    },
    [recordInterest, setFilters, setSortBy],
  );

  // Local display settings (not URL-persisted)
  const [fontSize, setFontSize] = useState(10);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [activeMetric, setActiveMetric] = useState<string | null>(null);
  const [activeHeroPanel, setActiveHeroPanel] = useState<HeroDimension | null>(null);

  // Hero panel filter handler -- applies the filter from a hero cell click
  const handleHeroFilter = useCallback(
    (filter: HeroFilter) => {
      const newFilters = { ...DEFAULT_FILTERS };
      if (filter.makes && filter.makes.length > 0) {
        newFilters.makes = filter.makes;
      }
      if (filter.sources && filter.sources.length > 0) {
        // Source filter from NEWEST panel — show today's intake, sorted newest
        newFilters.addedTodayOnly = true;
      }
      if (filter.yearMin != null) {
        newFilters.yearMin = filter.yearMin;
      }
      if (filter.yearMax != null) {
        newFilters.yearMax = filter.yearMax;
      }
      if (filter.priceMin != null) {
        newFilters.priceMin = filter.priceMin;
      }
      if (filter.priceMax != null) {
        newFilters.priceMax = filter.priceMax;
      }
      setFilters(newFilters);
      if (filter.sort) {
        setSortBy(filter.sort);
      }
      // Close the panel after filtering
      setActiveHeroPanel(null);
    },
    [setFilters, setSortBy],
  );

  const handleHeroPanelToggle = useCallback(
    (dimension: HeroDimension | null) => {
      setActiveHeroPanel(dimension);
    },
    [],
  );

  // Metric click handler — applies filter presets per Design Bible Law #1
  const handleMetricClick = useCallback(
    (metric: 'vehicles' | 'value' | 'today' | 'for_sale' | 'live') => {
      // If same metric clicked again, reset to defaults
      if (activeMetric === metric) {
        setActiveMetric(null);
        setFilters(DEFAULT_FILTERS);
        setSortBy('popular');
        return;
      }

      setActiveMetric(metric);

      switch (metric) {
        case 'vehicles':
          // Reset all filters — show everything
          setFilters(DEFAULT_FILTERS);
          setSortBy('popular');
          break;
        case 'value':
          // Sort by price high
          setFilters(DEFAULT_FILTERS);
          setSortBy('price_high');
          break;
        case 'today':
          // Filter to today only
          setFilters({ ...DEFAULT_FILTERS, addedTodayOnly: true });
          setSortBy('newest');
          break;
        case 'for_sale':
          // Filter to for-sale only
          setFilters({ ...DEFAULT_FILTERS, forSale: true });
          setSortBy('newest');
          break;
        case 'live':
          // Filter to for-sale + sort by feed rank (live auctions get +200 rank boost)
          setFilters({ ...DEFAULT_FILTERS, forSale: true });
          setSortBy('popular');
          break;
      }
    },
    [activeMetric, setFilters, setSortBy],
  );

  // Resolve 'auto' fit: contain for dense grids (>= 8 cols), cover otherwise
  const resolvedFit: 'cover' | 'contain' =
    imageFit === 'auto' ? (cardsPerRow >= 8 ? 'contain' : 'cover') : imageFit;

  const feedQuery = useFeedQuery({ filters, sortBy, sortDirection, searchText });

  const vehicles = useMemo(
    () => feedQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [feedQuery.data],
  );

  const stats = feedQuery.data?.pages[0]?.stats ?? null;

  // Compute stats from the loaded (filtered) vehicle set
  const filteredStats = useMemo((): FilteredStats | null => {
    if (vehicles.length === 0) return null;
    let totalValue = 0;
    let pricedCount = 0;
    let forSaleCount = 0;
    let liveCount = 0;
    for (const v of vehicles) {
      if (v.display_price != null && v.display_price > 0) {
        totalValue += v.display_price;
        pricedCount++;
      }
      if (v.is_for_sale) forSaleCount++;
      if (v.listing_status === 'active' || v.listing_status === 'live') liveCount++;
    }
    return {
      count: vehicles.length,
      totalValue,
      forSaleCount,
      liveCount,
    };
  }, [vehicles]);

  const renderCard = useCallback(
    (vehicle: FeedVehicle) => (
      <VehicleCard
        key={vehicle.id}
        vehicle={vehicle}
        viewMode={viewMode}
        compact={viewMode === 'grid' && cardsPerRow > 8}
        showScores={showScores}
        imageFit={resolvedFit}
        viewed={viewedIds.has(vehicle.id)}
      />
    ),
    [viewMode, cardsPerRow, showScores, resolvedFit, viewedIds],
  );

  // Brand heartbeat: show when exactly one make is selected
  const singleMake = filters.makes.length === 1 ? filters.makes[0] : undefined;
  const singleModel = singleMake && filters.models.length === 1 ? filters.models[0] : undefined;

  // Signal cards — inject drama and live-market feel between vehicle rows
  const signalCards = useSignalCards(vehicles, viewedIds);

  // Combined stat/signal card renderer for FeedLayout.
  // Odd slots get signal cards, even slots get stat cards.
  const renderStatCard = useCallback(
    (index: number) => {
      // Alternate: signal card slots and stat card slots
      if (signalCards.length > 0 && index % 2 === 0) {
        const signalIdx = Math.floor(index / 2) % signalCards.length;
        const signal = signalCards[signalIdx];
        if (signal) {
          return <SignalCard data={signal} />;
        }
      }
      return <FeedStatCard index={index} stats={stats} filteredStats={filteredStats} />;
    },
    [stats, filteredStats, signalCards],
  );

  // Signal cards are taller than stat cards — estimate height for virtualizer
  const hasSignals = signalCards.length > 0;
  const signalCardHeight = hasSignals ? 200 : 48;

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
        {/* Stats strip — inline in content area. Every metric is clickable (Law #1). */}
        <FeedStatsStrip
          stats={stats}
          filteredStats={filteredStats}
          isLoading={feedQuery.isLoading}
          searchText={searchText}
          onSearchChange={setSearchText}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={resetAll}
          onMetricClick={handleMetricClick}
          activeMetric={activeMetric}
        />

        {/* Toolbar — full width, with FOR YOU sort when interests exist */}
        <FeedToolbar
          sort={sortBy}
          direction={sortDirection}
          viewMode={viewMode}
          cardsPerRow={cardsPerRow}
          fontSize={fontSize}
          showScores={showScores}
          imageFit={imageFit}
          hasInterests={hasInterests}
          activeHeroPanel={activeHeroPanel}
          onSortChange={setSortBy}
          onDirectionChange={setSortDirection}
          onViewModeChange={setViewMode}
          onCardsPerRowChange={setCardsPerRow}
          onFontSizeChange={setFontSize}
          onToggleScores={() => setShowScores(!showScores)}
          onImageFitChange={setImageFit}
          onHeroPanelToggle={handleHeroPanelToggle}
        />

        {/* Hero panel — dimension visualization between toolbar and feed */}
        <HeroPanel
          dimension={activeHeroPanel}
          vehicles={vehicles}
          onFilter={handleHeroFilter}
          onClose={() => setActiveHeroPanel(null)}
        />

        {/* Return visit banner — personalized "what's new since last visit" */}
        <ReturnVisitBanner
          previousVisit={previousVisit}
          hasInterests={hasInterests}
          topMakes={topMakes}
          vehicles={vehicles}
          viewedWithPrices={viewedWithPrices}
        />

        {/* Fresh finds strip — top new vehicles matching interests since last visit */}
        <FreshFindsStrip
          previousVisit={previousVisit}
          hasInterests={hasInterests}
          topMakes={topMakes}
        />

        {/* Interest chips — shown when user has interests and no active filters */}
        <InterestsBar
          topMakes={topMakes}
          topModels={topModels}
          hasInterests={hasInterests}
          hasActiveFilters={hasActiveFilters}
          vehicles={vehicles}
          previousVisit={previousVisit}
          onMakeClick={handleInterestMakeClick}
          onModelClick={handleInterestModelClick}
          onClearInterests={clearInterests}
        />

        {/* Recently viewed strip */}
        <RecentlyViewed limit={20} />

        {/* Sidebar + Content */}
        <div style={{ display: 'flex', minHeight: 'calc(100vh - 72px)' }}>
          {/* Filter sidebar — make/model toggles also record interests */}
          <FeedFilterSidebar
            filters={filters}
            onFiltersChange={handleFiltersChange}
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
                statCardHeight={signalCardHeight}
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
