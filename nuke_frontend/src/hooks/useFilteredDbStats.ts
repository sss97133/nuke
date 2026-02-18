/**
 * Custom hook: loads filtered stats from database when filters are active.
 * Runs debounced query on filter/search changes, applies client-side source/price/search filters.
 * Extracted from CursorHomepage to reduce file size.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { computeVehicleStats, EMPTY_STATS, type VehicleStats } from '../lib/feedStatsCalculator';
import { SALES_PERIODS, type FilterState, type SalesTimePeriod } from '../types/feedTypes';

interface UseFilteredDbStatsParams {
  hasActiveFilters: boolean;
  debouncedSearchText: string;
  filters: FilterState;
  includedSources: Record<string, boolean>;
  getSourceFilterKey: (v: any) => string;
  listingKindSupportedRef: React.MutableRefObject<boolean>;
  isMissingListingKindColumn: (err: any) => boolean;
  salesPeriod: SalesTimePeriod;
}

export function useFilteredDbStats({
  hasActiveFilters,
  debouncedSearchText,
  filters,
  includedSources,
  getSourceFilterKey,
  listingKindSupportedRef,
  isMissingListingKindColumn,
  salesPeriod,
}: UseFilteredDbStatsParams) {
  const [filteredStatsFromDb, setFilteredStatsFromDb] = useState<VehicleStats>(EMPTY_STATS);

  const loadFilteredStats = useCallback(async () => {
    if (!hasActiveFilters && !debouncedSearchText) return;

    try {
      const buildFilteredStatsQuery = (includeListingKind: boolean) => {
        let query = supabase
          .from('vehicles')
          .select(
            'sale_price, sale_status, asking_price, current_value, purchase_price, msrp, winning_bid, high_bid, is_for_sale, bid_count, auction_outcome, sale_date, created_at, year, make, model, title, vin, discovery_url, discovery_source, profile_origin, image_count',
            { count: 'estimated' }
          )
          .eq('is_public', true)
          .neq('status', 'pending');
        if (includeListingKind) query = query.eq('listing_kind', 'vehicle');

        query = query.limit(15000);

        if (filters.addedTodayOnly) {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setDate(end.getDate() + 1);
          query = query.gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
        }

        if (filters.yearMin) query = query.gte('year', filters.yearMin);
        if (filters.yearMax) query = query.lte('year', filters.yearMax);

        if (filters.makes.length > 0) {
          const makeFilters = filters.makes.map(make => `make.ilike.%${make}%`).join(',');
          query = query.or(makeFilters);
        }

        if (filters.models && filters.models.length > 0) {
          const modelFilters = filters.models.map(model => `model.ilike.%${model}%`).join(',');
          query = query.or(modelFilters);
        }

        if (filters.forSale) query = query.eq('is_for_sale', true);

        if (filters.hideSold) {
          query = query.or('sale_status.neq.sold,sale_status.is.null');
        }

        if (filters.showSoldOnly) {
          query = query.gt('sale_price', 500);
          const period = SALES_PERIODS.find(p => p.value === salesPeriod);
          if (period && period.days !== null) {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - period.days);
            query = query.gte('sale_date', cutoffDate.toISOString().split('T')[0]);
          }
        }

        return query;
      };

      const query = buildFilteredStatsQuery(listingKindSupportedRef.current);
      let { data: vehicles, count, error } = await query;
      if (error && isMissingListingKindColumn(error)) {
        listingKindSupportedRef.current = false;
        ({ data: vehicles, count, error } = await buildFilteredStatsQuery(false));
      }

      if (error) return;

      let filtered = vehicles || [];
      let hasClientSideFilters = false;

      // Source filters
      const hasSourceSelections =
        filters.hideDealerListings ||
        filters.hideCraigslist ||
        filters.hideDealerSites ||
        filters.hideKsl ||
        filters.hideBat ||
        filters.hideClassic ||
        (filters.hiddenSources && filters.hiddenSources.length > 0);
      if (hasSourceSelections) {
        hasClientSideFilters = true;
        filtered = filtered.filter((v: any) => {
          const src = getSourceFilterKey(v);
          return includedSources[src] === true;
        });
      }

      // Price filters
      if (filters.priceMin || filters.priceMax) {
        hasClientSideFilters = true;
        filtered = filtered.filter((v: any) => {
          let vehiclePrice = 0;
          if (v.sale_price && typeof v.sale_price === 'number' && Number.isFinite(v.sale_price) && v.sale_price > 0) {
            vehiclePrice = v.sale_price;
          } else if (v.asking_price) {
            vehiclePrice = typeof v.asking_price === 'number' && Number.isFinite(v.asking_price) ? v.asking_price : 0;
            if (typeof v.asking_price === 'string') {
              const parsed = parseFloat(v.asking_price);
              vehiclePrice = Number.isFinite(parsed) ? parsed : 0;
            }
          } else if (v.current_value) {
            vehiclePrice = typeof v.current_value === 'number' && Number.isFinite(v.current_value) ? v.current_value : 0;
          } else if (v.purchase_price) {
            vehiclePrice = typeof v.purchase_price === 'number' && Number.isFinite(v.purchase_price) ? v.purchase_price : 0;
          }

          if (filters.priceMin && vehiclePrice < filters.priceMin) return false;
          if (filters.priceMax && vehiclePrice > filters.priceMax) return false;
          return true;
        });
      }

      // Has images filter
      if (filters.hasImages) {
        hasClientSideFilters = true;
        filtered = filtered.filter((v: any) => (v.image_count || 0) > 0);
      }

      // Search text filter
      if (debouncedSearchText) {
        hasClientSideFilters = true;
        const terms = debouncedSearchText.toLowerCase().trim().split(/\s+/).filter(Boolean);
        filtered = filtered.filter((v: any) => {
          const hay = [v.year, v.make, v.model, v.title, v.vin]
            .filter(Boolean).join(' ').toLowerCase();
          return terms.every((t) => hay.includes(t));
        });
      }

      // Determine the accurate total count
      let accurateTotalVehicles: number;
      const fetchedCount = (vehicles || []).length;
      if (!hasClientSideFilters) {
        accurateTotalVehicles = count || filtered.length;
      } else if (fetchedCount > 0 && count && count > 0) {
        const ratio = filtered.length / fetchedCount;
        accurateTotalVehicles = Math.round(ratio * count);
      } else {
        accurateTotalVehicles = filtered.length;
      }

      const stats = computeVehicleStats(filtered, accurateTotalVehicles);
      setFilteredStatsFromDb(stats);
    } catch {
      // Error loading filtered stats - silent
    }
  }, [hasActiveFilters, debouncedSearchText, filters, includedSources, getSourceFilterKey, salesPeriod, listingKindSupportedRef, isMissingListingKindColumn]);

  // Load filtered stats when filters change (debounced)
  useEffect(() => {
    if (hasActiveFilters || debouncedSearchText) {
      const timer = setTimeout(() => {
        loadFilteredStats();
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setFilteredStatsFromDb(EMPTY_STATS);
    }
  }, [hasActiveFilters, debouncedSearchText, filters, loadFilteredStats]);

  return { filteredStatsFromDb };
}
