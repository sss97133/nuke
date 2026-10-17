import {
  classifyVehicleFacets,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
  resolveVettedIdentityMarks,
  VETTED_IDENTITY_MARKS,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
} from './familyFacetsAndEmblems';

export {
  classifyVehicleFacets,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
  resolveVettedIdentityMarks,
  VETTED_IDENTITY_MARKS,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
};

export interface VehicleTaxonomyInput {
  make?: string | null;
  family?: string | null;
  model?: string | null;
  series?: string | null;
  trim?: string | null;
  body_style?: string | null;
  listing_title?: string | null;
  year?: number | null;
}

/**
 * Infers a canonical family label from make + model when an explicit family is not supplied
 * so `classifyVehicleFacets` can apply family-specific rules (Mustang, Corvette, 911, Bronco, etc.).
 */
export function inferVehicleFamilyLabel(
  make: string | null | undefined,
  model: string | null | undefined,
  explicitFamily?: string | null,
): string | null {
  if (explicitFamily && explicitFamily.trim()) return explicitFamily.trim();
  if (!model) return null;
  const m = model.trim();
  if (!m) return null;
  const u = m.toUpperCase();
  if (isPickupFamilyLabel(m)) return 'Pickup';
  if (/\bMUSTANG\b|\bSHELBY\s+GT(?:350|500)\b|\bBOSS\s+(?:302|429)\b/.test(u)) return 'Mustang';
  if (/\bCORVETTE\b|\bSTING\s*RAY\b/.test(u)) return 'Corvette';
  if (/\b911\b|\b930\b|\b964\b|\b993\b|\b996\b|\b997\b|\b991\b|\b992\b|\bCARRERA\b/.test(u)) return '911';
  if (/\b356\b/.test(u)) return '356';
  if (/\bBRONCO\b/.test(u)) return 'Bronco';
  if (/\bCAMARO\b/.test(u)) return 'Camaro';
  if (/\bCHEVELLE\b|\bMALIBU\b/.test(u)) return 'Chevelle';
  if (/\bBEL\s+AIR\b|\bNOMAD\b|\b210\b|\b150\b/.test(u)) return 'Bel Air';
  if (/\bBLAZER\b/.test(u)) return 'Blazer';
  if (/\bJIMMY\b/.test(u)) return 'Jimmy';
  if (/\bLAND\s+CRUISER\b|\bFJ4\d\b|\bFJ55\b|\bFJ6\d\b|\bFJ80\b|\bFZJ80\b/.test(u)) return 'Land Cruiser';
  if (/\bE[-\s]?TYPE\b|\bXKE\b/.test(u)) return 'E-Type';
  if (/\bM3\b/.test(u)) return 'M3';
  if (/\bCHARGER\b/.test(u)) return 'Charger';
  if (/\bCHALLENGER\b/.test(u)) return 'Challenger';
  if (/\bGTO\b/.test(u)) return 'GTO';
  if (/\bFIREBIRD\b|\bTRANS\s+AM\b/.test(u)) return 'Firebird';
  if (/\b\d{3}\s*SL\b|\bSL\s*\d{3}\b/.test(u) && (make ?? '').toLowerCase().includes('mercedes')) return 'SL';
  return m.split(/\s+/)[0] || m;
}

/**
 * Classifies a vehicle record into orthogonal `series`, `trim`, and `body` facets.
 * Accepts either a structured `VehicleTaxonomyInput` object or `(make, family, rawModel, year)` arguments.
 */
export function classifyVehicleFacet(
  inputOrMake: VehicleTaxonomyInput | string | null | undefined,
  familyLabel?: string | null,
  rawModel?: string | null,
  year?: number | null,
): VehicleFacetClassification {
  if (typeof inputOrMake === 'object' && inputOrMake !== null) {
    const make = inputOrMake.make ?? null;
    const compositeModel = [
      inputOrMake.model,
      inputOrMake.series,
      inputOrMake.trim,
      inputOrMake.body_style,
      inputOrMake.listing_title,
    ]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' ');
    const family = inferVehicleFamilyLabel(make, compositeModel || inputOrMake.model, inputOrMake.family);
    const classified = classifyVehicleFacets(make, family, compositeModel || inputOrMake.model, inputOrMake.year);
    return {
      series: classified.series ?? (inputOrMake.series?.trim() || null),
      trim: classified.trim ?? (inputOrMake.trim?.trim() || null),
      body: classified.body ?? (inputOrMake.body_style?.trim() || null),
    };
  }
  const inferredFamily = inferVehicleFamilyLabel(inputOrMake, rawModel, familyLabel);
  return classifyVehicleFacets(inputOrMake, inferredFamily, rawModel, year);
}

/**
 * Resolves the most specific period-accurate SVG identity mark (fender badge, model script, or marque emblem)
 * for a vehicle record or facet label.
 */
export function resolveVehicleIdentityMark(
  inputOrMake:
    | (VehicleTaxonomyInput & { facetLabel?: string | null })
    | string
    | null
    | undefined,
  familyLabel?: string | null,
  modelOrFacetLabel?: string | null,
  year?: number | null,
): VehicleIdentityMark | null {
  let make: string | null = null;
  let family: string | null = null;
  let modelText: string | null = null;
  let yr: number | null | undefined = year;

  if (typeof inputOrMake === 'object' && inputOrMake !== null) {
    make = inputOrMake.make ?? null;
    modelText =
      inputOrMake.facetLabel ??
      ([
        inputOrMake.model,
        inputOrMake.series,
        inputOrMake.trim,
        inputOrMake.body_style,
        inputOrMake.listing_title,
      ]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ') || null);
    family = inferVehicleFamilyLabel(make, modelText, inputOrMake.family);
    yr = inputOrMake.year;
  } else {
    make = inputOrMake ?? null;
    modelText = modelOrFacetLabel ?? null;
    family = inferVehicleFamilyLabel(make, modelText, familyLabel);
  }

  if (!make && modelText) {
    // Allow resolving a facet badge directly by facetLabel when a vetted mark uniquely matches the trim/series/body
    const tLower = modelText.trim().toLowerCase();
    const direct = VETTED_IDENTITY_MARKS.find(
      (mark) =>
        mark.markKind !== 'marque_emblem' &&
        ((mark.trimPackage && tLower === mark.trimPackage.toLowerCase()) ||
          (mark.seriesCode && tLower.startsWith(mark.seriesCode.toLowerCase())) ||
          (mark.bodyStyle && tLower.includes(mark.bodyStyle.toLowerCase())) ||
          mark.displayLabel.toLowerCase() === tLower),
    );
    if (direct) return direct;
  }

  const marks = resolveVettedIdentityMarks({
    make,
    familyLabel: family,
    model: modelText,
    year: yr,
  });

  if (marks.length === 0 && modelText) {
    const tLower = modelText.trim().toLowerCase();
    const direct = VETTED_IDENTITY_MARKS.find(
      (mark) =>
        mark.markKind !== 'marque_emblem' &&
        (!make || !mark.make || mark.make.toLowerCase() === make.toLowerCase()) &&
        ((mark.trimPackage && tLower === mark.trimPackage.toLowerCase()) ||
          (mark.seriesCode && tLower.startsWith(mark.seriesCode.toLowerCase())) ||
          (mark.bodyStyle && tLower.includes(mark.bodyStyle.toLowerCase())) ||
          mark.displayLabel.toLowerCase() === tLower),
    );
    if (direct) return direct;
  }

  if (marks.length > 0 && modelText) {
    const nonMarque =
      marks.find((m) => m.markKind === 'fender_badge') ??
      marks.find((m) => m.markKind === 'body_script') ??
      marks.find((m) => m.markKind === 'model_wordmark');
    if (nonMarque) return nonMarque;

    // If resolveVettedIdentityMarks only matched the marque emblem because family was not 'Pickup',
    // check whether VETTED_IDENTITY_MARKS has a specific badge for this make + facet label
    const tLower = modelText.trim().toLowerCase();
    const specific = VETTED_IDENTITY_MARKS.find(
      (mark) =>
        mark.markKind !== 'marque_emblem' &&
        (!make || !mark.make || mark.make.toLowerCase() === make.toLowerCase()) &&
        ((mark.trimPackage && tLower === mark.trimPackage.toLowerCase()) ||
          (mark.seriesCode && tLower.startsWith(mark.seriesCode.toLowerCase())) ||
          (mark.bodyStyle && tLower.includes(mark.bodyStyle.toLowerCase())) ||
          mark.displayLabel.toLowerCase() === tLower),
    );
    if (specific) return specific;
  }

  if (marks.length === 0) return null;
  return (
    marks.find((m) => m.markKind === 'fender_badge') ??
    marks.find((m) => m.markKind === 'body_script') ??
    marks.find((m) => m.markKind === 'model_wordmark') ??
    marks[0]
  );
}
