import React, { useRef } from 'react';
import { useSearchPage } from '../hooks/useSearchPage';
import { useSearchEmptyState } from '../hooks/useSearchEmptyState';
import SearchResults from '../components/search/SearchResults';
import { SearchFilterPanel } from '../components/search/SearchFilterPanel';
import { SearchStatsBar } from '../components/search/SearchStatsBar';
import { SearchEmptyState } from '../components/search/SearchEmptyState';
import '../styles/unified-design-system.css';

export default function Search() {
  const {
    query,
    displayResults,
    loading,
    searchSummary,
    filters,
    setFilters,
    vehicleCount,
    displayVehicleCount,
    resultFilter,
    setResultFilter,
    searchMeta,
    handleLoadMore,
    loadingMore,
    browseStats,
    detectedMake,
  } = useSearchPage();

  const emptyState = useSearchEmptyState(!query);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  return (
    <div style={{ padding: '12px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Browse stats — total count, avg price, model/source/era breakdown */}
      {query && browseStats && browseStats.total > 0 && (
        <SearchStatsBar stats={browseStats} make={detectedMake} />
      )}

      {/* Filter panel — only when results contain vehicles */}
      {query && vehicleCount > 0 && (
        <SearchFilterPanel
          filters={filters}
          onChange={setFilters}
          vehicleCount={vehicleCount}
          displayVehicleCount={displayVehicleCount}
        />
      )}

      {/* Results */}
      {query && (
        <div ref={resultsRef}>
          <SearchResults
            results={displayResults}
            searchSummary={searchSummary}
            loading={loading}
            activeFilter={resultFilter}
            onFilterChange={setResultFilter}
            totalCount={searchMeta?.total_count}
            hasMore={searchMeta?.has_more}
            onLoadMore={handleLoadMore}
            loadingMore={loadingMore}
          />
        </div>
      )}

      {/* Empty state — browse facets + recent vehicles */}
      {!query && !loading && (
        <SearchEmptyState
          recentVehicles={emptyState.recentVehicles}
          notableSales={emptyState.notableSales}
          topMakes={emptyState.topMakes}
          totalCount={emptyState.totalCount}
          loading={emptyState.loading}
        />
      )}
    </div>
  );
}
