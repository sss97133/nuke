import React, { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Link from '../components/PrefetchLink';
import { Button } from '../components/ui/button';
import { useSearchPage } from '../hooks/useSearchPage';
import { useSearchEmptyState } from '../hooks/useSearchEmptyState';
import SearchResults from '../components/search/SearchResults';
import { SearchFilterPanel } from '../components/search/SearchFilterPanel';
import { SearchStatsBar } from '../components/search/SearchStatsBar';
import { SearchEmptyState } from '../components/search/SearchEmptyState';
import type { UrlExtraction } from '../hooks/useSearchPage';
import '../styles/unified-design-system.css';
import './search-page.css';

/* ─── URL Extraction Card ─── */
function UrlExtractionCard({ extraction, onImport }: { extraction: UrlExtraction; onImport: () => void }) {
  const { status, url, platform, error } = extraction;

  let domain = '';
  try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { domain = url; }

  return (
    <section className="search-import-card" aria-label="Listing import">
      <h2>{status === 'ready' ? 'Import this listing' : status === 'error' ? 'Import failed' : 'Importing listing'}</h2>
      {platform && <p className="search-import-platform">{platform.short}</p>}
      <a href={url} target="_blank" rel="noreferrer" className="search-import-source">
        Open original listing · {domain}
      </a>
      {status === 'ready' && <p>Read the listing and add or enrich its vehicle record.</p>}
      {status === 'extracting' && <p role="status">Importing vehicle data…</p>}
      {status === 'error' && <p role="alert">{error}</p>}
      {(status === 'ready' || status === 'error') && <Button type="button" onClick={onImport}>
        {status === 'ready' ? 'Import listing' : 'Retry import'}
      </Button>}
    </section>
  );
}

/* ─── Inline search input for the search page ─── */
function SearchPageInput({ initialQuery }: { initialQuery: string }) {
  const [value, setValue] = useState(initialQuery);
  const [, setSearchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const q = value.trim();
    setSearchParams(q ? { q } : {});
  };
  return (
    <form onSubmit={handleSubmit} className="search-page-form" role="search">
      <div className="search-page-input">
        <input ref={inputRef} type="search" aria-label="Search vehicles and records"
          value={value} onChange={event => setValue(event.target.value)}
          placeholder="Vehicles, VINs, makes, models…" spellCheck={false}
          autoComplete="off" autoFocus={!initialQuery} />
        {value && <Button variant="ghost" type="button" aria-label="Clear search"
          onClick={() => { setValue(''); setSearchParams({}); inputRef.current?.focus(); }}>×</Button>}
      </div>
      <Button type="submit">Search</Button>
    </form>
  );
}

export default function Search() {
  const {
    query,
    cohortTarget,
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
    loadMoreError,
    searchError,
    retrySearch,
    browseStats,
    detectedMake,
    urlExtraction,
    startUrlImport,
  } = useSearchPage();

  const emptyState = useSearchEmptyState(!query);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  return (
    <main className="search-page">
      <h1>Search</h1>

      {/* Search input — always visible on search page */}
      <div style={{ marginBottom: '16px' }}>
        <SearchPageInput key={query} initialQuery={query} />
      </div>

      {/* URL Extraction */}
      {urlExtraction && (
        <UrlExtractionCard extraction={urlExtraction} onImport={() => void startUrlImport()} />
      )}

      {/* Active search: filters + results */}
      {query && !urlExtraction && (
        <>
          {vehicleCount > 0 && (
            <p style={{ color: 'var(--text-secondary)' }}>
              {displayVehicleCount} of {vehicleCount} loaded vehicle records shown.
              {' '}Recorded prices may be past sales, estimates, or asks. Current purchase availability is unverified.
              {(filters.priceMin || filters.priceMax) && ' Price bounds apply to these loaded records; unknown prices are excluded. This is not an exhaustive market shortlist.'}
            </p>
          )}
          {/* Cohort terminal link — only when the query is a clean year-make-model */}
          {cohortTarget && (
            <Link className="search-page-link"
              to={cohortTarget.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                padding: '10px 14px',
                marginBottom: '12px',
                textDecoration: 'none',
                transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              <div>
                <div style={{ fontWeight: 800, color: 'var(--text-muted)' }}>
                  Cohort Terminal
                </div>
                <div style={{ fontWeight: 800, color: 'var(--text)' }}>
                  {cohortTarget.label}
                </div>
              </div>
              <div style={{ fontWeight: 800, color: 'var(--text)' }}>
                View terminal &rarr;
              </div>
            </Link>
          )}

          {/* Filter panel — above results, collapsed by default */}
          {vehicleCount > 0 && (
            <SearchFilterPanel
              filters={filters}
              onChange={setFilters}
              vehicleCount={vehicleCount}
              displayVehicleCount={displayVehicleCount}
            />
          )}

          {/* Results */}
          <div ref={resultsRef}>
            {searchError ? <section className="search-page-error" role="alert">
              <h2>Search unavailable</h2><p>{searchError}</p>
              <Button type="button" variant="secondary" onClick={retrySearch}>Retry search</Button>
            </section> : <SearchResults
              results={displayResults}
              searchSummary={searchSummary}
              loading={loading}
              activeFilter={resultFilter}
              onFilterChange={setResultFilter}
              totalCount={searchMeta?.total_count}
              hasMore={searchMeta?.has_more && !searchMeta.pagination_limited}
              paginationLimited={searchMeta?.pagination_limited}
              onLoadMore={handleLoadMore}
              loadingMore={loadingMore}
              loadMoreError={loadMoreError}
            />}
          </div>

          {/* Browse stats — context about the make */}
          {browseStats && browseStats.total > 0 && (
            <SearchStatsBar stats={browseStats} make={detectedMake} />
          )}

          {/* View in Feed link */}
          {displayResults.length > 0 && (
            <div style={{ padding: '12px 0', textAlign: 'right' }}>
              <Link className="search-page-link"
                to={`/?tab=feed&q=${encodeURIComponent(query)}`}
                style={{
                  fontWeight: 800,
                  padding: '4px 14px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  textDecoration: 'none',
                  display: 'inline-block',
                  transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
              >
                VIEW IN FEED &rarr;
              </Link>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!query && !loading && (
        <SearchEmptyState
          recentVehicles={emptyState.recentVehicles}
          notableSales={emptyState.notableSales}
          topMakes={emptyState.topMakes}
          totalCount={emptyState.totalCount}
          loading={emptyState.loading}
        />
      )}
    </main>
  );
}
