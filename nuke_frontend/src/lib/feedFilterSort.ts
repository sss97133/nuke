import type { HypeVehicle, FilterState, SortBy, SortDirection, SalesTimePeriod } from '../types/feedTypes';
import { SALES_PERIODS } from '../types/feedTypes';
import { classifySource } from './sourceClassification';
import { getCanonicalBodyStyle } from '../services/bodyStyleTaxonomy';
import { parseMoneyNumber } from './auctionUtils';
import { VehicleSearchService } from '../services/vehicleSearchService';

const getDisplayPriceValue = (vehicle: HypeVehicle | null | undefined): number | null => {
  if (!vehicle) return null;
  return parseMoneyNumber((vehicle as any).display_price);
};

export interface FilterSortParams {
  vehicles: HypeVehicle[];
  filters: FilterState;
  searchText: string;
  sortBy: SortBy;
  sortDirection: SortDirection;
  includedSources: Record<string, boolean>;
  getSourceFilterKey: (v: any) => string;
  salesPeriod: SalesTimePeriod;
  locationZipCoords: Record<string, { lat: number; lng: number }>;
}

export function filterAndSortVehicles({
  vehicles, filters, searchText, sortBy, sortDirection,
  includedSources, getSourceFilterKey, salesPeriod, locationZipCoords,
}: FilterSortParams): HypeVehicle[] {
  let result = [...vehicles];

  // Global search (year/make/model/title/vin). Space-separated terms must all match.
  if (searchText) {
    const terms = searchText
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.trim())
      .filter(Boolean);

    result = result.filter((v: any) => {
      const hay = [v.year, v.make, v.model, v.title, v.vin]
        .filter(Boolean).join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  // Added today filter
  if (filters.addedTodayOnly) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const startMs = start.getTime();
    const endMs = end.getTime();

    result = result.filter((v: any) => {
      const t = new Date(v.created_at || 0).getTime();
      return Number.isFinite(t) && t >= startMs && t < endMs;
    });
  }

  // Year range
  if (filters.yearMin) {
    result = result.filter(v => (v.year || 0) >= filters.yearMin!);
  }
  if (filters.yearMax) {
    result = result.filter(v => (v.year || 0) <= filters.yearMax!);
  }

  // Make filter
  if (filters.makes.length > 0) {
    result = result.filter(v => filters.makes.some(m =>
      v.make?.toLowerCase().includes(m.toLowerCase())
    ));
  }

  // Model filter (fuzzy matching)
  if (filters.models && filters.models.length > 0) {
    const normalize = (s: string) => s.toLowerCase().replace(/[-\/\s]/g, '');
    result = result.filter(v => filters.models!.some(m => {
      const modelLower = (v.model || '').toLowerCase();
      const modelNorm = normalize(modelLower);
      const filterLower = m.toLowerCase();
      const filterNorm = normalize(m);
      return modelLower.includes(filterLower) || modelNorm.includes(filterNorm);
    }));
  }

  // Body style filter
  if (filters.bodyStyles.length > 0) {
    const selectedCanon = filters.bodyStyles
      .map((bs) => getCanonicalBodyStyle(bs))
      .filter(Boolean) as any[];
    result = result.filter(v => {
      const canon = getCanonicalBodyStyle((v as any).canonical_body_style || (v as any).body_style);
      return canon ? selectedCanon.includes(canon) : false;
    });
  } else {
    // Default: keep motorcycles out unless explicitly selected
    result = result.filter((v: any) => {
      const canon = getCanonicalBodyStyle((v as any).canonical_body_style || (v as any).body_style);
      return canon !== 'MOTORCYCLE';
    });
  }

  // 4x4/4WD/AWD filter
  if (filters.is4x4) {
    result = result.filter(v => {
      const drivetrain = ((v as any).drivetrain || '').toLowerCase();
      return drivetrain.includes('4wd') || drivetrain.includes('4x4') || drivetrain.includes('awd');
    });
  }

  // Price range
  if (filters.priceMin) {
    result = result.filter(v => (getDisplayPriceValue(v) ?? 0) >= filters.priceMin!);
  }
  if (filters.priceMax) {
    result = result.filter(v => (getDisplayPriceValue(v) ?? 0) <= filters.priceMax!);
  }

  // Has images
  if (filters.hasImages) {
    result = result.filter(v => (v.image_count || 0) > 0);
  }

  // For sale
  if (filters.forSale) {
    result = result.filter(v => v.is_for_sale);
  }

  // Hide sold
  if (filters.hideSold) {
    result = result.filter(v => {
      const salePrice = Number((v as any).sale_price || 0) || 0;
      const saleDate = (v as any).sale_date;
      const saleStatus = String((v as any).sale_status || '').toLowerCase();
      const outcome = String((v as any).auction_outcome || '').toLowerCase();
      const isAuctionResult =
        ['sold', 'ended', 'reserve_not_met', 'no_sale'].includes(outcome) ||
        ['sold', 'ended', 'reserve_not_met', 'no_sale'].includes(saleStatus);
      const isSold = salePrice > 0 || Boolean(saleDate) || saleStatus === 'sold' || isAuctionResult;
      return !isSold;
    });
  }

  // Show ONLY sold vehicles
  if (filters.showSoldOnly) {
    const period = SALES_PERIODS.find(p => p.value === salesPeriod);
    const cutoffDate = period && period.days !== null
      ? new Date(Date.now() - period.days * 24 * 60 * 60 * 1000)
      : null;

    result = result.filter(v => {
      const salePrice = Number((v as any).sale_price || 0) || 0;
      if (salePrice < 500) return false;
      const saleDateStr = (v as any).sale_date;
      if (!saleDateStr) return false;
      if (cutoffDate) {
        const saleDate = new Date(saleDateStr);
        if (isNaN(saleDate.getTime()) || saleDate < cutoffDate) return false;
      }
      return true;
    });

    result.sort((a, b) => {
      const aDate = new Date((a as any).sale_date || 0).getTime();
      const bDate = new Date((b as any).sale_date || 0).getTime();
      return bDate - aDate;
    });
  }

  // Private party filter
  if (filters.privateParty) {
    result = result.filter(v => {
      const orgId = (v as any).origin_organization_id;
      const source = classifySource(v);
      return !orgId || source === 'craigslist';
    });
  }

  // Dealer filter
  if (filters.dealer) {
    result = result.filter(v => {
      const orgId = (v as any).origin_organization_id;
      const source = classifySource(v);
      return !!orgId || source === 'dealer_site' || source === 'bat';
    });
  }

  // Source inclusion filtering
  const hasSourceSelections =
    filters.hideDealerListings ||
    filters.hideCraigslist ||
    filters.hideDealerSites ||
    filters.hideKsl ||
    filters.hideBat ||
    filters.hideClassic ||
    (filters.hiddenSources && filters.hiddenSources.length > 0);

  if (hasSourceSelections) {
    result = result.filter((v: any) => {
      const src = getSourceFilterKey(v);
      return includedSources[src] === true;
    });
  }

  // Location filtering
  const activeLocations: Array<{ zipCode: string; radiusMiles: number }> =
    filters.locations && filters.locations.length > 0
      ? filters.locations
      : filters.zipCode && filters.zipCode.length === 5 && filters.radiusMiles > 0
        ? [{ zipCode: filters.zipCode, radiusMiles: filters.radiusMiles }]
        : [];
  if (activeLocations.length > 0) {
    result = result.filter(v => {
      const vehicleLat = (v as any).gps_latitude != null ? Number((v as any).gps_latitude) : null;
      const vehicleLng = (v as any).gps_longitude != null ? Number((v as any).gps_longitude) : null;
      const vehicleZip = (v as any).zip_code || (v as any).location_zip || null;
      return activeLocations.some(loc => {
        const coords = locationZipCoords[loc.zipCode];
        if (vehicleLat != null && vehicleLng != null && coords) {
          const distance = VehicleSearchService.calculateDistance(coords.lat, coords.lng, vehicleLat, vehicleLng);
          return distance <= loc.radiusMiles;
        }
        if (vehicleZip) return vehicleZip === loc.zipCode;
        return false;
      });
    });
  }

  // Sorting
  const compareDisplayPrice = (a: HypeVehicle, b: HypeVehicle) => {
    const aPrice = getDisplayPriceValue(a);
    const bPrice = getDisplayPriceValue(b);
    if (aPrice === null && bPrice === null) return 0;
    if (aPrice === null) return 1;
    if (bPrice === null) return -1;
    return sortDirection === 'desc' ? bPrice - aPrice : aPrice - bPrice;
  };

  const dir = sortDirection === 'desc' ? 1 : -1;
  switch (sortBy) {
    case 'year':
      result.sort((a, b) => dir * ((b.year || 0) - (a.year || 0)));
      break;
    case 'make':
      result.sort((a, b) => dir * (a.make || '').localeCompare(b.make || ''));
      break;
    case 'model':
      result.sort((a, b) => dir * (a.model || '').localeCompare(b.model || ''));
      break;
    case 'mileage':
      result.sort((a, b) => dir * ((b.mileage || 0) - (a.mileage || 0)));
      break;
    case 'newest':
      result.sort((a, b) => {
        const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
        const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
        return dir * (bTime - aTime);
      });
      break;
    case 'oldest':
      result.sort((a, b) =>
        dir * (new Date(a.updated_at || a.created_at || 0).getTime() -
        new Date(b.updated_at || b.created_at || 0).getTime())
      );
      break;
    case 'price_high':
    case 'price_low':
      result.sort(compareDisplayPrice);
      break;
    case 'volume':
      result.sort((a, b) => 0);
      break;
    case 'images':
      result.sort((a, b) => dir * ((b.image_count || 0) - (a.image_count || 0)));
      break;
    case 'events':
      result.sort((a, b) => dir * ((b.event_count || 0) - (a.event_count || 0)));
      break;
    case 'views':
      result.sort((a, b) => dir * ((b.view_count || 0) - (a.view_count || 0)));
      break;
    default:
      result.sort((a, b) => {
        const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
        const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
        return bTime - aTime;
      });
  }

  return result;
}
