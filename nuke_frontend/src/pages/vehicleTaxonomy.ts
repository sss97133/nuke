import {
  classifyVehicleFacets,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
  resolveVettedIdentityMarks,
  VETTED_IDENTITY_MARKS,
  VEHICLE_IDENTITY_MARKS,
  type FamilyFacetAxis,
  type VehicleFacetClassification,
  type VehicleIdentityMark,
} from './familyFacetsAndEmblems';
import { resolveVehicleMarketFamily } from './vehicle-profile/vehicleMarketFamily';

export {
  classifyVehicleFacets,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
  resolveVettedIdentityMarks,
  VETTED_IDENTITY_MARKS,
  VEHICLE_IDENTITY_MARKS,
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
  bodyStyle?: string | null;
  body_style?: string | null;
  title?: string | null;
  rawTitle?: string | null;
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
  if (/\bGRAND\s+NATIONAL\b|\bGNX\b/.test(u)) return 'Grand National';
  if (/\b4[-\s]?4[-\s]?2\b|\b442\b/.test(u)) return '442';
  if (/\bCJ[-\s]?[578]\b|\bSCRAMBLER\b/.test(u)) return 'CJ';
  if (/\bGRAND\s+WAGONEER\b|\bWAGONEER\b/.test(u)) return 'Grand Wagoneer';
  if (/\bWRANGLER\b|\bRUBICON\b/.test(u)) return 'Wrangler';
  if (/\bSCOUT\b/.test(u)) return 'Scout';
  if (/\b2[468]0Z\b|\bFAIRLADY\s*Z\b|\bS30\b/.test(u)) return '240Z';
  if (/\bSKYLINE\b|\bGT[-\s]?R\b|\bBNR3[24]\b|\bBCNR33\b/.test(u)) return 'Skyline';
  if (/\bSUPRA\b|\bJZA80\b|\bMA70\b|\bA90\b/.test(u)) return 'Supra';
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
): VehicleFacetClassification & { family: string | null } {
  if (typeof inputOrMake === 'object' && inputOrMake !== null) {
    const make = inputOrMake.make?.trim() || null;
    const explicitSeries = inputOrMake.series?.trim() || null;
    const explicitTrim = inputOrMake.trim?.trim() || null;
    const explicitBody = inputOrMake.bodyStyle?.trim() || inputOrMake.body_style?.trim() || null;
    const compositeModel = [
      inputOrMake.model,
      explicitSeries,
      explicitTrim,
      explicitBody,
      inputOrMake.title,
      inputOrMake.rawTitle,
      inputOrMake.listing_title,
    ]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' ');
    const family =
      inputOrMake.family?.trim() ||
      resolveVehicleMarketFamily({
        make,
        model: inputOrMake.model,
        trim: inputOrMake.trim,
        title: inputOrMake.title,
        listing_title: inputOrMake.rawTitle ?? inputOrMake.listing_title,
      }) ||
      inferVehicleFamilyLabel(make, compositeModel || inputOrMake.model, inputOrMake.family) ||
      null;

    const classified = classifyVehicleFacets(make, family, compositeModel || inputOrMake.model, inputOrMake.year);
    let series =
      explicitSeries &&
      classified.series &&
      classified.series.toUpperCase().startsWith(explicitSeries.toUpperCase())
        ? classified.series
        : (explicitSeries ?? classified.series);
    let trim = classified.trim;
    let body =
      explicitBody &&
      !inputOrMake.bodyStyle &&
      classified.body &&
      classified.body.toUpperCase().startsWith(explicitBody.toUpperCase())
        ? classified.body
        : (explicitBody ?? classified.body);

    // Only apply short generation/trim overrides when called from stream/event records without listing_title
    if (!inputOrMake.listing_title) {
      const isPorsche911 =
        family?.toLowerCase() === '911' ||
        (make?.toLowerCase() === 'porsche' && /\b(911|992|991|997|996|993|964|930)\b/i.test(compositeModel));
      if (isPorsche911) {
        const genMatch = compositeModel.match(/\b(992|991|997|996|993|964|930)\b/i);
        if (!explicitSeries && genMatch) {
          const prevSeries = series;
          series = genMatch[1].toUpperCase();
          if (!trim && prevSeries && prevSeries.toUpperCase() !== series) {
            trim = prevSeries === '911 Carrera' ? 'Carrera' : prevSeries;
          }
        }
      }

      const isCorvette =
        family?.toLowerCase() === 'corvette' || /\bCORVETTE\b/i.test(compositeModel);
      if (isCorvette) {
        const cGenMatch = compositeModel.match(/\b(C[1-8])\b/i);
        const vetteTrimMatch = compositeModel.match(/\b(Z06|ZR-?1|GRAND\s+SPORT)\b/i);
        if (vetteTrimMatch && !trim) {
          const rawVetteTrim = vetteTrimMatch[1].toUpperCase();
          trim =
            rawVetteTrim === 'Z06'
              ? 'Z06'
              : rawVetteTrim.startsWith('ZR')
                ? 'ZR1'
                : 'Grand Sport';
        }
        if (!explicitSeries) {
          if (cGenMatch) {
            series = cGenMatch[1].toUpperCase();
          } else if (series && trim && series.toLowerCase() === trim.toLowerCase()) {
            series = null;
          }
        }
      }

      if (!explicitBody) {
        if (body === 'Coupe / Hardtop' && /\bCOUPE\b/i.test(compositeModel) && !/\bHARDTOP\b/i.test(compositeModel)) {
          body = 'Coupe';
        } else if (
          body === 'Convertible / Cabriolet' &&
          /\bCONVERTIBLE\b/i.test(compositeModel) &&
          !/\bCABRIOLET\b/i.test(compositeModel)
        ) {
          body = 'Convertible';
        }
      }
    }

    if (
      !trim &&
      explicitTrim &&
      explicitTrim.toLowerCase() !== 'base' &&
      explicitTrim.toLowerCase() !== series?.toLowerCase() &&
      explicitTrim.toLowerCase() !== body?.toLowerCase()
    ) {
      trim = explicitTrim;
    }

    return {
      family,
      series,
      trim,
      body,
    };
  }
  const inferredFamily = inferVehicleFamilyLabel(inputOrMake, rawModel, familyLabel);
  return {
    family: inferredFamily,
    ...classifyVehicleFacets(inputOrMake, inferredFamily, rawModel, year),
  };
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
        inputOrMake.bodyStyle,
        inputOrMake.body_style,
        inputOrMake.title,
        inputOrMake.rawTitle,
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
