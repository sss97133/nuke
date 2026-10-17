import {
  classifyVehicleFacets,
  resolveTileBadgeSvg,
  resolveVettedIdentityMarks,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
} from '../../pages/familyFacetsAndEmblems';
import {
  buildFacetDrilldownUrl,
  resolveVehicleMarketFamily,
} from '../../pages/vehicle-profile/VehicleBadgeBar';

export type { FamilyFacetAxis, VehicleFacetClassification, VehicleIdentityMark };
export {
  buildFacetDrilldownUrl,
  classifyVehicleFacets,
  resolveTileBadgeSvg,
  resolveVehicleMarketFamily,
  resolveVettedIdentityMarks,
};

export type ClassifiedVehicleFacet = VehicleFacetClassification & {
  family: string | null;
};

/**
 * Classifies a vehicle record or event into `family`, `series`, `trim`, and `body` facets.
 */
export function classifyVehicleFacet(params: {
  make?: string | null;
  family?: string | null;
  model?: string | null;
  trim?: string | null;
  title?: string | null;
  rawTitle?: string | null;
  year?: number | null;
}): ClassifiedVehicleFacet {
  const make = params.make?.trim() || null;
  const compositeModel = [params.model, params.trim, params.title, params.rawTitle]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ');
  const family =
    params.family?.trim() ||
    resolveVehicleMarketFamily({
      make,
      model: params.model,
      trim: params.trim,
      title: params.title,
      listing_title: params.rawTitle,
    }) ||
    null;

  const classified = classifyVehicleFacets(make, family, compositeModel || params.model, params.year);
  return {
    family,
    series: classified.series,
    trim: classified.trim,
    body: classified.body,
  };
}

/**
 * Resolves the primary era-accurate SVG identity mark for a vehicle event or record.
 */
export function resolveVehicleIdentityMark(params: {
  make?: string | null;
  family?: string | null;
  model?: string | null;
  trim?: string | null;
  title?: string | null;
  rawTitle?: string | null;
  year?: number | null;
}): VehicleIdentityMark | null {
  const make = params.make?.trim() || null;
  if (!make) return null;
  const compositeModel = [params.model, params.trim, params.title, params.rawTitle]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ');
  const family =
    params.family?.trim() ||
    resolveVehicleMarketFamily({
      make,
      model: params.model,
      trim: params.trim,
      title: params.title,
      listing_title: params.rawTitle,
    }) ||
    null;

  const marks = resolveVettedIdentityMarks({
    make,
    familyLabel: family,
    model: compositeModel || params.model,
    year: params.year,
  });
  if (marks.length === 0) return null;
  // Prefer specific trim/series/body fender plates or model wordmarks over generic marque emblems when available
  const specific = marks.find((m) => m.markKind !== 'marque_emblem');
  return specific ?? marks[0] ?? null;
}
