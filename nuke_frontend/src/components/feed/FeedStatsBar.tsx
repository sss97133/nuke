import React from 'react';

/**
 * FeedStatsBar — Sticky minimized bar showing vehicle counts, action buttons,
 * filter chips, source pogs, and layout controls.
 *
 * Extracted from CursorHomepage.tsx lines ~5012-5560.
 */

export interface FeedStatsBarProps {
  // Stats
  displayStats: {
    totalVehicles: number;
    totalValue: number;
    vehiclesAddedToday: number;
    forSaleCount: number;
    activeAuctions: number;
    avgValue: number;
    salesCountToday: number;
    salesVolume: number;
    marketInterestValue: number;
    rnmVehicleCount: number;
  };
  salesByPeriod: { count: number; volume: number; label: string };
  hasActiveFilters: boolean;
  debouncedSearchText: string;

  // Filter state
  filters: {
    addedTodayOnly: boolean;
    forSale: boolean;
  };
  activeFilterCount: number;
  getActiveFilterBadges: Array<{ label: string; onRemove?: () => void }>;

  // Source pogs
  sourcePogs: {
    selected: Array<{ id?: string; key: string; domain: string; title: string }>;
    hiddenCount: number;
  };

  // Sort
  sortBy: string;
  setSortBy: (s: string) => void;
  setSortDirection: (d: string) => void;
  statsPanel: string | null;

  // Layout
  cardsPerRow: number;
  setCardsPerRow: (n: number) => void;
  thumbFitMode: 'square' | 'original';
  setThumbFitMode: (m: 'square' | 'original') => void;
  rememberFilters: boolean;
  setRememberFilters: (v: boolean) => void;

  // Actions
  openFiltersFromMiniBar: () => void;
  setShowRecentlyAddedPanel: (v: boolean) => void;
  toggleForSale: () => void;
  setShowActiveAuctionsPanel: (v: boolean) => void;
  setShowFBMarketplacePanel: (v: boolean) => void;
  openStatsPanel: (kind: string) => void;
  setFilters: (f: any) => void;
  setSearchText: (s: string) => void;
  clearPersistedFiltersAndSort: () => void;
  setSourceIncluded: (key: string, included: boolean) => void;

  // Helpers
  formatCurrency: (n: number) => string;
  faviconUrl: (domain: string) => string;
  domainGradient: (domain: string) => string;

  // Constants
  REMEMBER_FILTERS_KEY: string;
  DEFAULT_FILTERS: any;
}

const FeedStatsBar: React.FC<FeedStatsBarProps> = ({
  displayStats,
  salesByPeriod,
  hasActiveFilters,
  debouncedSearchText,
  filters,
  activeFilterCount,
  getActiveFilterBadges,
  sourcePogs,
  sortBy,
  setSortBy,
  setSortDirection,
  statsPanel,
  cardsPerRow,
  setCardsPerRow,
  thumbFitMode,
  setThumbFitMode,
  rememberFilters,
  setRememberFilters,
  openFiltersFromMiniBar,
  setShowRecentlyAddedPanel,
  toggleForSale,
  setShowActiveAuctionsPanel,
  setShowFBMarketplacePanel,
  openStatsPanel,
  setFilters,
  setSearchText,
  clearPersistedFiltersAndSort,
  setSourceIncluded,
  formatCurrency,
  faviconUrl,
  domainGradient,
  REMEMBER_FILTERS_KEY,
  DEFAULT_FILTERS,
}) => {
  return (
    <div
      onClick={openFiltersFromMiniBar}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openFiltersFromMiniBar();
        }
      }}
      title="Click to open filters"
      role="button"
      tabIndex={0}
      aria-label="Open filters"
      style={{
        position: 'sticky',
        top: 'var(--header-height, 40px)',
        background: 'var(--surface-glass)',
        backdropFilter: 'blur(8px)',
        border: '1px solid var(--border)',
        padding: '7px 12px',
        marginBottom: '10px',
        zIndex: 900,
        boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
        display: 'flex',
        flexWrap: 'nowrap',
        gap: '10px',
        alignItems: 'center',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      {/* Stats row */}
      <div style={{
        display: 'flex',
        flexWrap: 'nowrap',
        alignItems: 'center',
        gap: '8px',
        flex: '0 0 auto',
        fontSize: '11px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* Vehicle count */}
        <div style={{ fontWeight: 700, color: 'var(--text)' }}>
          {displayStats.totalVehicles.toLocaleString()}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '2px' }}>veh</span>
        </div>

        {/* Added today */}
        {displayStats.vehiclesAddedToday > 0 && (
          <>
            <div style={{ width: '1px', height: '12px', background: 'var(--border)', opacity: 0.5 }} />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowRecentlyAddedPanel(true);
              }}
              title="View recently added vehicles analytics"
              style={{
                padding: '2px 8px',
                borderRadius: '999px',
                border: filters.addedTodayOnly
                  ? '1px solid rgba(16,185,129,0.55)'
                  : '1px solid rgba(16,185,129,0.25)',
                background: filters.addedTodayOnly ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.08)',
                color: 'var(--success)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                flex: '0 0 auto',
                lineHeight: 1.3,
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(16,185,129,0.22)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = filters.addedTodayOnly ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.08)';
              }}
            >
              +{displayStats.vehiclesAddedToday} today
            </button>
          </>
        )}

        {/* Total value */}
        <div style={{ width: '1px', height: '12px', background: 'var(--border)', opacity: 0.5 }} />
        <div
          style={{
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'baseline',
            gap: '4px',
            position: 'relative',
          }}
          title={displayStats.marketInterestValue > 0
            ? `Realized: ${formatCurrency(displayStats.totalValue)}\nMarket Interest: ${formatCurrency(displayStats.marketInterestValue)} (${displayStats.rnmVehicleCount} reserve-not-met)`
            : `Total portfolio value: ${formatCurrency(displayStats.totalValue)}`
          }
        >
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>
            {formatCurrency(displayStats.totalValue)}
          </span>
          {displayStats.marketInterestValue > 0 && (
            <span style={{ color: 'var(--warning)', fontSize: '9px', fontWeight: 500, cursor: 'help' }}>
              +{formatCurrency(displayStats.marketInterestValue)} interest
            </span>
          )}
        </div>

        {/* For sale */}
        {displayStats.forSaleCount > 0 && (
          <>
            <div style={{ width: '1px', height: '12px', background: 'var(--border)', opacity: 0.5 }} />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleForSale();
              }}
              title={filters.forSale
                ? `Showing ${displayStats.forSaleCount} for sale. Click to show all.`
                : `${displayStats.forSaleCount} for sale. Click to filter.`
              }
              style={{
                border: 'none',
                background: 'transparent',
                padding: 0,
                margin: 0,
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: '11px',
                color: filters.forSale ? 'var(--success)' : 'var(--text-muted)',
                fontWeight: filters.forSale ? 700 : 400,
                transition: 'color 0.15s ease',
              }}
            >
              {displayStats.forSaleCount.toLocaleString()} for sale
            </button>
          </>
        )}

        {/* Live auctions */}
        {displayStats.activeAuctions > 0 && (
          <>
            <div style={{ width: '1px', height: '12px', background: 'var(--border)', opacity: 0.5 }} />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowActiveAuctionsPanel(true);
              }}
              title="Live auctions with countdown timers, bid counts, and market analytics"
              style={{
                border: 'none',
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                padding: '2px 8px',
                margin: 0,
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: '7.5pt',
                color: 'var(--bg)',
                borderRadius: '999px',
                fontWeight: 700,
                transition: 'opacity 0.15s ease',
              }}
            >
              LIVE
            </button>
          </>
        )}

        {/* FB Marketplace */}
        <>
          <div style={{ width: '1px', height: '12px', background: 'var(--border)', opacity: 0.5 }} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowFBMarketplacePanel(true);
            }}
            title="Facebook Marketplace classic cars - live monitor feed"
            style={{
              border: 'none',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              padding: '2px 8px',
              margin: 0,
              cursor: 'pointer',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '7.5pt',
              color: 'var(--bg)',
              borderRadius: '999px',
              fontWeight: 700,
              transition: 'opacity 0.15s ease',
            }}
          >
            FB CARS
          </button>
        </>

        {/* Deals sort */}
        <>
          <div style={{ width: '1px', height: '12px', background: 'var(--border)', opacity: 0.5 }} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (sortBy === 'deal_score') {
                setSortBy('newest');
              } else {
                setSortBy('deal_score');
                setSortDirection('desc');
              }
            }}
            title="Sort by deal score — vehicles priced below their Nuke Estimate"
            style={{
              border: sortBy === 'deal_score' ? '1px solid rgba(16,185,129,0.5)' : 'none',
              background: sortBy === 'deal_score'
                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                : 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(5,150,105,0.12) 100%)',
              padding: '2px 8px',
              margin: 0,
              cursor: 'pointer',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '7.5pt',
              color: sortBy === 'deal_score' ? 'var(--bg)' : 'var(--success)',
              borderRadius: '999px',
              fontWeight: 700,
              transition: 'all 0.15s ease',
            }}
          >
            DEALS
          </button>
        </>

        {/* Trending sort */}
        <>
          <div style={{ width: '1px', height: '12px', background: 'var(--border)', opacity: 0.5 }} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (sortBy === 'heat_score') {
                setSortBy('newest');
              } else {
                setSortBy('heat_score');
                setSortDirection('desc');
              }
            }}
            title="Sort by heat score — most exciting vehicles right now"
            style={{
              border: sortBy === 'heat_score' ? '1px solid rgba(239,68,68,0.5)' : 'none',
              background: sortBy === 'heat_score'
                ? 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)'
                : 'linear-gradient(135deg, rgba(249,115,22,0.12) 0%, rgba(239,68,68,0.12) 100%)',
              padding: '2px 8px',
              margin: 0,
              cursor: 'pointer',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: '7.5pt',
              color: sortBy === 'heat_score' ? 'var(--bg)' : 'var(--warning)',
              borderRadius: '999px',
              fontWeight: 700,
              transition: 'all 0.15s ease',
            }}
          >
            TRENDING
          </button>
        </>

        {/* Sold period */}
        {salesByPeriod.count > 0 && (
          <>
            <div style={{ width: '1px', height: '12px', background: 'var(--border)', opacity: 0.5 }} />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openStatsPanel('sold_today');
              }}
              title={`${salesByPeriod.count} sold ${salesByPeriod.label}. Open analytics popup.`}
              style={{
                border: 'none',
                background: 'transparent',
                padding: 0,
                margin: 0,
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: '11px',
                color: statsPanel === 'sold_today' ? 'var(--purple, #7c3aed)' : 'var(--text-muted)',
                fontWeight: statsPanel === 'sold_today' ? 700 : 400,
                transition: 'color 0.15s ease',
              }}
            >
              {salesByPeriod.count.toLocaleString()} sold {salesByPeriod.label}
            </button>
          </>
        )}

        {/* Average value when filtered */}
        {(hasActiveFilters || debouncedSearchText) && displayStats.avgValue > 0 && displayStats.totalVehicles > 1 && (
          <>
            <div style={{ width: '1px', height: '12px', background: 'var(--border)', opacity: 0.5 }} />
            <div style={{ color: 'var(--text-muted)' }}>
              {formatCurrency(displayStats.avgValue)} avg
            </div>
          </>
        )}
      </div>

      {/* Scrollable strip: selected filters + market pogs */}
      <div
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflowX: 'auto',
          overflowY: 'hidden',
          paddingBottom: '2px',
        }}
      >
        {/* Selected filter chips */}
        {activeFilterCount === 0 ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 10px',
              background: 'var(--grey-200)',
              border: '1px solid var(--border)',
              borderRadius: '999px',
              fontSize: '7.5pt',
              color: 'var(--text-muted)',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              flex: '0 0 auto',
            }}
          >
            No filters
          </div>
        ) : (
          getActiveFilterBadges.map((badge, idx) => (
            <div
              key={idx}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '2px 10px',
                background: 'var(--grey-200)',
                border: '1px solid var(--border)',
                borderRadius: '999px',
                fontSize: '7.5pt',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                flex: '0 0 auto',
              }}
            >
              <span>{badge.label}</span>
              {badge.onRemove && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    badge.onRemove?.();
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '0',
                    margin: 0,
                    cursor: 'pointer',
                    fontSize: '11px',
                    lineHeight: 1,
                    color: 'var(--text-muted)',
                    fontWeight: 'bold',
                  }}
                  title="Remove filter"
                >
                  ×
                </button>
              )}
            </div>
          ))
        )}

        {/* Source pogs when sources are filtered */}
        {sourcePogs.hiddenCount > 0 && (
          <>
            <div style={{ width: '1px', height: '14px', background: 'var(--border)', flex: '0 0 auto' }} aria-hidden="true" />
            <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flex: '0 0 auto' }}>
              {sourcePogs.selected.map((p, idx) => (
                <button
                  key={p.id ? `source-${p.id}` : `source-${p.domain}-${idx}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSourceIncluded(p.key, false);
                  }}
                  aria-label={`${p.title} (selected)`}
                  title={`${p.title}: Selected (click to remove)`}
                  style={{
                    width: '18px',
                    height: '18px',
                    padding: 0,
                    borderRadius: '999px',
                    border: '1px solid rgba(255,255,255,0.14)',
                    background: `${domainGradient(p.domain)}, var(--surface-glass)`,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 0 0 2px var(--accent-dim)',
                    opacity: 1,
                    flex: '0 0 auto',
                    backdropFilter: 'blur(10px) saturate(1.35)',
                  }}
                >
                  <img
                    src={faviconUrl(p.domain)}
                    alt=""
                    width={14}
                    height={14}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '3px',
                      filter: 'none',
                    }}
                  />
                </button>
              ))}

              <div
                style={{
                  flex: '0 0 auto',
                  width: '18px',
                  height: '18px',
                  borderRadius: '999px',
                  border: '1px solid var(--border)',
                  background: 'var(--grey-200)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px',
                  color: 'var(--text-muted)',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  userSelect: 'none',
                }}
                title="Open filters to add more sources"
              >
                +{sourcePogs.hiddenCount}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Layout controls */}
      <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          title={`${cardsPerRow} per row`}
        >
          <div style={{ fontSize: '7.5pt', color: 'var(--text-muted)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            {cardsPerRow}/row
          </div>
          <input
            type="range"
            min="1"
            max="16"
            step="1"
            value={cardsPerRow}
            onChange={(e) => setCardsPerRow(parseInt(e.target.value, 10))}
            className="nuke-range nuke-range-accent"
            style={{ width: '110px' }}
          />
          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setThumbFitMode('square');
              }}
              style={{
                padding: '2px 8px',
                fontSize: '7.5pt',
                border: '1px solid var(--border)',
                background: thumbFitMode === 'square' ? 'var(--grey-600)' : 'var(--grey-200)',
                color: thumbFitMode === 'square' ? 'var(--white)' : 'var(--text)',
                cursor: 'pointer',
                borderRadius: '999px',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                transition: 'all 0.15s ease',
              }}
              title="Square thumbnails"
            >
              1:1
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setThumbFitMode('original');
              }}
              style={{
                padding: '2px 8px',
                fontSize: '7.5pt',
                border: '1px solid var(--border)',
                background: thumbFitMode === 'original' ? 'var(--grey-600)' : 'var(--grey-200)',
                color: thumbFitMode === 'original' ? 'var(--white)' : 'var(--text)',
                cursor: 'pointer',
                borderRadius: '999px',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                transition: 'all 0.15s ease',
              }}
              title="Original aspect (letterbox)"
            >
              ORIG
            </button>
          </div>
        </div>
        <label
          title="When on, filters and sort are restored when you come back. When off (default), every visit starts with no filters."
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '7.5pt',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            marginLeft: '8px',
          }}
        >
          <input
            type="checkbox"
            checked={rememberFilters}
            onChange={(e) => {
              e.stopPropagation();
              const v = e.target.checked;
              setRememberFilters(v);
              try {
                localStorage.setItem(REMEMBER_FILTERS_KEY, v ? 'true' : 'false');
              } catch { /* ignore */ }
              if (!v) clearPersistedFiltersAndSort();
            }}
            style={{ width: '11px', height: '11px', cursor: 'pointer' }}
          />
          Keep filters
        </label>
        {activeFilterCount > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFilters(DEFAULT_FILTERS);
              setSearchText('');
            }}
            style={{
              padding: '2px 8px',
              fontSize: '7.5pt',
              border: '1px solid var(--border)',
              background: 'var(--grey-200)',
              color: 'var(--text)',
              cursor: 'pointer',
              borderRadius: '2px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontWeight: 700,
              transition: 'background 0.15s ease',
            }}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
};

export default React.memo(FeedStatsBar);
