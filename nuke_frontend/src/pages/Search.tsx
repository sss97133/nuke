import React, { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSearchPage } from '../hooks/useSearchPage';
import { useSearchEmptyState } from '../hooks/useSearchEmptyState';
import SearchResults from '../components/search/SearchResults';
import { SearchFilterPanel } from '../components/search/SearchFilterPanel';
import { SearchStatsBar } from '../components/search/SearchStatsBar';
import { SearchEmptyState } from '../components/search/SearchEmptyState';
import type { UrlExtraction } from '../hooks/useSearchPage';
import '../styles/unified-design-system.css';

/* ─── URL Extraction Card ─── */
function UrlExtractionCard({ extraction }: { extraction: UrlExtraction }) {
  const { status, url, platform, error } = extraction;

  let domain = '';
  try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { domain = url; }

  return (
    <div style={{ maxWidth: '560px', margin: '40px auto', padding: '0 12px' }}>
      <style>{`
        @keyframes nuke-scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>

      <div style={{
        border: '2px solid var(--text)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}>
        {status === 'extracting' && (
          <div style={{ height: '3px', background: 'var(--border)', overflow: 'hidden', position: 'relative' }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, width: '60%', height: '100%',
              background: 'var(--text)',
              animation: 'nuke-scan 1.2s ease-in-out infinite',
            }} />
          </div>
        )}
        {status === 'error' && (
          <div style={{ height: '3px', background: 'var(--error, #c00)' }} />
        )}

        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            {platform && (
              <span style={{
                background: 'var(--text)',
                color: 'var(--bg)',
                padding: '3px 10px',
                fontSize: '10px',
                fontWeight: 800,
                letterSpacing: '1px',
              }}>
                {platform.short}
              </span>
            )}
            <span style={{
              fontFamily: "'Courier New', monospace",
              fontSize: '11px',
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {domain}
            </span>
          </div>

          {status === 'extracting' && (
            <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)' }}>
              Extracting vehicle data...
            </div>
          )}

          {status === 'error' && (
            <>
              <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text)', marginBottom: '8px' }}>
                Extraction failed
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                {error}
              </div>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--text)',
                  textDecoration: 'underline',
                }}
              >
                Open original listing
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Inline search input for the search page ─── */
function SearchPageInput({ initialQuery }: { initialQuery: string }) {
  const [value, setValue] = useState(initialQuery);
  const [, setSearchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    setSearchParams({ q });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0', width: '100%' }}>
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        border: '2px solid var(--text)',
        background: 'var(--surface)',
        padding: '0 10px',
        height: '36px',
      }}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" strokeWidth="2" style={{ flexShrink: 0, marginRight: '8px' }}>
          <circle cx="6.5" cy="6.5" r="5.5" />
          <line x1="11" y1="11" x2="15" y2="15" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search vehicles, VINs, makes, models..."
          spellCheck={false}
          autoComplete="off"
          autoFocus={!initialQuery}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontFamily: 'Arial, sans-serif',
            fontSize: '11px',
            color: 'var(--text)',
            padding: '0',
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => { setValue(''); inputRef.current?.focus(); }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              color: 'var(--text-secondary)',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        )}
      </div>
      <button
        type="submit"
        style={{
          background: 'var(--text)',
          color: 'var(--bg)',
          border: '2px solid var(--text)',
          borderLeft: 'none',
          padding: '0 16px',
          fontSize: '9px',
          fontWeight: 800,
          fontFamily: 'Arial, sans-serif',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          cursor: 'pointer',
          height: '36px',
        }}
      >
        SEARCH
      </button>
    </form>
  );
}

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
    urlExtraction,
  } = useSearchPage();

  const emptyState = useSearchEmptyState(!query);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  return (
    <div style={{ padding: '12px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Search input — always visible on search page */}
      <div style={{ marginBottom: '16px' }}>
        <SearchPageInput key={query} initialQuery={query} />
      </div>

      {/* URL Extraction */}
      {urlExtraction && (
        <UrlExtractionCard extraction={urlExtraction} />
      )}

      {/* Active search: filters + results */}
      {query && !urlExtraction && (
        <>
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

          {/* Browse stats — context about the make */}
          {browseStats && browseStats.total > 0 && (
            <SearchStatsBar stats={browseStats} make={detectedMake} />
          )}

          {/* View in Feed link */}
          {displayResults.length > 0 && (
            <div style={{ padding: '12px 0', textAlign: 'right' }}>
              <Link
                to={`/?tab=feed&q=${encodeURIComponent(query)}`}
                style={{
                  fontFamily: "'Courier New', monospace",
                  fontSize: '9px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  padding: '4px 14px',
                  border: '2px solid var(--text)',
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
    </div>
  );
}
