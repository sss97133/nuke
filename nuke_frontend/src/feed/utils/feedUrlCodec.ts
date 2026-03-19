/**
 * feedUrlCodec.ts
 *
 * Bidirectional serialization between FilterState/SortBy/ViewConfig and URLSearchParams.
 * URL is the source of truth for the new feed — every filter/sort/search state
 * maps to a shareable URL.
 *
 * Design decisions:
 * - Omit default values from URL (keeps URLs short)
 * - Array params use comma-separated values: make=Porsche,BMW
 * - Boolean flags are present-only (no =true): for_sale, 4x4
 * - Exclusion lists use minus prefix: sources=-craigslist,-ksl
 */

import type { FilterState, SortBy, SortDirection, ViewMode } from '../../types/feedTypes';
import { DEFAULT_FILTERS } from '../../lib/filterPersistence';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageFit = 'cover' | 'contain' | 'auto';

export interface FeedUrlState {
  filters: FilterState;
  sortBy: SortBy;
  sortDirection: SortDirection;
  searchText: string;
  viewMode: ViewMode;
  cardsPerRow: number;
  imageFit: ImageFit;
}

const DEFAULT_SORT_BY: SortBy = 'popular';
const DEFAULT_SORT_DIR: SortDirection = 'desc';
const DEFAULT_VIEW_MODE: ViewMode = 'grid';
const DEFAULT_CARDS_PER_ROW = 6;

const VALID_SORT_BY: Set<string> = new Set([
  'year', 'make', 'model', 'mileage', 'newest', 'oldest', 'updated', 'popular',
  'price_high', 'price_low', 'volume', 'images', 'events', 'views',
  'deal_score', 'heat_score',
]);
const VALID_SORT_DIR: Set<string> = new Set(['asc', 'desc']);
const VALID_VIEW_MODE: Set<string> = new Set(['grid', 'gallery', 'technical']);
const VALID_IMAGE_FIT: Set<string> = new Set(['cover', 'contain', 'auto']);
const DEFAULT_IMAGE_FIT: ImageFit = 'auto';

// ---------------------------------------------------------------------------
// Deserialize: URLSearchParams -> FeedUrlState
// ---------------------------------------------------------------------------

export function deserializeFromUrl(params: URLSearchParams): FeedUrlState {
  return {
    filters: deserializeFilters(params),
    sortBy: deserializeSortBy(params),
    sortDirection: deserializeSortDir(params),
    searchText: params.get('q') || '',
    viewMode: deserializeViewMode(params),
    cardsPerRow: deserializeCardsPerRow(params),
    imageFit: deserializeImageFit(params),
  };
}

function deserializeFilters(params: URLSearchParams): FilterState {
  const filters: FilterState = { ...DEFAULT_FILTERS };

  // Year range
  const yearMin = parseInt(params.get('year_min') || '', 10);
  const yearMax = parseInt(params.get('year_max') || '', 10);
  if (Number.isFinite(yearMin) && yearMin >= 1880 && yearMin <= 2030) filters.yearMin = yearMin;
  if (Number.isFinite(yearMax) && yearMax >= 1880 && yearMax <= 2030) filters.yearMax = yearMax;

  // Make / Model / Body (comma-separated)
  const makes = params.get('make');
  if (makes) filters.makes = makes.split(',').map(s => s.trim()).filter(Boolean);
  const models = params.get('model');
  if (models) filters.models = models.split(',').map(s => s.trim()).filter(Boolean);
  const body = params.get('body');
  if (body) filters.bodyStyles = body.split(',').map(s => s.trim()).filter(Boolean);

  // Price range
  const priceMin = parseInt(params.get('price_min') || '', 10);
  const priceMax = parseInt(params.get('price_max') || '', 10);
  if (Number.isFinite(priceMin) && priceMin >= 0) filters.priceMin = priceMin;
  if (Number.isFinite(priceMax) && priceMax > 0) filters.priceMax = priceMax;

  // Boolean flags (present = true)
  if (params.has('4x4')) filters.is4x4 = true;
  if (params.has('for_sale')) filters.forSale = true;
  if (params.has('sold')) filters.showSoldOnly = true;
  if (params.has('hide_sold')) filters.hideSold = true;
  if (params.has('images')) filters.hasImages = true;
  if (params.has('today')) filters.addedTodayOnly = true;
  if (params.has('pending')) filters.showPending = true;
  if (params.has('private')) filters.privateParty = true;
  if (params.has('dealer')) filters.dealer = true;

  // Source exclusions: sources=-craigslist,-ksl,-bat
  const sources = params.get('sources');
  if (sources) {
    const parts = sources.split(',').map(s => s.trim()).filter(Boolean);
    const excluded: string[] = [];
    for (const part of parts) {
      if (part.startsWith('-')) {
        const key = part.slice(1);
        excluded.push(key);
        // Map to legacy boolean flags for backward compat
        if (key === 'craigslist') filters.hideCraigslist = true;
        if (key === 'ksl') filters.hideKsl = true;
        if (key === 'bat') filters.hideBat = true;
        if (key === 'classic') filters.hideClassic = true;
        if (key === 'dealer_sites') filters.hideDealerSites = true;
        if (key === 'dealer_listings') filters.hideDealerListings = true;
      }
    }
    filters.hiddenSources = excluded;
  }

  // Location
  const zip = params.get('zip');
  if (zip) filters.zipCode = zip;
  const radius = parseInt(params.get('radius') || '', 10);
  if (Number.isFinite(radius) && radius > 0) filters.radiusMiles = radius;

  return filters;
}

function deserializeSortBy(params: URLSearchParams): SortBy {
  const val = params.get('sort') || '';
  return VALID_SORT_BY.has(val) ? (val as SortBy) : DEFAULT_SORT_BY;
}

function deserializeSortDir(params: URLSearchParams): SortDirection {
  const val = params.get('dir') || '';
  return VALID_SORT_DIR.has(val) ? (val as SortDirection) : DEFAULT_SORT_DIR;
}

function deserializeViewMode(params: URLSearchParams): ViewMode {
  const val = params.get('view') || '';
  return VALID_VIEW_MODE.has(val) ? (val as ViewMode) : DEFAULT_VIEW_MODE;
}

function deserializeCardsPerRow(params: URLSearchParams): number {
  const val = parseInt(params.get('cols') || '', 10);
  if (Number.isFinite(val) && val >= 1 && val <= 16) return val;
  return DEFAULT_CARDS_PER_ROW;
}

function deserializeImageFit(params: URLSearchParams): ImageFit {
  const val = params.get('fit') || '';
  return VALID_IMAGE_FIT.has(val) ? (val as ImageFit) : DEFAULT_IMAGE_FIT;
}

// ---------------------------------------------------------------------------
// Serialize: FeedUrlState -> URLSearchParams
// ---------------------------------------------------------------------------

export function serializeToUrl(state: FeedUrlState): URLSearchParams {
  const params = new URLSearchParams();
  const { filters, sortBy, sortDirection, searchText, viewMode, cardsPerRow } = state;

  // Search
  if (searchText) params.set('q', searchText);

  // Year range
  if (filters.yearMin !== null) params.set('year_min', String(filters.yearMin));
  if (filters.yearMax !== null) params.set('year_max', String(filters.yearMax));

  // Make / Model / Body
  if (filters.makes.length > 0) params.set('make', filters.makes.join(','));
  if (filters.models.length > 0) params.set('model', filters.models.join(','));
  if (filters.bodyStyles.length > 0) params.set('body', filters.bodyStyles.join(','));

  // Price range
  if (filters.priceMin !== null) params.set('price_min', String(filters.priceMin));
  if (filters.priceMax !== null) params.set('price_max', String(filters.priceMax));

  // Boolean flags (only when true)
  if (filters.is4x4) params.set('4x4', '');
  if (filters.forSale) params.set('for_sale', '');
  if (filters.showSoldOnly) params.set('sold', '');
  if (filters.hideSold) params.set('hide_sold', '');
  if (filters.hasImages) params.set('images', '');
  if (filters.addedTodayOnly) params.set('today', '');
  if (filters.showPending) params.set('pending', '');
  if (filters.privateParty) params.set('private', '');
  if (filters.dealer) params.set('dealer', '');

  // Source exclusions
  const excluded = collectExcludedSources(filters);
  if (excluded.length > 0) {
    params.set('sources', excluded.map(s => `-${s}`).join(','));
  }

  // Location
  if (filters.zipCode) params.set('zip', filters.zipCode);
  if (filters.radiusMiles !== 50 && filters.zipCode) {
    params.set('radius', String(filters.radiusMiles));
  }

  // Sort (omit defaults)
  if (sortBy !== DEFAULT_SORT_BY) params.set('sort', sortBy);
  if (sortDirection !== DEFAULT_SORT_DIR) params.set('dir', sortDirection);

  // View (omit defaults)
  if (viewMode !== DEFAULT_VIEW_MODE) params.set('view', viewMode);
  if (cardsPerRow !== DEFAULT_CARDS_PER_ROW) params.set('cols', String(cardsPerRow));
  if (state.imageFit !== DEFAULT_IMAGE_FIT) params.set('fit', state.imageFit);

  return params;
}

/**
 * Collect all excluded sources from the various legacy boolean flags
 * and the newer hiddenSources array into one deduplicated list.
 */
function collectExcludedSources(filters: FilterState): string[] {
  const excluded = new Set<string>(filters.hiddenSources || []);
  if (filters.hideCraigslist) excluded.add('craigslist');
  if (filters.hideKsl) excluded.add('ksl');
  if (filters.hideBat) excluded.add('bat');
  if (filters.hideClassic) excluded.add('classic');
  if (filters.hideDealerSites) excluded.add('dealer_sites');
  if (filters.hideDealerListings) excluded.add('dealer_listings');
  return [...excluded].sort();
}

// ---------------------------------------------------------------------------
// URL diff helper — only update params that changed
// ---------------------------------------------------------------------------

/**
 * Returns true if two FeedUrlState objects produce the same URL params.
 * Used to avoid unnecessary pushState calls.
 */
export function urlStatesEqual(a: FeedUrlState, b: FeedUrlState): boolean {
  return serializeToUrl(a).toString() === serializeToUrl(b).toString();
}

/**
 * Check if URL has any feed-specific params (vs a clean "/" with no params).
 * Used for the localStorage migration path: if URL is clean and localStorage
 * has saved filters, hydrate URL from localStorage once.
 */
export function urlHasFeedParams(params: URLSearchParams): boolean {
  const feedKeys = new Set([
    'q', 'year_min', 'year_max', 'make', 'model', 'body',
    'price_min', 'price_max', '4x4', 'for_sale', 'sold', 'hide_sold',
    'images', 'today', 'pending', 'private', 'dealer', 'sources',
    'zip', 'radius', 'sort', 'dir', 'view', 'cols', 'fit',
  ]);
  for (const key of params.keys()) {
    if (feedKeys.has(key)) return true;
  }
  return false;
}
