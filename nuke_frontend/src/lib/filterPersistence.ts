import type { FilterState } from '../types/feedTypes';

export const STORAGE_KEY = 'nuke_homepage_filters_v1';
export const REMEMBER_FILTERS_KEY = 'nuke_homepage_rememberFilters';
export const LOCATION_FAVORITES_KEY = 'nuke_homepage_location_favorites';

export const DEFAULT_FILTERS: FilterState = {
  yearMin: null,
  yearMax: null,
  makes: [],
  models: [],
  bodyStyles: [],
  is4x4: false,
  priceMin: null,
  priceMax: null,
  hasImages: false,
  addedTodayOnly: false,
  forSale: false,
  hideSold: false,
  showSoldOnly: false,
  privateParty: false,
  dealer: false,
  hideDealerListings: false,
  hideCraigslist: false,
  hideDealerSites: false,
  hideKsl: false,
  hideBat: false,
  hideClassic: false,
  hiddenSources: [],
  includedSources: [],
  zipCode: '',
  radiusMiles: 50,
  locations: [],
  showPending: false
};

export const getRememberFilters = (): boolean => {
  try {
    return localStorage.getItem(REMEMBER_FILTERS_KEY) === 'true';
  } catch {
    return false;
  }
};

export const loadSavedFilters = (): FilterState | null => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    return { ...DEFAULT_FILTERS, ...parsed };
  } catch {
    return null;
  }
};

export const saveFiltersToStorage = (filters: FilterState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // ignore
  }
};

export const clearPersistedFiltersAndSort = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('nuke_homepage_searchText');
    localStorage.removeItem('nuke_homepage_sortBy');
    localStorage.removeItem('nuke_homepage_sortDirection');
  } catch {
    // ignore
  }
};
