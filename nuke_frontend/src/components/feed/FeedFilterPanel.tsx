import React from 'react';
import type { FilterState, SortBy, SortDirection } from '../../types/feedTypes';
import { LOCATION_FAVORITES_KEY, DEFAULT_FILTERS, clearPersistedFiltersAndSort } from '../../lib/filterPersistence';
import { looksLikeHttpError } from '../../lib/sourceClassification';

export type StatsPanelKind = 'vehicles' | 'value' | 'for_sale' | 'sold_today' | 'auctions';

export interface SourcePog {
  key: string;
  domain: string;
  title: string;
  included: boolean;
  id: string;
  url: string;
  count: number;
}

export interface DisplayStats {
  totalVehicles: number;
  totalValue: number;
  marketInterestValue: number;
  rnmVehicleCount: number;
  vehiclesAddedToday: number;
  avgValue: number;
  forSaleCount: number;
  activeAuctions: number;
  salesCountToday?: number;
  salesVolume?: number;
}

export interface FeedFilterPanelProps {
  filterPanelRef: React.RefObject<HTMLDivElement | null>;
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  hasActiveFilters: boolean;
  activeFilterCount: number;
  searchText: string;
  setSearchText: (s: string) => void;
  debouncedSearchText: string;
  displayStats: DisplayStats;
  salesByPeriod: { count: number; volume: number; label: string };
  sourcePogs: { all: SourcePog[]; selected: SourcePog[]; hiddenCount: number };
  sourceCounts: Record<string, number>;
  activeSources: Array<{ id: string; domain: string; source_name: string; url: string; [key: string]: any }>;
  sourceSearchText: string;
  setSourceSearchText: (s: string) => void;
  includedSources: Record<string, boolean>;
  setSourceIncluded: (kind: string, included: boolean) => void;
  makeSearchText: string;
  setMakeSearchText: (s: string) => void;
  showMakeSuggestions: boolean;
  setShowMakeSuggestions: (b: boolean) => void;
  makeSuggestionIndex: number;
  setMakeSuggestionIndex: (n: number) => void;
  availableMakes: string[];
  makeInputRef: React.RefObject<HTMLInputElement | null>;
  modelSearchText: string;
  setModelSearchText: (s: string) => void;
  showModelSuggestions: boolean;
  setShowModelSuggestions: (b: boolean) => void;
  modelSuggestionIndex: number;
  setModelSuggestionIndex: (n: number) => void;
  availableModels: string[];
  availableBodyStyles: string[];
  modelInputRef: React.RefObject<HTMLInputElement | null>;
  collapsedSections: Record<string, boolean>;
  toggleCollapsedSection: (section: string) => void;
  setShowFilters: (b: boolean) => void;
  setFilterBarMinimized: (b: boolean) => void;
  cardsPerRow: number;
  setCardsPerRow: (n: number) => void;
  rememberFilters: boolean;
  setRememberFilters: (b: boolean) => void;
  currentZip: string;
  setCurrentZip: (s: string) => void;
  currentRadius: number;
  setCurrentRadius: (n: number) => void;
  locationFavorites: Array<{ zipCode: string; radiusMiles: number; label?: string }>;
  setLocationFavorites: React.Dispatch<React.SetStateAction<Array<{ zipCode: string; radiusMiles: number; label?: string }>>>;
  toggleForSale: () => void;
  openStatsPanel: (kind: StatsPanelKind) => void;
  formatCurrency: (value: number) => string;
  faviconUrl: (domain: string) => string;
  domainGradient: (domain: string) => string;
  domainToFilterKey: (domain: string) => string;
  setShowRecentlyAddedPanel: (b: boolean) => void;
  setShowActiveAuctionsPanel: (b: boolean) => void;
  sortBy: SortBy;
  setSortBy: (s: any) => void;
  sortDirection: SortDirection;
  setSortDirection: (d: SortDirection) => void;
  statsPanel: StatsPanelKind | null;
}

const FeedFilterPanel: React.FC<FeedFilterPanelProps> = ({
  filterPanelRef,
  filters, setFilters,
  hasActiveFilters, activeFilterCount,
  searchText, setSearchText, debouncedSearchText,
  displayStats, salesByPeriod,
  sourcePogs, sourceCounts, activeSources,
  sourceSearchText, setSourceSearchText,
  includedSources, setSourceIncluded,
  makeSearchText, setMakeSearchText,
  showMakeSuggestions, setShowMakeSuggestions,
  makeSuggestionIndex, setMakeSuggestionIndex,
  availableMakes, makeInputRef,
  modelSearchText, setModelSearchText,
  showModelSuggestions, setShowModelSuggestions,
  modelSuggestionIndex, setModelSuggestionIndex,
  availableModels, availableBodyStyles, modelInputRef,
  collapsedSections, toggleCollapsedSection,
  setShowFilters, setFilterBarMinimized,
  cardsPerRow, setCardsPerRow,
  rememberFilters, setRememberFilters,
  currentZip, setCurrentZip,
  currentRadius, setCurrentRadius,
  locationFavorites, setLocationFavorites,
  toggleForSale, openStatsPanel,
  formatCurrency, faviconUrl, domainGradient, domainToFilterKey,
  setShowRecentlyAddedPanel, setShowActiveAuctionsPanel,
  sortBy, setSortBy, sortDirection, setSortDirection,
  statsPanel,
}) => {
  return (
          <div ref={filterPanelRef} style={{
            background: 'var(--white)',
            border: '1px solid var(--border)',
            marginBottom: '16px',
            fontSize: '11px',
            scrollMarginTop: 'var(--header-height, 40px)'
          }}>
            {/* Compact stats bar */}
            <div style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              padding: '5px 8px',
              background: 'var(--grey-100)',
              borderBottom: '1px solid var(--border)',
              fontFamily: 'monospace',
              fontSize: '9px',
              flexWrap: 'wrap'
            }}>
              <span
                title="Total visible public vehicles in the feed (excludes pending + non-vehicle items)"
                style={{
                  fontFamily: 'monospace',
                  fontSize: '9px',
                  color: 'var(--text)'
                }}
              >
                <b>{displayStats.totalVehicles.toLocaleString()}</b> veh
              </span>
              {displayStats.vehiclesAddedToday > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowRecentlyAddedPanel(true);
                    }}
                    title="View recently added vehicles analytics"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      margin: 0,
                      color: 'var(--success)',
                      fontWeight: 900,
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '9px',
                    }}
                  >
                    +{displayStats.vehiclesAddedToday} today
                  </button>
                </>
              )}
              <span style={{ opacity: 0.3 }}>|</span>
              <span
                title={displayStats.marketInterestValue > 0
                  ? `Realized: ${formatCurrency(displayStats.totalValue)}\nMarket Interest: ${formatCurrency(displayStats.marketInterestValue)} (${displayStats.rnmVehicleCount} reserve-not-met)`
                  : 'Total portfolio value (best-known per vehicle)'
                }
                style={{
                  fontFamily: 'monospace',
                  fontSize: '9px',
                  color: 'var(--text)',
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: '3px',
                }}
              >
                <b>{formatCurrency(displayStats.totalValue)}</b>
                {displayStats.marketInterestValue > 0 && (
                  <span style={{ color: 'var(--warning)', fontSize: '8px', fontWeight: 500 }}>
                    +{formatCurrency(displayStats.marketInterestValue)}
                  </span>
                )}
              </span>
              {displayStats.forSaleCount > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
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
                      fontFamily: 'monospace',
                      fontSize: '9px',
                      color: filters.forSale ? 'var(--success)' : 'var(--text)',
                      fontWeight: filters.forSale ? 700 : 400,
                    }}
                  >
                    <b>{displayStats.forSaleCount.toLocaleString()}</b> for sale
                  </button>
                </>
              )}
              {salesByPeriod.count > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
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
                      fontFamily: 'monospace',
                      fontSize: '9px',
                      color: statsPanel === 'sold_today' ? 'var(--purple, #7c3aed)' : 'var(--text)',
                      fontWeight: statsPanel === 'sold_today' ? 700 : 400,
                    }}
                  >
                    <b>{salesByPeriod.count.toLocaleString()}</b> sold {salesByPeriod.label}
                  </button>
                </>
              )}
              {displayStats.activeAuctions > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowActiveAuctionsPanel(true);
                    }}
                    title="Live auctions with countdown timers, bid counts, and market analytics. Click to open."
                    style={{
                      border: 'none',
                      background: 'var(--error)',
                      padding: '2px 8px',
                      margin: 0,
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '9px',
                      color: 'var(--bg)',
                      borderRadius: 0,
                      fontWeight: 700,
                      animation: 'pulse 2s infinite',
                    }}
                  >
                    LIVE
                  </button>
                </>
              )}
              {(hasActiveFilters || debouncedSearchText) && displayStats.avgValue > 0 && displayStats.totalVehicles > 1 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <span
                    title="Average value across current filtered set"
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '9px',
                      color: 'var(--text-muted)'
                    }}
                  >
                    <b>{formatCurrency(displayStats.avgValue)}</b> avg
                  </span>
                </>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  title={`${cardsPerRow} per row`}
                >
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
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
                    style={{ width: '80px' }}
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  setShowFilters(false);
                  setFilterBarMinimized(true);
                }}
                style={{
                  padding: '2px 6px',
                  fontSize: '9px',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'Arial, sans-serif'
                }}
              >
                HIDE
              </button>
            </div>

            {/* Unified filter buttons row */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
              padding: '6px',
              borderBottom: '1px solid var(--border)'
            }}>
              {/* Year filter button */}
              <button
                onClick={() => toggleCollapsedSection('yearFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '9px',
                  background: !collapsedSections.yearFilters ? 'var(--grey-600)' : (filters.yearMin || filters.yearMax) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.yearFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.yearFilters || filters.yearMin || filters.yearMax) ? 700 : 400,
                  border: !collapsedSections.yearFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {filters.yearMin && filters.yearMax ? `${filters.yearMin}-${filters.yearMax}` : 'YEAR'}
              </button>
              
              {/* Make filter button */}
              <button
                onClick={() => toggleCollapsedSection('makeFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '9px',
                  background: !collapsedSections.makeFilters ? 'var(--grey-600)' : filters.makes.length > 0 ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.makeFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.makeFilters || filters.makes.length > 0) ? 700 : 400,
                  border: !collapsedSections.makeFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {filters.makes.length > 0 ? `MAKE: ${filters.makes.join(', ')}` : 'MAKE'}
              </button>

              {/* Model filter button */}
              <button
                onClick={() => toggleCollapsedSection('modelFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '9px',
                  background: !collapsedSections.modelFilters ? 'var(--grey-600)' : (filters.models?.length > 0) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.modelFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.modelFilters || filters.models?.length > 0) ? 700 : 400,
                  border: !collapsedSections.modelFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {filters.models?.length > 0 ? `MODEL: ${filters.models.join(', ')}` : 'MODEL'}
              </button>

              {/* Price button - combines sort and filter */}
              <button
                onClick={() => toggleCollapsedSection('priceFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '9px',
                  background: !collapsedSections.priceFilters ? 'var(--grey-600)' : ((filters.priceMin || filters.priceMax) || (sortBy === 'price_high' || sortBy === 'price_low')) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.priceFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.priceFilters || (filters.priceMin || filters.priceMax) || (sortBy === 'price_high' || sortBy === 'price_low')) ? 700 : 400,
                  border: !collapsedSections.priceFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {(() => {
                  if (filters.priceMin || filters.priceMax) {
                    return `$${filters.priceMin ? (filters.priceMin/1000).toFixed(0) + 'k' : '?'}-${filters.priceMax ? (filters.priceMax/1000).toFixed(0) + 'k' : '?'}`;
                  }
                  if (sortBy === 'price_high') return 'PRICE (HIGH)';
                  if (sortBy === 'price_low') return 'PRICE (LOW)';
                  return 'PRICE';
                })()}
              </button>
              
              {/* Location filter button */}
              <button
                onClick={() => toggleCollapsedSection('locationFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '9px',
                  background: !collapsedSections.locationFilters ? 'var(--grey-600)' : ((filters.locations && filters.locations.length > 0) || filters.zipCode) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.locationFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.locationFilters || (filters.locations && filters.locations.length > 0) || filters.zipCode) ? 700 : 400,
                  border: !collapsedSections.locationFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {filters.locations && filters.locations.length > 0 
                  ? `${filters.locations.length} LOC${filters.locations.length > 1 ? 'S' : ''}`
                  : filters.zipCode
                    ? filters.zipCode
                    : 'LOCATION'}
              </button>
              
              {/* Type filter button (body style) */}
              <button
                onClick={() => toggleCollapsedSection('typeFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '9px',
                  background: !collapsedSections.typeFilters ? 'var(--grey-600)' : (filters.bodyStyles.length > 0 || filters.is4x4) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.typeFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.typeFilters || filters.bodyStyles.length > 0 || filters.is4x4) ? 700 : 400,
                  border: !collapsedSections.typeFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {filters.bodyStyles.length > 0 || filters.is4x4
                  ? `TYPE: ${[...filters.bodyStyles, filters.is4x4 ? '4X4' : ''].filter(Boolean).join(', ')}`
                  : 'TYPE'}
              </button>
              
              {/* Sources button */}
              <button
                onClick={() => toggleCollapsedSection('sourcePogs')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '9px',
                  background: !collapsedSections.sourcePogs ? 'var(--grey-600)' : sourcePogs.selected.length < sourcePogs.all.length ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.sourcePogs ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.sourcePogs || sourcePogs.selected.length < sourcePogs.all.length) ? 700 : 400,
                  border: !collapsedSections.sourcePogs ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                SOURCES: {sourcePogs.selected.length}/{sourcePogs.all.length}
              </button>
              
              {/* Status filters button */}
              <button
                onClick={() => toggleCollapsedSection('statusFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '9px',
                  background: !collapsedSections.statusFilters ? 'var(--grey-600)' : (filters.forSale || filters.hideSold || filters.showPending || filters.privateParty || filters.dealer) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.statusFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.statusFilters || filters.forSale || filters.hideSold || filters.showPending || filters.privateParty || filters.dealer) ? 700 : 400,
                  border: !collapsedSections.statusFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                STATUS
              </button>

              {/* Reset button */}
              {activeFilterCount > 0 && (
                <button
                  onClick={() => {
                    setFilters(DEFAULT_FILTERS);
                    setSearchText('');
                  }}
                  style={{
                    marginLeft: '6px',
                    padding: '3px 7px',
                    fontSize: '9px',
                    border: '2px solid var(--border)',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'Arial, sans-serif'
                  }}
                >
                  RESET
                </button>
              )}
            </div>
            
            {/* Feed search CLI — type "1980 ford pickup" to auto-fill filters */}
            <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder='TRY "1980 CHEVY TRUCK" OR "PORSCHE 911 UNDER $100K"'
                style={{
                  width: '100%',
                  border: '1px solid var(--border)',
                  borderRadius: 0,
                  background: 'var(--white)',
                  padding: '4px 8px',
                  fontSize: '10px',
                  fontFamily: "'Courier New', monospace",
                  outline: 'none',
                }}
              />
            </div>

            {/* Expanded filter controls - shown when sections are open */}
            <div style={{ padding: '6px', position: 'sticky', top: 'var(--header-height, 40px)', zIndex: 50, background: 'var(--white)', maxHeight: 'calc(100vh - var(--header-height, 40px) - 60px)', overflowY: 'auto' }}>
              {/* Year filters - expanded */}
              {!collapsedSections.yearFilters && (
                <div 
                  style={{
                    marginBottom: '8px',
                    padding: '6px',
                    background: 'var(--grey-50)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'row',
                    gap: '8px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    minWidth: 0
                  }}
                >
                  {/* Year range input */}
                  <div style={{
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center',
                    flexShrink: 0
                  }}>
                    <input
                      type="number"
                      placeholder="Min year"
                      value={filters.yearMin || ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value) : null;
                        setFilters({...filters, yearMin: val});
                      }}
                      style={{
                        width: '80px',
                        padding: '3px 5px',
                        border: '1px solid var(--border)',
                        fontSize: '9px',
                        fontFamily: 'Arial, sans-serif'
                      }}
                    />
                    <span style={{ fontSize: '9px' }}>to</span>
                    <input
                      type="number"
                      placeholder="Max year"
                      value={filters.yearMax || ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value) : null;
                        setFilters({...filters, yearMax: val});
                      }}
                      style={{
                        width: '80px',
                        padding: '3px 5px',
                        border: '1px solid var(--border)',
                        fontSize: '9px',
                        fontFamily: 'Arial, sans-serif'
                      }}
                    />
                    {(filters.yearMin || filters.yearMax) && (
                      <button
                        onClick={() => setFilters({...filters, yearMin: null, yearMax: null})}
                        className="button-win95"
                        style={{ padding: '3px 7px', fontSize: '9px' }}
                      >
                        CLEAR
                      </button>
                    )}
                  </div>

                  {/* Quick year buttons - only visible if container is wide enough */}
                  <div 
                    className="year-quick-buttons"
                    style={{ 
                      display: 'flex', 
                      flexWrap: 'wrap', 
                      gap: '4px',
                      overflow: 'hidden',
                      minWidth: 0,
                      flex: '1 1 auto'
                    }}
                  >
                    {[
                      { label: '64-91', min: 1964, max: 1991 },
                      { label: '73-87', min: 1973, max: 1987 },
                      { label: '67-72', min: 1967, max: 1972 },
                      { label: '87-00', min: 1987, max: 2000 },
                      { label: '60s', min: 1960, max: 1969 },
                      { label: '70s', min: 1970, max: 1979 },
                      { label: '80s', min: 1980, max: 1989 },
                      { label: '90s', min: 1990, max: 1999 },
                    ].map(range => {
                      const isActive = filters.yearMin === range.min && filters.yearMax === range.max;
                      return (
                        <button
                          key={range.label}
                          onClick={() => {
                            if (isActive) {
                              setFilters({ ...filters, yearMin: null, yearMax: null });
                            } else {
                              setFilters({ ...filters, yearMin: range.min, yearMax: range.max });
                            }
                          }}
                          className="button-win95"
                          style={{
                            padding: '3px 7px',
                            fontSize: '9px',
                            background: isActive ? 'var(--grey-600)' : 'var(--white)',
                            color: isActive ? 'var(--white)' : 'var(--text)',
                            fontWeight: isActive ? 700 : 400,
                            border: isActive ? '1px solid var(--grey-600)' : '1px solid var(--border)',
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                          }}
                          title={`Year: ${range.min}-${range.max}`}
                        >
                          {range.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Sources list - expanded */}
              {!collapsedSections.sourcePogs && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  fontSize: '9px'
                }}>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                    <button
                      onClick={() => {
                        setFilters((prev) => ({
                          ...prev,
                          hideDealerListings: false,
                          hideCraigslist: false,
                          hideDealerSites: false,
                          hideKsl: false,
                          hideBat: false,
                          hideClassic: false,
                          hiddenSources: []
                        }));
                      }}
                      className="button-win95"
                      style={{ padding: '2px 6px', fontSize: '9px' }}
                    >
                      all
                    </button>
                    <button
                      onClick={() => {
                        setFilters((prev) => ({
                          ...prev,
                          hideDealerListings: true,
                          hideCraigslist: true,
                          hideDealerSites: true,
                          hideKsl: true,
                          hideBat: true,
                          hideClassic: true,
                          hiddenSources: sourcePogs.all.map(p => p.key)
                        }));
                      }}
                      className="button-win95"
                      style={{ padding: '2px 6px', fontSize: '9px' }}
                    >
                      none
                    </button>
                    <input
                      type="text"
                      placeholder="search sources..."
                      value={sourceSearchText}
                      onChange={(e) => {
                        const text = e.target.value;
                        setSourceSearchText(text);
                        
                        // Auto-apply filters when searching for specific sources
                        const searchLower = text.toLowerCase().trim();
                        if (searchLower.includes('bring') || searchLower.includes('bat')) {
                          // Filter to only BaT sources
                          const allOtherKeys = sourcePogs.all
                            .filter(p => p.key !== 'bat')
                            .map(p => p.key);
                          
                          
                          setFilters((prev) => {
                            const newFilters = {
                              ...prev,
                              hideDealerListings: true,
                              hideCraigslist: true,
                              hideDealerSites: true,
                              hideKsl: true,
                              hideBat: false, // Keep BaT visible
                              hideClassic: true,
                              hiddenSources: allOtherKeys
                            };
                            // filters updated
                            return newFilters;
                          });
                        } else if (searchLower.includes('craigslist') || searchLower.includes('cl')) {
                          // Filter to only Craigslist
                          const allOtherKeys = sourcePogs.all
                            .filter(p => p.key !== 'craigslist')
                            .map(p => p.key);
                          setFilters((prev) => ({
                            ...prev,
                            hideDealerListings: true,
                            hideCraigslist: false,
                            hideDealerSites: true,
                            hideKsl: true,
                            hideBat: true,
                            hideClassic: true,
                            hiddenSources: allOtherKeys
                          }));
                        } else if (searchLower.includes('ksl')) {
                          // Filter to only KSL
                          const allOtherKeys = sourcePogs.all
                            .filter(p => p.key !== 'ksl')
                            .map(p => p.key);
                          setFilters((prev) => ({
                            ...prev,
                            hideDealerListings: true,
                            hideCraigslist: true,
                            hideDealerSites: true,
                            hideKsl: false,
                            hideBat: true,
                            hideClassic: true,
                            hiddenSources: allOtherKeys
                          }));
                        } else if (searchLower.includes('classic')) {
                          // Filter to only Classic.com
                          const allOtherKeys = sourcePogs.all
                            .filter(p => p.key !== 'classic')
                            .map(p => p.key);
                          setFilters((prev) => ({
                            ...prev,
                            hideDealerListings: true,
                            hideCraigslist: true,
                            hideDealerSites: true,
                            hideKsl: true,
                            hideBat: true,
                            hideClassic: false,
                            hiddenSources: allOtherKeys
                          }));
                        } else if (!text.trim()) {
                          // Clear search - show all sources
                          setFilters((prev) => ({
                            ...prev,
                            hideDealerListings: false,
                            hideCraigslist: false,
                            hideDealerSites: false,
                            hideKsl: false,
                            hideBat: false,
                            hideClassic: false,
                            hiddenSources: []
                          }));
                        } else if (searchLower.length >= 3) {
                          // Dynamic source search - filter to sources matching the search text
                          const matchingSourceKeys = sourcePogs.all
                            .filter(p =>
                              p.title.toLowerCase().includes(searchLower) ||
                              p.domain.toLowerCase().includes(searchLower) ||
                              p.key.toLowerCase().includes(searchLower)
                            )
                            .map(p => p.key);

                          if (matchingSourceKeys.length > 0) {
                            // Hide all sources that DON'T match
                            const nonMatchingKeys = sourcePogs.all
                              .filter(p => !matchingSourceKeys.includes(p.key))
                              .map(p => p.key);

                            setFilters((prev) => ({
                              ...prev,
                              hideDealerListings: !matchingSourceKeys.some(k => k.includes('dealer')),
                              hideCraigslist: !matchingSourceKeys.includes('craigslist'),
                              hideDealerSites: !matchingSourceKeys.some(k => k.includes('dealer')),
                              hideKsl: !matchingSourceKeys.includes('ksl'),
                              hideBat: !matchingSourceKeys.includes('bat'),
                              hideClassic: !matchingSourceKeys.includes('classic'),
                              hiddenSources: nonMatchingKeys
                            }));
                          }
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '2px 6px',
                        fontSize: '9px',
                        border: '1px solid var(--border)',
                        fontFamily: 'Arial, sans-serif',
                        minWidth: '80px'
                      }}
                    />
                    {sourceSearchText && (
                      <button
                        onClick={() => setSourceSearchText('')}
                        className="button-win95"
                        style={{ padding: '2px 6px', fontSize: '9px' }}
                      >
                        x
                      </button>
                    )}
                  </div>
                  <div style={{ 
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '2px',
                    maxHeight: '200px',
                    overflowY: 'auto'
                  }}>
                    {sourcePogs.all
                      .filter((p) => {
                        const matches = !sourceSearchText || 
                          p.title.toLowerCase().includes(sourceSearchText.toLowerCase()) ||
                          p.domain.toLowerCase().includes(sourceSearchText.toLowerCase()) ||
                          p.key.toLowerCase().includes(sourceSearchText.toLowerCase());
                        
                        return matches;
                      })
                      .map((p, idx) => (
                      <label
                        key={p.id ? `source-${p.id}` : `source-${p.domain}-${idx}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '2px 4px',
                          cursor: 'pointer',
                          background: p.included ? 'var(--white)' : 'transparent',
                          borderRadius: 0
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={p.included}
                          onChange={() => setSourceIncluded(p.key, !p.included)}
                          style={{ margin: 0 }}
                        />
                        <img
                          src={faviconUrl(p.domain)}
                          alt=""
                          width={12}
                          height={12}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          style={{
                            width: '12px',
                            height: '12px',
                            opacity: p.included ? 1 : 0.4
                          }}
                        />
                        <span style={{ flex: 1, opacity: p.included ? 1 : 0.6 }}>
                          {p.title}
                        </span>
                        <span style={{ opacity: 0.5, fontFamily: 'monospace' }}>
                          {p.count.toLocaleString()}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Make filter - inline badge input */}
              {!collapsedSections.makeFilters && (() => {
                // Compute filtered suggestions for keyboard nav
                const makeSuggestions = availableMakes
                  .filter(m =>
                    m.toLowerCase().startsWith(makeSearchText.toLowerCase()) &&
                    !filters.makes.includes(m)
                  )
                  .slice(0, 8);

                return (
                  <div style={{
                    marginBottom: '8px',
                    position: 'relative'
                  }}>
                    {/* Inline badge input container */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 6px',
                        background: 'var(--white)',
                        border: '1px solid var(--border)',
                        borderRadius: 0,
                        minHeight: '24px',
                        cursor: 'text'
                      }}
                      onClick={() => makeInputRef.current?.focus()}
                    >
                      {/* Selected make badges inline */}
                      {filters.makes.map((make) => (
                        <span
                          key={make}
                          style={{
                            padding: '1px 5px',
                            background: 'var(--grey-600)',
                            color: 'var(--white)',
                            fontSize: '9px',
                            borderRadius: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {make}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilters({...filters, makes: filters.makes.filter(m => m !== make)});
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--white)',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: '9px',
                              lineHeight: 1,
                              opacity: 0.8
                            }}
                          >
                            x
                          </button>
                        </span>
                      ))}
                      {/* Text input */}
                      <input
                        ref={makeInputRef}
                        type="text"
                        value={makeSearchText}
                        onChange={(e) => {
                          setMakeSearchText(e.target.value);
                          setShowMakeSuggestions(true);
                          setMakeSuggestionIndex(-1);
                        }}
                        onFocus={() => setShowMakeSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowMakeSuggestions(false), 150)}
                        onKeyDown={(e) => {
                          // Arrow down - move selection down
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            if (makeSuggestions.length > 0) {
                              setMakeSuggestionIndex(prev =>
                                prev < makeSuggestions.length - 1 ? prev + 1 : 0
                              );
                            }
                          }
                          // Arrow up - move selection up
                          else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            if (makeSuggestions.length > 0) {
                              setMakeSuggestionIndex(prev =>
                                prev > 0 ? prev - 1 : makeSuggestions.length - 1
                              );
                            }
                          }
                          // Enter - select highlighted or top match, or go to model
                          else if (e.key === 'Enter') {
                            e.preventDefault();
                            if (makeSearchText.trim()) {
                              // Select highlighted suggestion or top match
                              const makeToAdd = makeSuggestionIndex >= 0 && makeSuggestions[makeSuggestionIndex]
                                ? makeSuggestions[makeSuggestionIndex]
                                : makeSuggestions[0] || makeSearchText.trim();

                              if (!filters.makes.includes(makeToAdd)) {
                                setFilters({...filters, makes: [...filters.makes, makeToAdd]});
                              }
                              setMakeSearchText('');
                              setShowMakeSuggestions(false);
                              setMakeSuggestionIndex(-1);
                            } else if (filters.makes.length > 0) {
                              // Empty input + makes selected = focus model input
                              setTimeout(() => modelInputRef.current?.focus(), 50);
                            }
                          }
                          // Backspace when empty - remove last badge
                          else if (e.key === 'Backspace' && !makeSearchText && filters.makes.length > 0) {
                            setFilters({...filters, makes: filters.makes.slice(0, -1)});
                          }
                          // Escape - close dropdown
                          else if (e.key === 'Escape') {
                            setShowMakeSuggestions(false);
                            setMakeSuggestionIndex(-1);
                          }
                        }}
                        style={{
                          flex: 1,
                          minWidth: '60px',
                          border: 'none',
                          outline: 'none',
                          padding: '2px 0',
                          fontSize: '9px',
                          fontFamily: 'Arial, sans-serif',
                          background: 'transparent'
                        }}
                      />
                    </div>

                    {/* Autocomplete dropdown */}
                    {showMakeSuggestions && makeSearchText.length > 0 && makeSuggestions.length > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        maxHeight: '150px',
                        overflowY: 'auto',
                        background: 'var(--white)',
                        border: '1px solid var(--border)',
                        borderTop: 'none',
                        zIndex: 100,
                        border: '2px solid var(--border)'
                      }}>
                        {makeSuggestions.map((make, idx) => (
                          <div
                            key={make}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setFilters({...filters, makes: [...filters.makes, make]});
                              setMakeSearchText('');
                              setShowMakeSuggestions(false);
                              setMakeSuggestionIndex(-1);
                            }}
                            onMouseEnter={() => setMakeSuggestionIndex(idx)}
                            style={{
                              padding: '4px 8px',
                              cursor: 'pointer',
                              fontSize: '9px',
                              background: idx === makeSuggestionIndex ? 'var(--grey-200)' : 'var(--white)',
                              borderBottom: '1px solid var(--grey-100)'
                            }}
                          >
                            {make}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Model filter - inline badge input (shows when model button is open or models are selected) */}
              {(!collapsedSections.modelFilters || (filters.models?.length ?? 0) > 0) && filters.makes.length === 0 && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px 8px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  fontSize: '9px',
                  color: 'var(--text-muted)',
                  fontFamily: 'Arial, sans-serif',
                  letterSpacing: '0.5px',
                }}>
                  SELECT A MAKE FIRST
                </div>
              )}
              {(!collapsedSections.modelFilters || (filters.models?.length ?? 0) > 0) && filters.makes.length > 0 && (() => {
                // Fuzzy matching helper
                const normalize = (s: string) => s.toLowerCase().replace(/[-\/\s]/g, '');
                const searchLower = modelSearchText.toLowerCase().trim();
                const searchNorm = normalize(searchLower);

                // Compute filtered suggestions with fuzzy matching
                const modelSuggestions = availableModels
                  .filter(m => {
                    if (filters.models?.includes(m)) return false;
                    if (!searchLower) return false;
                    const modelNorm = normalize(m);
                    const modelLower = m.toLowerCase();
                    // Normalized match (c10 = c-10)
                    if (modelNorm.includes(searchNorm)) return true;
                    // Contains match
                    if (modelLower.includes(searchLower)) return true;
                    // Category matching
                    const truckTerms = ['truck', 'pickup', 'c10', 'c20', 'c30', 'k10', 'k20', 'k5'];
                    if (truckTerms.some(t => searchLower.includes(t))) {
                      if (truckTerms.some(t => modelLower.includes(t))) return true;
                    }
                    return false;
                  })
                  .slice(0, 8);

                return (
                  <div style={{
                    marginBottom: '8px',
                    position: 'relative'
                  }}>
                    {/* Inline badge input container */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 6px',
                        background: 'var(--white)',
                        border: '1px solid var(--border)',
                        borderRadius: 0,
                        minHeight: '24px',
                        cursor: 'text'
                      }}
                      onClick={() => modelInputRef.current?.focus()}
                    >
                      {/* Selected model badges inline */}
                      {(filters.models || []).map((model) => (
                        <span
                          key={model}
                          style={{
                            padding: '1px 5px',
                            background: 'var(--grey-600)',
                            color: 'var(--white)',
                            fontSize: '9px',
                            borderRadius: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {model}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilters({...filters, models: filters.models.filter(m => m !== model)});
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--white)',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: '9px',
                              lineHeight: 1,
                              opacity: 0.8
                            }}
                          >
                            x
                          </button>
                        </span>
                      ))}
                      {/* Text input */}
                      <input
                        ref={modelInputRef}
                        type="text"
                        value={modelSearchText}
                        onChange={(e) => {
                          setModelSearchText(e.target.value);
                          setShowModelSuggestions(true);
                          setModelSuggestionIndex(-1);
                        }}
                        onFocus={() => setShowModelSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowModelSuggestions(false), 150)}
                        onKeyDown={(e) => {
                          // Arrow down
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            if (modelSuggestions.length > 0) {
                              setModelSuggestionIndex(prev =>
                                prev < modelSuggestions.length - 1 ? prev + 1 : 0
                              );
                            }
                          }
                          // Arrow up
                          else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            if (modelSuggestions.length > 0) {
                              setModelSuggestionIndex(prev =>
                                prev > 0 ? prev - 1 : modelSuggestions.length - 1
                              );
                            }
                          }
                          // Enter - select highlighted or top match
                          else if (e.key === 'Enter') {
                            e.preventDefault();
                            if (modelSearchText.trim()) {
                              const modelToAdd = modelSuggestionIndex >= 0 && modelSuggestions[modelSuggestionIndex]
                                ? modelSuggestions[modelSuggestionIndex]
                                : modelSuggestions[0] || modelSearchText.trim();

                              if (!filters.models?.includes(modelToAdd)) {
                                setFilters({...filters, models: [...(filters.models || []), modelToAdd]});
                              }
                              setModelSearchText('');
                              setShowModelSuggestions(false);
                              setModelSuggestionIndex(-1);
                            }
                          }
                          // Backspace when empty - remove last badge
                          else if (e.key === 'Backspace' && !modelSearchText && filters.models?.length > 0) {
                            setFilters({...filters, models: filters.models.slice(0, -1)});
                          }
                          // Escape
                          else if (e.key === 'Escape') {
                            setShowModelSuggestions(false);
                            setModelSuggestionIndex(-1);
                          }
                        }}
                        style={{
                          flex: 1,
                          minWidth: '60px',
                          border: 'none',
                          outline: 'none',
                          padding: '2px 0',
                          fontSize: '9px',
                          fontFamily: 'Arial, sans-serif',
                          background: 'transparent'
                        }}
                      />
                    </div>

                    {/* Autocomplete dropdown */}
                    {showModelSuggestions && modelSearchText.length > 0 && modelSuggestions.length > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        maxHeight: '150px',
                        overflowY: 'auto',
                        background: 'var(--white)',
                        border: '1px solid var(--border)',
                        borderTop: 'none',
                        zIndex: 100,
                        border: '2px solid var(--border)'
                      }}>
                        {modelSuggestions.map((model, idx) => (
                          <div
                            key={model}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setFilters({...filters, models: [...(filters.models || []), model]});
                              setModelSearchText('');
                              setShowModelSuggestions(false);
                              setModelSuggestionIndex(-1);
                            }}
                            onMouseEnter={() => setModelSuggestionIndex(idx)}
                            style={{
                              padding: '4px 8px',
                              cursor: 'pointer',
                              fontSize: '9px',
                              background: idx === modelSuggestionIndex ? 'var(--grey-200)' : 'var(--white)',
                              borderBottom: '1px solid var(--grey-100)'
                            }}
                          >
                            {model}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Type filter - expanded (body style) */}
              {!collapsedSections.typeFilters && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  fontSize: '9px'
                }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                    {[
                      { label: 'Car', values: ['Coupe', 'Sedan', 'Convertible', 'Hatchback', 'Wagon'] },
                      { label: 'Truck', values: ['Pickup', 'Truck'] },
                      { label: 'SUV', values: ['SUV'] },
                      { label: 'Van', values: ['Van', 'Minivan'] },
                      { label: 'Motorcycle', values: ['Motorcycle'] },
                      { label: 'RV', values: ['RV'] },
                      { label: 'Trailer', values: ['Trailer'] },
                      { label: 'Boat', values: ['Boat'] },
                      { label: 'Powersports', values: ['ATV', 'UTV', 'Snowmobile'] },
                    ].map(({ label, values }) => {
                      const isSelected = values.some(v => filters.bodyStyles.includes(v));
                      return (
                        <button
                          key={label}
                          onClick={() => {
                            if (isSelected) {
                              setFilters({...filters, bodyStyles: filters.bodyStyles.filter(bs => !values.includes(bs))});
                            } else {
                              setFilters({...filters, bodyStyles: [...filters.bodyStyles, ...values]});
                            }
                          }}
                          className="button-win95"
                          style={{
                            padding: '3px 10px',
                            fontSize: '9px',
                            background: isSelected ? 'var(--grey-600)' : 'var(--white)',
                            color: isSelected ? 'var(--white)' : 'var(--text)',
                            fontWeight: isSelected ? 700 : 400
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setFilters({...filters, is4x4: !filters.is4x4})}
                      className="button-win95"
                      style={{
                        padding: '3px 10px',
                        fontSize: '9px',
                        background: filters.is4x4 ? 'var(--grey-600)' : 'var(--white)',
                        color: filters.is4x4 ? 'var(--white)' : 'var(--text)',
                        fontWeight: filters.is4x4 ? 700 : 400
                      }}
                    >
                      4x4/4WD
                    </button>
                    {(filters.bodyStyles.length > 0 || filters.is4x4) && (
                      <button
                        onClick={() => setFilters({...filters, bodyStyles: [], is4x4: false})}
                        className="button-win95"
                        style={{ padding: '3px 6px', fontSize: '9px' }}
                      >
                        CLEAR
                      </button>
                    )}
                  </div>
                  {/* Specific body styles */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {(
                      (availableBodyStyles && availableBodyStyles.length > 0)
                        ? availableBodyStyles.slice(0, 30)
                        : ['Coupe', 'Sedan', 'Convertible', 'Wagon', 'Hatchback', 'Fastback', 'Roadster', 'Pickup', 'SUV', 'Van', 'Minivan', 'Motorcycle', 'RV', 'Trailer', 'Boat', 'ATV', 'UTV', 'Snowmobile']
                    ).map((style) => (
                      <button
                        key={style}
                        onClick={() => {
                          if (filters.bodyStyles.includes(style)) {
                            setFilters({...filters, bodyStyles: filters.bodyStyles.filter(bs => bs !== style)});
                          } else {
                            setFilters({...filters, bodyStyles: [...filters.bodyStyles, style]});
                          }
                        }}
                        className="button-win95"
                        style={{
                          padding: '2px 6px',
                          fontSize: '8px',
                          background: filters.bodyStyles.includes(style) ? 'var(--grey-500)' : 'var(--grey-100)',
                          color: filters.bodyStyles.includes(style) ? 'var(--white)' : 'var(--text-muted)'
                        }}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Price inputs - expanded */}
              {!collapsedSections.priceFilters && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'center',
                  flexWrap: 'wrap'
                }}>
                  {/* Sort direction toggle */}
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>SORT:</span>
                    <button
                      onClick={() => {
                        if (sortBy === 'price_high') {
                          setSortBy('price_low');
                          setSortDirection('asc');
                        } else if (sortBy === 'price_low') {
                          setSortBy(null);
                          setSortDirection('asc');
                        } else {
                          setSortBy('price_high');
                          setSortDirection('desc');
                        }
                      }}
                      className="button-win95"
                      style={{
                        padding: '3px 7px',
                        fontSize: '9px',
                        background: (sortBy === 'price_high' || sortBy === 'price_low') ? 'var(--grey-600)' : 'var(--white)',
                        color: (sortBy === 'price_high' || sortBy === 'price_low') ? 'var(--white)' : 'var(--text)',
                        fontWeight: (sortBy === 'price_high' || sortBy === 'price_low') ? 700 : 400,
                        border: (sortBy === 'price_high' || sortBy === 'price_low') ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                      }}
                    >
                      {sortBy === 'price_high' ? 'HIGHEST FIRST' : sortBy === 'price_low' ? 'LOWEST FIRST' : 'NONE'}
                    </button>
                  </div>

                  {/* Price range inputs */}
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>RANGE:</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="min"
                      value={filters.priceMin || ''}
                      onChange={(e) => setFilters({...filters, priceMin: e.target.value ? parseInt(e.target.value) : null})}
                      style={{
                        width: '70px',
                        padding: '3px 5px',
                        border: '1px solid var(--border)',
                        fontSize: '9px',
                        fontFamily: 'Arial, sans-serif'
                      }}
                    />
                    <span style={{ fontSize: '9px' }}>–</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="max"
                      value={filters.priceMax || ''}
                      onChange={(e) => setFilters({...filters, priceMax: e.target.value ? parseInt(e.target.value) : null})}
                      style={{
                        width: '70px',
                        padding: '3px 5px',
                        border: '1px solid var(--border)',
                        fontSize: '9px',
                        fontFamily: 'Arial, sans-serif'
                      }}
                    />
                    {(filters.priceMin || filters.priceMax) && (
                      <button
                        onClick={() => setFilters({...filters, priceMin: null, priceMax: null})}
                        className="button-win95"
                        style={{ padding: '3px 7px', fontSize: '9px' }}
                      >
                        CLEAR
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Location inputs - expanded */}
              {!collapsedSections.locationFilters && (() => {
                const saveLocationFavorites = (favs: Array<{ zipCode: string; radiusMiles: number; label?: string }>) => {
                  try {
                    localStorage.setItem(LOCATION_FAVORITES_KEY, JSON.stringify(favs));
                    setLocationFavorites(favs);
                  } catch (err) {
                    // Failed to save location favorites - silent
                  }
                };
                
                const addLocation = () => {
                  if (currentZip.length === 5 && /^\d+$/.test(currentZip)) {
                    const newLocation = { zipCode: currentZip, radiusMiles: currentRadius };
                    const updated = [...(filters.locations || []), newLocation];
                    setFilters({...filters, locations: updated, zipCode: currentZip, radiusMiles: currentRadius});
                  }
                };
                
                const addToFavorites = () => {
                  if (currentZip.length === 5 && /^\d+$/.test(currentZip)) {
                    // Check if already exists
                    const exists = locationFavorites.some(f => f.zipCode === currentZip && f.radiusMiles === currentRadius);
                    if (!exists) {
                      const label = prompt('Enter a name for this location (optional):');
                      const newFavorite = { 
                        zipCode: currentZip, 
                        radiusMiles: currentRadius,
                        label: label && label.trim() ? label.trim() : undefined
                      };
                      const updated = [...locationFavorites, newFavorite];
                      saveLocationFavorites(updated);
                    } else {
                      // Already in favorites — silently ignore
                    }
                  }
                };
                
                const removeLocation = (index: number) => {
                  const updated = filters.locations?.filter((_, i) => i !== index) || [];
                  setFilters({...filters, locations: updated});
                };
                
                const useFavorite = (fav: { zipCode: string; radiusMiles: number }) => {
                  setCurrentZip(fav.zipCode);
                  setCurrentRadius(fav.radiusMiles);
                  // Check if already in active locations
                  const isActive = filters.locations?.some(loc => loc.zipCode === fav.zipCode && loc.radiusMiles === fav.radiusMiles);
                  if (!isActive) {
                    const newLocation = { zipCode: fav.zipCode, radiusMiles: fav.radiusMiles };
                    const updated = [...(filters.locations || []), newLocation];
                    setFilters({...filters, locations: updated, zipCode: fav.zipCode, radiusMiles: fav.radiusMiles});
                  }
                };
                
                const toggleFavorite = (fav: { zipCode: string; radiusMiles: number }) => {
                  // Check if already in active locations
                  const isActive = filters.locations?.some(loc => loc.zipCode === fav.zipCode && loc.radiusMiles === fav.radiusMiles);
                  if (isActive) {
                    // Remove from active locations
                    const updated = filters.locations?.filter(loc => !(loc.zipCode === fav.zipCode && loc.radiusMiles === fav.radiusMiles)) || [];
                    setFilters({...filters, locations: updated});
                  } else {
                    // Add to active locations
                    const newLocation = { zipCode: fav.zipCode, radiusMiles: fav.radiusMiles };
                    const updated = [...(filters.locations || []), newLocation];
                    setFilters({...filters, locations: updated});
                  }
                };
                
                const removeFavorite = (fav: { zipCode: string; radiusMiles: number }, index: number) => {
                  const updated = locationFavorites.filter((_, i) => i !== index);
                  saveLocationFavorites(updated);
                  // Also remove from active locations if it's there
                  const activeUpdated = filters.locations?.filter(loc => !(loc.zipCode === fav.zipCode && loc.radiusMiles === fav.radiusMiles)) || [];
                  if (activeUpdated.length !== filters.locations?.length) {
                    setFilters({...filters, locations: activeUpdated});
                  }
                };
                
                return (
                  <div style={{
                    marginBottom: '8px',
                    padding: '6px',
                    background: 'var(--grey-50)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    {/* Single row: location input + active chips (same line) */}
                    <div style={{
                      display: 'flex',
                      gap: '4px',
                      alignItems: 'center',
                      flexWrap: 'wrap'
                    }}>
                      <input
                        type="text"
                        placeholder="ZIP"
                        value={currentZip}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                          setCurrentZip(val);
                        }}
                        maxLength={5}
                        style={{
                          width: '60px',
                          padding: '3px 5px',
                          border: '1px solid var(--border)',
                          fontSize: '9px',
                          fontFamily: 'Arial, sans-serif'
                        }}
                      />
                      <span style={{ fontSize: '9px' }}>WITHIN</span>
                      <select
                        value={currentRadius}
                        onChange={(e) => setCurrentRadius(Number(e.target.value))}
                        style={{
                          padding: '3px 5px',
                          border: '1px solid var(--border)',
                          fontSize: '9px',
                          fontFamily: 'Arial, sans-serif',
                          width: '80px',
                          background: 'var(--white)',
                          cursor: 'pointer'
                        }}
                      >
                        {[10, 25, 50, 100, 250, 500].map(radius => (
                          <option key={radius} value={radius}>
                            {radius}mi
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={addLocation}
                        className="button-win95"
                        style={{
                          padding: '3px 7px',
                          fontSize: '9px'
                        }}
                        disabled={currentZip.length !== 5}
                      >
                        add
                      </button>
                      <button
                        onClick={addToFavorites}
                        className="button-win95"
                        style={{
                          padding: '3px 7px',
                          fontSize: '9px'
                        }}
                        disabled={currentZip.length !== 5}
                        title="Save to favorites"
                      >
                        save
                      </button>
                      {/* Active locations inline on same row */}
                      {((filters.locations && filters.locations.length > 0) || (filters.zipCode && filters.zipCode.length === 5 && filters.radiusMiles > 0)) && (
                        <>
                          <span style={{ fontSize: '9px', marginLeft: '4px' }}>ACTIVE:</span>
                          {(filters.locations && filters.locations.length > 0
                            ? filters.locations
                            : [{ zipCode: filters.zipCode!, radiusMiles: filters.radiusMiles }]
                          ).map((loc, idx) => (
                            <button
                              key={loc.zipCode + '-' + loc.radiusMiles + '-' + idx}
                              onClick={() =>
                                filters.locations?.length
                                  ? removeLocation(idx)
                                  : setFilters({ ...filters, zipCode: '', radiusMiles: 0 })
                              }
                              className="button-win95"
                              style={{
                                padding: '2px 5px',
                                fontSize: '9px',
                                background: 'var(--grey-300)',
                                border: '1px solid var(--border)'
                              }}
                              title="Remove location"
                            >
                              {loc.zipCode} ({loc.radiusMiles}mi) ×
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                    
                    {/* Favorites */}
                    {locationFavorites.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '9px', fontWeight: 700 }}>FAVORITES:</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                          {locationFavorites.map((fav, idx) => {
                            const isActive = filters.locations?.some(loc => loc.zipCode === fav.zipCode && loc.radiusMiles === fav.radiusMiles);
                            return (
                              <div key={idx} style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                                <button
                                  onClick={() => toggleFavorite(fav)}
                                  className="button-win95"
                                  style={{
                                    padding: '2px 5px',
                                    fontSize: '9px',
                                    background: isActive ? 'var(--grey-600)' : 'var(--white)',
                                    color: isActive ? 'var(--white)' : 'var(--text)',
                                    fontWeight: isActive ? 700 : 400,
                                    border: isActive ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                                  }}
                                  title={isActive ? "Remove from active locations" : "Add to active locations"}
                                >
                                  {fav.label || fav.zipCode} ({fav.radiusMiles}mi)
                                </button>
                                <button
                                  onClick={() => removeFavorite(fav, idx)}
                                  className="button-win95"
                                  style={{
                                    padding: '2px 4px',
                                    fontSize: '8px',
                                    background: 'var(--grey-100)',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text-muted)'
                                  }}
                                  title="Remove from favorites"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Status checkboxes - expanded */}
              {!collapsedSections.statusFilters && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '4px'
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '9px' }}>
                    <input
                      type="checkbox"
                      checked={filters.forSale}
                      onChange={(e) => setFilters({...filters, forSale: e.target.checked})}
                    />
                    <span>FOR SALE ONLY</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '9px' }}>
                    <input
                      type="checkbox"
                      checked={filters.hideSold}
                      onChange={(e) => setFilters({ ...filters, hideSold: e.target.checked })}
                    />
                    <span>HIDE SOLD</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '9px' }}>
                    <input
                      type="checkbox"
                      checked={filters.showPending}
                      onChange={(e) => setFilters({...filters, showPending: e.target.checked})}
                    />
                    <span>SHOW PENDING</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '9px' }}>
                    <input
                      type="checkbox"
                      checked={filters.privateParty}
                      onChange={(e) => setFilters({...filters, privateParty: e.target.checked})}
                    />
                    <span>PRIVATE PARTY</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '9px' }}>
                    <input
                      type="checkbox"
                      checked={filters.dealer}
                      onChange={(e) => setFilters({...filters, dealer: e.target.checked})}
                    />
                    <span>DEALER</span>
                  </label>
                </div>
              )}
            </div>
          </div>
  );
};

export default FeedFilterPanel;
