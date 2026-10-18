import {
  classifyVehicleFacet,
  classifyVehicleFacets,
  inferVehicleFamilyLabel,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
  resolveVehicleIdentityMark,
  resolveVettedIdentityMarks,
  VETTED_IDENTITY_MARKS,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
  type VehicleTaxonomyInput,
} from '../../pages/vehicleTaxonomy';
import {
  buildFacetDrilldownUrl,
  resolveVehicleMarketFamily,
} from '../../pages/vehicle-profile/VehicleBadgeBar';

export type ClassifiedVehicleFacet = VehicleFacetClassification & {
  family: string | null;
};

export {
  buildFacetDrilldownUrl,
  classifyVehicleFacet,
  classifyVehicleFacets,
  inferVehicleFamilyLabel,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
  resolveVehicleIdentityMark,
  resolveVehicleMarketFamily,
  resolveVettedIdentityMarks,
  VETTED_IDENTITY_MARKS,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
  type VehicleTaxonomyInput,
};

export type VehicleCohortFilterKey = 'all' | 'series' | 'trim' | 'body';

export interface VehicleCohortOption {
  key: VehicleCohortFilterKey;
  axis: Exclude<FamilyFacetAxis, 'raw'> | null;
  facetValue: string | null;
  label: string;
}

export interface ComparableSaleLike {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  series?: string | null;
  trim?: string | null;
  body_style?: string | null;
  title?: string | null;
  listing_title?: string | null;
  sale_price: number;
}

export interface CohortComparisonStats {
  familyCount: number;
  familyMedianPrice: number | null;
  cohortCount: number;
  cohortMedianPrice: number | null;
  deltaPctVsFamily: number | null;
  deltaDirection: 'premium' | 'discount' | 'par' | null;
}

export function computeSaleMedian(prices: readonly number[]): number | null {
  const valid = prices.filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 1 ? valid[mid] : Math.round((valid[mid - 1] + valid[mid]) / 2);
}

/**
 * Uses `classifyVehicleFacet` to derive the current vehicle's SERIES, TRIM, and BODY STYLE
 * facets and build the interactive Cohort Filter bar options:
 * `ALL FAMILY` | `SERIES: <val>` | `TRIM: <val>` | `BODY: <val>`
 */
export function buildVehicleCohortOptions(
  vehicle: VehicleTaxonomyInput | null | undefined,
): {
  facets: VehicleFacetClassification;
  options: VehicleCohortOption[];
} {
  if (!vehicle) {
    return {
      facets: { series: null, trim: null, body: null },
      options: [{ key: 'all', axis: null, facetValue: null, label: 'ALL FAMILY' }],
    };
  }

  const classified = classifyVehicleFacet(vehicle);
  const facets: VehicleFacetClassification = {
    series: classified.series,
    trim: classified.trim,
    body: classified.body,
  };
  const options: VehicleCohortOption[] = [
    { key: 'all', axis: null, facetValue: null, label: 'ALL FAMILY' },
  ];

  if (facets.series) {
    options.push({
      key: 'series',
      axis: 'series',
      facetValue: facets.series,
      label: `SERIES: ${facets.series}`,
    });
  }
  if (facets.trim) {
    options.push({
      key: 'trim',
      axis: 'trim',
      facetValue: facets.trim,
      label: `TRIM: ${facets.trim}`,
    });
  }
  if (facets.body) {
    options.push({
      key: 'body',
      axis: 'body',
      facetValue: facets.body,
      label: `BODY: ${facets.body}`,
    });
  }

  return { facets, options };
}

export function filterComparableSalesByCohort<T extends ComparableSaleLike>(
  sales: readonly T[],
  activeKey: VehicleCohortFilterKey,
  vehicleFacets: VehicleFacetClassification,
  fallbackMake?: string | null,
  fallbackFamily?: string | null,
): T[] {
  if (activeKey === 'all') return [...sales];

  const targetValue =
    activeKey === 'series'
      ? vehicleFacets.series
      : activeKey === 'trim'
        ? vehicleFacets.trim
        : vehicleFacets.body;

  if (!targetValue) return [...sales];
  const normalizedTarget = targetValue.trim().toLowerCase();

  return sales.filter((sale) => {
    const classified = classifyVehicleFacet({
      make: sale.make ?? fallbackMake ?? null,
      family: fallbackFamily ?? null,
      model: sale.model ?? null,
      series: sale.series ?? null,
      trim: sale.trim ?? null,
      body_style: sale.body_style ?? null,
      listing_title: sale.listing_title ?? sale.title ?? null,
      year: sale.year ?? null,
    });
    const saleFacet =
      activeKey === 'series'
        ? classified.series
        : activeKey === 'trim'
          ? classified.trim
          : classified.body;
    return saleFacet != null && saleFacet.trim().toLowerCase() === normalizedTarget;
  });
}

export function computeCohortComparisonStats(
  allSales: readonly ComparableSaleLike[],
  filteredSales: readonly ComparableSaleLike[],
): CohortComparisonStats {
  const familyPrices = allSales
    .map((s) => s.sale_price)
    .filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0);
  const cohortPrices = filteredSales
    .map((s) => s.sale_price)
    .filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0);

  const familyMedianPrice = computeSaleMedian(familyPrices);
  const cohortMedianPrice = computeSaleMedian(cohortPrices);

  let deltaPctVsFamily: number | null = null;
  let deltaDirection: 'premium' | 'discount' | 'par' | null = null;

  if (familyMedianPrice != null && familyMedianPrice > 0 && cohortMedianPrice != null && cohortMedianPrice > 0) {
    const rawDelta = ((cohortMedianPrice - familyMedianPrice) / familyMedianPrice) * 100;
    deltaPctVsFamily = Number(rawDelta.toFixed(1));
    if (deltaPctVsFamily > 0) deltaDirection = 'premium';
    else if (deltaPctVsFamily < 0) deltaDirection = 'discount';
    else deltaDirection = 'par';
  }

  return {
    familyCount: familyPrices.length,
    familyMedianPrice,
    cohortCount: cohortPrices.length,
    cohortMedianPrice,
    deltaPctVsFamily,
    deltaDirection,
  };
}
