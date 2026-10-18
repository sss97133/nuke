import React from 'react';
import {
  classifyVehicleFacets,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
} from '../pages/familyFacetsAndEmblems';
import {
  resolveVehicleIdentityMarks,
  type MarketCohortShortcut,
  type VehicleIdentityMark,
} from '../lib/market/vehicleTaxonomy';
import AIDataIngestionSearch from './search/AIDataIngestionSearch';

export interface SearchFacetInput {
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  familyLabel?: string | null;
  series?: string | null;
  trim?: string | null;
  bodyStyle?: string | null;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  label?: string | null;
}

export interface SearchFacetPill {
  kind: 'series' | 'trim' | 'body';
  axisLabel: 'SERIES' | 'TRIM' | 'BODY';
  value: string;
  badgeSvg?: string;
}

export interface SearchFacetSummary {
  year: number | null;
  make: string | null;
  familyLabel: string | null;
  series: string | null;
  trim: string | null;
  body: string | null;
  badgeSvg?: string;
  pills: SearchFacetPill[];
}

export interface QueryFacetAnalysis extends SearchFacetSummary {
  hasFacetIntent: boolean;
  requestedAxes: Array<'series' | 'trim' | 'body'>;
}

export interface VehicleFacetMatchScore {
  matchesAllQueryFacets: boolean;
  matchedAxes: Array<'series' | 'trim' | 'body'>;
  boost: number;
  candidateFacets: SearchFacetSummary;
}

export interface BoostVehicleResultsOptions {
  filterNonMatchingVehicles?: boolean;
  minMatchingVehiclesToFilter?: number;
}

const KNOWN_MAKE_PATTERNS: Array<{ canonical: string; regex: RegExp }> = [
  { canonical: 'Mercedes-Benz', regex: /\b(?:MERCEDES[-\s]+BENZ|MERCEDES)\b/i },
  { canonical: 'Aston Martin', regex: /\bASTON\s+MARTIN\b/i },
  { canonical: 'Alfa Romeo', regex: /\bALFA\s+ROMEO\b/i },
  { canonical: 'Land Rover', regex: /\bLAND\s+ROVER\b/i },
  { canonical: 'Chevrolet', regex: /\b(?:CHEVROLET|CHEVY)\b/i },
  { canonical: 'Volkswagen', regex: /\b(?:VOLKSWAGEN|VW)\b/i },
  { canonical: 'Porsche', regex: /\bPORSCHE\b/i },
  { canonical: 'Ferrari', regex: /\bFERRARI\b/i },
  { canonical: 'Mustang', regex: /\bSHELBY\b/i },
  { canonical: 'Plymouth', regex: /\bPLYMOUTH\b/i },
  { canonical: 'Pontiac', regex: /\bPONTIAC\b/i },
  { canonical: 'Oldsmobile', regex: /\bOLDSMOBILE\b/i },
  { canonical: 'Cadillac', regex: /\bCADILLAC\b/i },
  { canonical: 'Chrysler', regex: /\bCHRYSLER\b/i },
  { canonical: 'Dodge', regex: /\bDODGE\b/i },
  { canonical: 'Ford', regex: /\bFORD\b/i },
  { canonical: 'GMC', regex: /\bGMC\b/i },
  { canonical: 'BMW', regex: /\bBMW\b/i },
  { canonical: 'Buick', regex: /\bBUICK\b/i },
  { canonical: 'Jaguar', regex: /\bJAGUAR\b/i },
  { canonical: 'Toyota', regex: /\bTOYOTA\b/i },
  { canonical: 'Datsun', regex: /\bDATSUN\b/i },
  { canonical: 'Nissan', regex: /\bNISSAN\b/i },
  { canonical: 'Jeep', regex: /\bJEEP\b/i },
  { canonical: 'AMC', regex: /\bAMC\b/i },
];

function parseYearFromText(
  explicitYear: number | string | null | undefined,
  compositeText: string,
): number | null {
  if (typeof explicitYear === 'number' && Number.isFinite(explicitYear)) {
    if (explicitYear >= 1900 && explicitYear <= 2035) return explicitYear;
  }
  if (typeof explicitYear === 'string' && explicitYear.trim()) {
    const parsed = Number.parseInt(explicitYear.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 1900 && parsed <= 2035) return parsed;
  }
  const match = compositeText.match(/\b(19\d{2}|20[0-3]\d)\b/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return year >= 1900 && year <= 2035 ? year : null;
}

function parseMakeFromText(
  explicitMake: string | null | undefined,
  compositeText: string,
): string | null {
  if (explicitMake && explicitMake.trim()) {
    const raw = explicitMake.trim();
    for (const entry of KNOWN_MAKE_PATTERNS) {
      if (entry.regex.test(raw)) {
        return entry.canonical === 'Mustang' ? 'Ford' : entry.canonical;
      }
    }
    return raw;
  }
  for (const entry of KNOWN_MAKE_PATTERNS) {
    if (entry.regex.test(compositeText)) {
      return entry.canonical === 'Mustang' ? 'Ford' : entry.canonical;
    }
  }
  const upper = compositeText.toUpperCase();
  if (
    /\b(?:CHEYENNE\s+SUPER|CHEYENNE|SCOTTSDALE|SILVERADO|CUSTOM\s+DELUXE|BIG\s+10|454\s+SS|CAMEO|APACHE|CORVETTE|STING\s*RAY|CAMARO|CHEVELLE|BEL\s+AIR|NOMAD)\b/.test(
      upper,
    )
  ) {
    return 'Chevrolet';
  }
  if (/\b(?:SIERRA\s+CLASSIC|SIERRA\s+GRANDE|HIGH\s+SIERRA|GENTLEMAN\s+JIM|SIERRA|SYCLONE)\b/.test(upper)) {
    return 'GMC';
  }
  if (
    /\b(?:MUSTANG|MACH\s+1|BOSS\s+(?:302|429)|SHELBY\s+GT(?:350|500)|RANGER\s+XLT|LARIAT|BRONCO|F[-\s]?(?:100|150|250|350))\b/.test(
      upper,
    )
  ) {
    return 'Ford';
  }
  if (/\b(?:CARRERA\s+RS|TARGA|911[SET]?|930)\b/.test(upper)) {
    return 'Porsche';
  }
  if (/\b(?:300\s*SL|190\s*SL|GULLWING|PAGODA)\b/.test(upper)) {
    return 'Mercedes-Benz';
  }
  if (/\b(?:POWER\s+WAGON|WM[-\s]?300|CHARGER|CHALLENGER|SUPERBIRD|DAYTONA)\b/.test(upper)) {
    return 'Dodge';
  }
  return null;
}

function inferFamilyLabel(
  explicitFamily: string | null | undefined,
  explicitModel: string | null | undefined,
  compositeText: string,
): string | null {
  if (explicitFamily && explicitFamily.trim()) {
    return isPickupFamilyLabel(explicitFamily) ? 'Pickup' : explicitFamily.trim();
  }
  if (explicitModel && explicitModel.trim()) {
    if (isPickupFamilyLabel(explicitModel)) return 'Pickup';
  }

  const upper = compositeText.toUpperCase();
  if (
    /\b(?:[CKRV][-\s]?(?:10|20|30|1500|2500|3500)|3100|3600|3800|F[-\s]?(?:1|2|3|100|150|250|350)|W[-\s]?(?:100|150|200|250|300)|WM[-\s]?300|D[-\s]?(?:100|150|200|250)|POWER\s+WAGON|APACHE|CAMEO|CHEYENNE\s+SUPER|CHEYENNE|SCOTTSDALE|CUSTOM\s+DELUXE|SIERRA\s+CLASSIC|SIERRA\s+GRANDE|HIGH\s+SIERRA|GENTLEMAN\s+JIM|STEPSIDE|FLARESIDE|FLEETSIDE|STYLESIDE|PICKUP)\b/.test(
      upper,
    )
  ) {
    return 'Pickup';
  }
  if (/\bMUSTANG\b|\bSHELBY\s+GT(?:350|500)\b|\bBOSS\s+(?:302|429)\b|\bMACH\s+1\b/.test(upper)) {
    return 'Mustang';
  }
  if (/\bCORVETTE\b|\bSTING\s*RAY\b|\bSPLIT[-\s]?WINDOW\b/.test(upper)) return 'Corvette';
  if (/\bCAMARO\b|\bZ\/?28\b|\bIROC[-\s]?Z\b/.test(upper)) return 'Camaro';
  if (/\bCHEVELLE\b|\bMALIBU\b/.test(upper)) return 'Chevelle';
  if (/\bBEL\s+AIR\b/.test(upper)) return 'Bel Air';
  if (/\bNOMAD\b/.test(upper)) return 'Nomad';
  if (/\bBRONCO\b|\bU1[345]\b/.test(upper)) return 'Bronco';
  if (/\bCHARGER\b/.test(upper)) return 'Charger';
  if (/\bCHALLENGER\b/.test(upper)) return 'Challenger';
  if (/\b911\b|\b930\b|\bCARRERA\b|\bTARGA\b/.test(upper)) return '911';
  if (/\bM3\b|\bE30\b|\bE36\b|\bE46\b/.test(upper)) return 'M3';
  if (/\b(?:300|190|230|250|280|380|450|560)\s*SL\b|\bPAGODA\b|\bGULLWING\b/.test(upper)) {
    return 'SL';
  }
  if (/\bF?355\b/.test(upper)) return '355';

  return explicitModel?.trim() || null;
}

/**
 * Derives orthogonal Series, Trim, and Body Style facets and period-exact vector
 * emblem SVGs for a search suggestion or vehicle/model search result.
 */
export function deriveSearchResultFacets(input: SearchFacetInput): SearchFacetSummary {
  const compositeParts = [
    input.model,
    input.series,
    input.trim,
    input.bodyStyle,
    input.title,
    input.label,
    input.subtitle,
    input.description,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);

  const compositeText = compositeParts.join(' ');
  if (!compositeText) {
    return {
      year: null,
      make: null,
      familyLabel: null,
      series: null,
      trim: null,
      body: null,
      badgeSvg: undefined,
      pills: [],
    };
  }

  const year = parseYearFromText(input.year, compositeText);
  const make = parseMakeFromText(input.make, compositeText);
  const familyLabel = inferFamilyLabel(input.familyLabel, input.model, compositeText);

  const classified = classifyVehicleFacets(make, familyLabel, compositeText, year);

  const series = classified.series ?? (input.series?.trim() || null);
  const trim = classified.trim ?? (input.trim?.trim() || null);
  const body = classified.body ?? (input.bodyStyle?.trim() || null);

  const trimSvg = trim ? resolveTileBadgeSvg(make, familyLabel, trim, year) : undefined;
  const seriesSvg = series ? resolveTileBadgeSvg(make, familyLabel, series, year) : undefined;
  const bodySvg = body ? resolveTileBadgeSvg(make, familyLabel, body, year) : undefined;
  const descriptorSvg = resolveTileBadgeSvg(make, familyLabel, compositeText, year);

  const badgeSvg = trimSvg ?? seriesSvg ?? bodySvg ?? descriptorSvg;

  const pills: SearchFacetPill[] = [];
  if (series) {
    pills.push({
      kind: 'series',
      axisLabel: 'SERIES',
      value: series,
      badgeSvg: seriesSvg,
    });
  }
  if (trim) {
    pills.push({
      kind: 'trim',
      axisLabel: 'TRIM',
      value: trim,
      badgeSvg: trimSvg,
    });
  }
  if (body) {
    pills.push({
      kind: 'body',
      axisLabel: 'BODY',
      value: body,
      badgeSvg: bodySvg,
    });
  }

  return {
    year,
    make,
    familyLabel,
    series,
    trim,
    body,
    badgeSvg,
    pills,
  };
}

/**
 * Extracts explicit Series, Trim, and Body Style facet intent from a user search query.
 * Unlike vehicle classification, a general pickup query (e.g. "1973 K10 Cheyenne Super")
 * does not implicitly restrict `body` to "Standard Cab Pickup" unless the query
 * explicitly names a cab/bed configuration.
 */
export function extractQueryFacets(query: string | null | undefined): QueryFacetAnalysis {
  const trimmed = (query ?? '').trim();
  if (!trimmed) {
    return {
      year: null,
      make: null,
      familyLabel: null,
      series: null,
      trim: null,
      body: null,
      badgeSvg: undefined,
      pills: [],
      hasFacetIntent: false,
      requestedAxes: [],
    };
  }

  const base = deriveSearchResultFacets({ label: trimmed });
  const upper = trimmed.toUpperCase();

  let series = base.series;
  if (series === 'Mustang Standard' && !/\bSTANDARD\b/.test(upper)) {
    series = null;
  } else if (series === 'Corvette Base' && !/\bBASE\b/.test(upper)) {
    series = null;
  } else if (series === 'U15 Wagon' && !/\b(?:U15|WAGON)\b/.test(upper)) {
    series = null;
  }

  let body = base.body;
  if (
    body === 'Standard Cab Pickup' &&
    !/\b(?:STANDARD\s+CAB|REGULAR\s+CAB|SINGLE\s+CAB)\b/.test(upper)
  ) {
    body = null;
  }

  const trim = base.trim;

  const requestedAxes: Array<'series' | 'trim' | 'body'> = [];
  if (series) requestedAxes.push('series');
  if (trim) requestedAxes.push('trim');
  if (body) requestedAxes.push('body');

  const pills = base.pills.filter((p) => requestedAxes.includes(p.kind));

  return {
    ...base,
    series,
    trim,
    body,
    pills,
    hasFacetIntent: requestedAxes.length > 0,
    requestedAxes,
  };
}

function seriesFacetMatches(querySeries: string, candidateSeries: string | null): boolean {
  if (!candidateSeries) return false;
  if (candidateSeries.toLowerCase() === querySeries.toLowerCase()) return true;
  if (/^sting\s*ray/i.test(querySeries) && /^sting\s*ray/i.test(candidateSeries)) {
    return true;
  }
  if (querySeries === '1500 (1/2-Ton)' && candidateSeries === 'K1500 (1/2-Ton 4x4)') {
    return true;
  }
  return false;
}

/**
 * Scores a candidate vehicle against the user query's Series, Trim, and Body Style facets.
 */
export function scoreVehicleFacetMatch(
  queryOrFacets: string | QueryFacetAnalysis,
  candidate: SearchFacetInput,
): VehicleFacetMatchScore {
  const queryFacets =
    typeof queryOrFacets === 'string' ? extractQueryFacets(queryOrFacets) : queryOrFacets;
  const candidateFacets = deriveSearchResultFacets(candidate);

  if (!queryFacets.hasFacetIntent) {
    return {
      matchesAllQueryFacets: false,
      matchedAxes: [],
      boost: 0,
      candidateFacets,
    };
  }

  const matchedAxes: Array<'series' | 'trim' | 'body'> = [];
  let boost = 0;

  if (queryFacets.series) {
    if (seriesFacetMatches(queryFacets.series, candidateFacets.series)) {
      matchedAxes.push('series');
      boost += 0.4;
    }
  }

  if (queryFacets.trim) {
    if (
      candidateFacets.trim &&
      candidateFacets.trim.toLowerCase() === queryFacets.trim.toLowerCase()
    ) {
      matchedAxes.push('trim');
      boost += 0.45;
    }
  }

  if (queryFacets.body) {
    if (
      candidateFacets.body &&
      candidateFacets.body.toLowerCase() === queryFacets.body.toLowerCase()
    ) {
      matchedAxes.push('body');
      boost += 0.35;
    }
  }

  if (matchedAxes.length > 1) {
    boost += 0.15 * (matchedAxes.length - 1);
  }

  const makeContradicts = Boolean(
    queryFacets.make &&
      candidateFacets.make &&
      queryFacets.make.toLowerCase() !== candidateFacets.make.toLowerCase(),
  );
  const yearContradicts = Boolean(
    queryFacets.year &&
      candidateFacets.year &&
      queryFacets.year !== candidateFacets.year,
  );

  if (queryFacets.year && candidateFacets.year === queryFacets.year && matchedAxes.length > 0) {
    boost += 0.15;
  } else if (yearContradicts) {
    boost -= 0.35;
  }

  if (makeContradicts) {
    boost -= 0.5;
  }

  if (matchedAxes.length === 0) {
    boost -= 0.4;
  }

  const matchesAllQueryFacets =
    queryFacets.requestedAxes.length > 0 &&
    matchedAxes.length === queryFacets.requestedAxes.length &&
    !makeContradicts &&
    !yearContradicts;

  return {
    matchesAllQueryFacets,
    matchedAxes,
    boost: Number(boost.toFixed(4)),
    candidateFacets,
  };
}

/**
 * Boosts and filters local/RPC vehicle search results when the user query matches
 * a Series, Trim, or Body Style facet from `classifyVehicleFacets`.
 */
export function boostAndFilterVehicleSearchResults<T extends Record<string, any>>(
  query: string,
  results: T[],
  options: BoostVehicleResultsOptions = {},
): T[] {
  if (!Array.isArray(results) || results.length === 0) return [];

  const queryFacets = extractQueryFacets(query);
  if (!queryFacets.hasFacetIntent) {
    return results;
  }

  const filterNonMatchingVehicles = options.filterNonMatchingVehicles ?? true;
  const minMatchingVehiclesToFilter = options.minMatchingVehiclesToFilter ?? 1;

  interface ScoredEntry {
    item: T;
    index: number;
    isVehicle: boolean;
    isPinnedMarketCohort: boolean;
    score: VehicleFacetMatchScore | null;
    effectiveRelevance: number;
  }

  const entries: ScoredEntry[] = results.map((rawItem, index) => {
    const itemType = typeof rawItem.type === 'string' ? rawItem.type : undefined;
    const isPinnedMarketCohort =
      itemType === 'tag' && String(rawItem.id ?? '').startsWith('market_scope:');
    const isVehicle = !itemType || itemType === 'vehicle' || itemType === 'vin_match';

    if (!isVehicle) {
      return {
        item: rawItem,
        index,
        isVehicle: false,
        isPinnedMarketCohort,
        score: null,
        effectiveRelevance: typeof rawItem.relevance_score === 'number' ? rawItem.relevance_score : 0.5,
      };
    }

    const meta =
      rawItem.metadata && typeof rawItem.metadata === 'object' ? rawItem.metadata : undefined;
    const candidateInput: SearchFacetInput = {
      year: rawItem.year ?? meta?.year,
      make: rawItem.make ?? meta?.make,
      model: rawItem.model ?? meta?.model ?? meta?.normalized_model,
      familyLabel: rawItem.familyLabel ?? meta?.family_name,
      series: rawItem.series ?? meta?.series,
      trim: rawItem.trim ?? meta?.trim,
      bodyStyle:
        rawItem.bodyStyle ??
        rawItem.body_style ??
        meta?.body_style ??
        meta?.bodyStyle,
      title: rawItem.title ?? meta?.title,
      subtitle: rawItem.subtitle,
      description: rawItem.description,
      label: rawItem.label,
    };

    const score = scoreVehicleFacetMatch(queryFacets, candidateInput);
    const baseRelevance =
      typeof rawItem.relevance_score === 'number' ? rawItem.relevance_score : 0.5;
    const effectiveRelevance = Math.max(0, Number((baseRelevance + score.boost).toFixed(4)));

    const updatedItem: Record<string, any> = {
      ...rawItem,
      relevance_score: effectiveRelevance,
    };

    if (meta || itemType) {
      updatedItem.metadata = {
        ...(meta ?? {}),
        series: meta?.series ?? score.candidateFacets.series ?? undefined,
        trim: meta?.trim ?? score.candidateFacets.trim ?? undefined,
        body_style: meta?.body_style ?? score.candidateFacets.body ?? undefined,
        matched_facets: score.matchedAxes,
        facet_boost: score.boost,
      };
    }

    return {
      item: updatedItem as T,
      index,
      isVehicle: true,
      isPinnedMarketCohort: false,
      score,
      effectiveRelevance,
    };
  });

  const fullMatchCount = entries.filter(
    (e) => e.isVehicle && e.score?.matchesAllQueryFacets,
  ).length;
  const partialMatchCount = entries.filter(
    (e) => e.isVehicle && (e.score?.matchedAxes.length ?? 0) > 0,
  ).length;

  let filtered = entries;
  if (filterNonMatchingVehicles) {
    if (fullMatchCount >= minMatchingVehiclesToFilter) {
      filtered = entries.filter(
        (e) => !e.isVehicle || Boolean(e.score?.matchesAllQueryFacets),
      );
    } else if (partialMatchCount >= minMatchingVehiclesToFilter) {
      filtered = entries.filter(
        (e) => !e.isVehicle || (e.score?.matchedAxes.length ?? 0) > 0,
      );
    }
  }

  return [...filtered]
    .sort((a, b) => {
      if (a.isPinnedMarketCohort !== b.isPinnedMarketCohort) {
        return a.isPinnedMarketCohort ? -1 : 1;
      }
      const aFull = a.score?.matchesAllQueryFacets ? 1 : 0;
      const bFull = b.score?.matchesAllQueryFacets ? 1 : 0;
      if (bFull !== aFull) return bFull - aFull;

      const aAxes = a.score?.matchedAxes.length ?? 0;
      const bAxes = b.score?.matchedAxes.length ?? 0;
      if (bAxes !== aAxes) return bAxes - aAxes;

      if (b.effectiveRelevance !== a.effectiveRelevance) {
        return b.effectiveRelevance - a.effectiveRelevance;
      }
      return a.index - b.index;
    })
    .map((e) => e.item);
}

/**
 * Builds the Supabase `.or(...)` filter for the local vehicle fallback query,
 * expanding Series, Trim, and Body Style facet synonyms (e.g. Split-Window -> 1963 Corvette,
 * Stepside -> Flareside, Fastback -> SportsRoof / 2+2).
 */
export function buildFacetExpandedOrFilter(
  rawQuery: string,
  canonicalFamilyOrModel?: string | null,
): string {
  const safeQuery = rawQuery.trim().replace(/([%_\\])/g, '\\$1');
  const canonicalSafe = (canonicalFamilyOrModel ?? '').trim().replace(/([%_\\])/g, '\\$1');
  const queryFacets = extractQueryFacets(rawQuery);

  const clauses = new Set<string>();
  if (canonicalSafe && canonicalSafe.toLowerCase() !== safeQuery.toLowerCase()) {
    clauses.add(`model.ilike.%${canonicalSafe}%`);
    clauses.add(`normalized_model.ilike.%${canonicalSafe}%`);
    clauses.add(`make.ilike.%${safeQuery}%`);
    clauses.add(`model.ilike.%${safeQuery}%`);
    clauses.add(`title.ilike.%${canonicalSafe}%`);
  } else {
    clauses.add(`make.ilike.%${safeQuery}%`);
    clauses.add(`model.ilike.%${safeQuery}%`);
    clauses.add(`normalized_model.ilike.%${safeQuery}%`);
    clauses.add(`series.ilike.%${safeQuery}%`);
    clauses.add(`trim.ilike.%${safeQuery}%`);
    clauses.add(`body_style.ilike.%${safeQuery}%`);
    clauses.add(`title.ilike.%${safeQuery}%`);
  }

  if (queryFacets.trim) {
    const safeTrim = queryFacets.trim.replace(/([%_\\])/g, '\\$1');
    clauses.add(`trim.ilike.%${safeTrim}%`);
    clauses.add(`model.ilike.%${safeTrim}%`);
    clauses.add(`title.ilike.%${safeTrim}%`);
  }

  if (queryFacets.body === 'Split-Window Coupe') {
    clauses.add('body_style.ilike.%Split%Window%');
    clauses.add('title.ilike.%Split%Window%');
    clauses.add('model.ilike.%Corvette%');
  } else if (queryFacets.body === 'Stepside / Flareside') {
    clauses.add('body_style.ilike.%Stepside%');
    clauses.add('body_style.ilike.%Flareside%');
    clauses.add('title.ilike.%Stepside%');
    clauses.add('title.ilike.%Flareside%');
  } else if (queryFacets.body === 'Fleetside / Styleside') {
    clauses.add('body_style.ilike.%Fleetside%');
    clauses.add('body_style.ilike.%Styleside%');
    clauses.add('title.ilike.%Fleetside%');
    clauses.add('title.ilike.%Styleside%');
  } else if (queryFacets.body === 'Fastback') {
    clauses.add('body_style.ilike.%Fastback%');
    clauses.add('title.ilike.%Fastback%');
    clauses.add('title.ilike.%SportsRoof%');
  } else if (queryFacets.body === 'Targa / T-Top') {
    clauses.add('body_style.ilike.%Targa%');
    clauses.add('title.ilike.%Targa%');
  } else if (queryFacets.body === 'Gullwing Coupe') {
    clauses.add('body_style.ilike.%Gullwing%');
    clauses.add('title.ilike.%Gullwing%');
    clauses.add('model.ilike.%300SL%');
  }

  return Array.from(clauses).join(',');
}

export interface HeaderSearchFacetPillsProps extends SearchFacetInput {
  compact?: boolean;
  className?: string;
  /** Vetted era mark for the row; shown in place of the derived tile emblem. */
  eraMark?: VehicleIdentityMark | null;
  eraMarkTestId?: string;
}

export const HeaderSearchFacetPills: React.FC<HeaderSearchFacetPillsProps> = ({
  compact = false,
  className = '',
  eraMark = null,
  eraMarkTestId,
  ...facetInput
}) => {
  const summary = React.useMemo(
    () => deriveSearchResultFacets(facetInput),
    [
      facetInput.year,
      facetInput.make,
      facetInput.model,
      facetInput.familyLabel,
      facetInput.series,
      facetInput.trim,
      facetInput.bodyStyle,
      facetInput.title,
      facetInput.subtitle,
      facetInput.description,
      facetInput.label,
    ],
  );

  const badgeSvg = eraMark ? undefined : summary.badgeSvg;
  if (summary.pills.length === 0 && !badgeSvg && !eraMark) {
    return null;
  }

  const rootClassName = [
    'header-search-facets',
    compact ? 'header-search-facets--compact' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName} data-testid="header-search-facets">
      {eraMark && <HeaderSearchEraMark mark={eraMark} testId={eraMarkTestId} />}
      {badgeSvg && (
        <span
          className="header-search-facet-emblem"
          data-testid="header-search-facet-emblem"
          title={[summary.year, summary.make, summary.trim ?? summary.series ?? summary.body]
            .filter(Boolean)
            .join(' ')}
          dangerouslySetInnerHTML={{ __html: badgeSvg }}
        />
      )}
      {summary.pills.map((pill) => (
        <span
          key={`${pill.kind}-${pill.value}`}
          className={`header-search-facet-pill header-search-facet-pill--${pill.kind}`}
          data-testid={`header-search-facet-${pill.kind}`}
          data-facet-kind={pill.kind}
          data-facet-value={pill.value}
        >
          <span className="header-search-facet-axis">{pill.axisLabel}</span>
          <span className="header-search-facet-sep">·</span>
          <span className="header-search-facet-value">{pill.value}</span>
        </span>
      ))}
    </div>
  );
};

/**
 * Resolves the vetted era mark for a header search vehicle row. A row without a recorded
 * or titled model year gets no mark: the era is what the mark asserts.
 */
export function resolveSearchResultEraMark(input: SearchFacetInput): VehicleIdentityMark | null {
  const compositeText = [input.title, input.label, input.subtitle, input.description]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  const make = parseMakeFromText(input.make, compositeText);
  const year = parseYearFromText(input.year, compositeText);
  if (!make || year == null) return null;

  const model = input.model?.trim() || input.familyLabel?.trim() || compositeText || null;
  const marks = resolveVehicleIdentityMarks({
    brand: make,
    family: model,
    year,
    seriesCode: input.series ?? null,
    trimPackage: input.trim ?? null,
    bodyStyle: input.bodyStyle ?? null,
  });
  return marks[0] ?? null;
}

export interface HeaderSearchEraMarkProps {
  mark: VehicleIdentityMark;
  testId?: string;
}

export const HeaderSearchEraMark: React.FC<HeaderSearchEraMarkProps> = ({ mark, testId }) => (
  <span
    className="header-search-era-mark"
    data-testid={testId ?? 'header-search-era-mark'}
    data-mark-id={mark.id}
    title={`${mark.displayLabel} — ${mark.provenanceNote}`}
    aria-label={`${mark.displayLabel}: ${mark.provenanceNote}`}
    role="img"
    dangerouslySetInnerHTML={{ __html: mark.svgMarkup }}
  />
);

export interface HeaderSearchCohortShortcutsProps {
  shortcuts: readonly MarketCohortShortcut[];
  onSelect: (shortcut: MarketCohortShortcut) => void;
  activeIndex?: number;
  onActivate?: (index: number) => void;
}

/** Market Map cohort shortcuts (SERIES / TRIM / BODY drilldowns) shown above header search results. */
export const HeaderSearchCohortShortcuts: React.FC<HeaderSearchCohortShortcutsProps> = ({
  shortcuts,
  onSelect,
  activeIndex = -1,
  onActivate,
}) => {
  if (shortcuts.length === 0) return null;

  return (
    <div className="header-search-cohorts" data-testid="market-cohort-shortcuts-section">
      <div className="header-search-cohorts-head">
        <span>MARKET COHORT SHORTCUTS</span>
        <span>FACET DRILLDOWN</span>
      </div>
      {shortcuts.map((shortcut, index) => (
        <button
          key={shortcut.id}
          type="button"
          className={[
            'header-search-cohort',
            index === activeIndex ? 'header-search-cohort--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-testid={`market-cohort-shortcut-${shortcut.id}`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onActivate?.(index)}
          onClick={() => onSelect(shortcut)}
        >
          <span
            className="header-search-cohort-mark"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: shortcut.svgMarkup }}
          />
          <span className="header-search-cohort-text">
            <span className="header-search-cohort-label" data-testid="market-cohort-shortcut-label">
              {shortcut.make} {shortcut.family} · {shortcut.axisDisplayLabel}: {shortcut.facet}
            </span>
            <span className="header-search-cohort-sub">{shortcut.subLabel}</span>
          </span>
          {shortcut.yearRangeLabel && (
            <span className="header-search-cohort-era" data-testid="market-cohort-shortcut-era">
              {shortcut.yearRangeLabel}
            </span>
          )}
          <span className="header-search-cohort-pill">MARKET MAP</span>
        </button>
      ))}
    </div>
  );
};

export interface HeaderSearchProps {
  className?: string;
}

export const HeaderSearch: React.FC<HeaderSearchProps> = ({ className }) => {
  return <AIDataIngestionSearch className={className} />;
};

export default HeaderSearch;
