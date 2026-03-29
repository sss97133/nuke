import React, { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

  // Domain for display
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
        {/* Scanning bar while extracting */}
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
          {/* Platform badge + domain */}
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
      {/* URL Extraction — the magic moment */}
      {urlExtraction && (
        <UrlExtractionCard extraction={urlExtraction} />
      )}

      {/* Results first — the thing you came here for */}
      {query && !urlExtraction && (
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

      {/* View in Feed link — preserves search terms */}
      {query && !urlExtraction && (
        <div style={{ padding: '8px 0', textAlign: 'right' }}>
          <Link
            to={`/?tab=feed&q=${encodeURIComponent(query)}`}
            style={{
              fontFamily: "'Courier New', monospace",
              fontSize: '9px',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
              padding: '4px 14px',
              border: '2px solid var(--text, #1a1a1a)',
              background: 'var(--surface, #fff)',
              color: 'var(--text, #1a1a1a)',
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

      {/* Filter panel — collapsed by default, below results summary */}
      {query && !urlExtraction && vehicleCount > 0 && (
        <SearchFilterPanel
          filters={filters}
          onChange={setFilters}
          vehicleCount={vehicleCount}
          displayVehicleCount={displayVehicleCount}
        />
      )}

      {/* Browse stats — context about the make, below results */}
      {query && !urlExtraction && browseStats && browseStats.total > 0 && (
        <SearchStatsBar stats={browseStats} make={detectedMake} />
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
