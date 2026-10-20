import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { OrgLogo } from '../../components/common/OrgLogo';
import { MakeIdentity } from '../../components/common/MakeIdentity';
import { sourceLogoInk } from './sourceLogoInk';
import { matchesSaleSubModel, readFamilySales, type Sale } from './FamilySalesChart';
import {
  buildFacetDrilldownUrl,
  classifyVehicleFacet,
  resolveVehicleIdentityMark,
} from '../../lib/market/vehicleTaxonomy';
import { VenueMix, type HouseRow } from './MarketTile';
import './SourcesBoard.css';

// Every source on one board with the same measures, ranked by the lots we hold for it (market_sources_read,
// 20261018034000). Owner, 2026-10-15: "when are we gonna see the site treat all sources the same? the sources should be
// rising based on their data". No source is named in this file: the order, the bars and the counts all come from the
// reader, so a source moves up as more of its data lands. Held counts carry the time their fold was measured.
const COLUMNS = ['source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population', 'population_method',
  'population_confidence', 'population_at', 'map_sales', 'map_usd', 'sales_12m', 'usd_12m', 'sales_prior_12m',
  'usd_prior_12m', 'months', 'live_lots', 'live_at', 'held_lots_before', 'before_day', 'landed_24h', 'landed_7d',
  'last_landed', 'days14', 'logo_url', 'business_type', 'population_grade', 'species', 'species_label', 'counts_as_held',
  'species_evidence', 'venue_lots', 'venue_slug', 'members'] as const;
type Column = typeof COLUMNS[number];
const SHOWN = 10;

export type LandingHorizon = '14d' | '24h' | '1h';

export type LandingRecentEvent = {
  id: string;
  source: string;
  eventType: string | null;
  eventStatus: string | null;
  reserve: string | null;
  price: number | null;
  bidCount: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  series?: string | null;
  trim: string | null;
  bodyStyle?: string | null;
  vin: string | null;
  mileage: number | null;
  recordDate: string | null;
  title: string | null;
  rawTitle: string | null;
  lot: string | null;
  vehicleId: string | null;
  sourceUrl: string | null;
  createdAt: string;
  /** An Internet Archive capture of the source's page: its status and clocks are as of the capture, not now. */
  archived?: boolean;
  capturedAt?: string | null;
};

/** Every event landed in the drill-down's window (24 hours, or the selected hour), counted by the reader. */
export type LandingWindow = {
  since: string | null;
  events: number;
  capped: boolean;
  sold: number;
  ended: number;
  live: number;
  archived: number;
  soldPriced: number;
  medianSoldPrice: number | null;
};

export type SourceTopMakeEntry = {
  make: string;
  count: number;
};

export type SourceTopModelEntry = {
  make: string | null;
  model: string;
  count: number;
};

export type StreamFacetDistributionPill = {
  axis: 'series' | 'trim' | 'body';
  prefix: 'SER' | 'TRM' | 'BDY';
  value: string;
  count: number;
};

export type DrillStreamSortMode = 'latest' | 'price' | 'year';

export type DrillCohortSummary = {
  totalStreamCount: number;
  filteredCount: number;
  soldCount: number;
  sellThroughPct: number | null;
  medianSoldPrice: number | null;
};

export type SourceDrillStats = {
  source: string | null;
  name: string | null;
  category: string | null;
  house: string | null;
  held: number | null;
  heldAt: string | null;
  /** Events landed after `heldAt`, when the held count was measured. */
  heldSince?: number | null;
  population: number | null;
  populationMethod: string | null;
  populationConfidence: number | null;
  populationAt: string | null;
  coverageShare: number | null;
  mapSales: number | null;
  mapUsd: number | null;
  sales12: number | null;
  usd12: number | null;
  salesPrior12: number | null;
  usdPrior12: number | null;
  topMakes?: SourceTopMakeEntry[];
  topModels?: SourceTopModelEntry[];
};

export type SourceLandingDetail = {
  asOf: string;
  source: string | null;
  hour: string | null;
  selectedHour: string | null;
  bucket5m: string | null;
  landed15m: number;
  landed1h: number;
  landed24: number;
  landed7: number;
  lastLanded: string | null;
  hours24: number[];
  mins60: number[];
  days14: number[];
  stats: SourceDrillStats | null;
  window?: LandingWindow | null;
  topMakes?: SourceTopMakeEntry[];
  topModels?: SourceTopModelEntry[];
  recent: LandingRecentEvent[];
};

/** An earlier labelled reference graded by the exact census that followed it; error is (reference − census) / census. */
export type PopulationGrade = {
  reference: number; referenceMethod: string; referenceAt: string | null;
  census: number; censusAt: string | null; error: number;
};

export type SourceRow = {
  source: string; name: string; category: string | null; house: string | null;
  held: number | null; heldAt: string | null;
  currentInventory?: { count: number; observedAt: string | null; url: string | null };
  population: number | null; populationMethod: string | null; populationConfidence: number | null; populationAt: string | null;
  populationGrade?: PopulationGrade | null;
  mapSales: number | null; mapUsd: number | null;
  sales12: number | null; usd12: number | null; salesPrior12: number | null; usdPrior12: number | null;
  /** [YYYY-MM, sales, dollars], oldest first, the last 24 months. */
  months: [string, number, number][];
  live: number; liveAt: string | null;
  heldBefore: number | null; beforeDay: string | null;
  /** Records landed (vehicle_events) in the last 15m, 1h, 24h, and 7d, the last timestamp any landed, and 14d / 24h / 60m bins. */
  landed15m: number; landed1h: number; landed24: number; landed7: number; lastLanded: string | null;
  days14: number[]; hours24: number[]; mins60: number[];
  /** The source's organization's recorded identity (organizations.logo_url, business_type), drawn by OrgLogo. */
  logoUrl: string | null; businessType: string | null;
  /** How its listings live (observation_sources.species, data-machine-cases.md §6), the doc's name for it, whether its
   *  pages count as listings held (aggregators' do not), and what the label was read from. */
  species?: string | null; speciesLabel?: string | null; countsAsHeld?: boolean | null;
  speciesEvidence?: SpeciesEvidence | null;
  /** Lots this source sold through a venue the board already counts (a dealer's BaT lots), shown apart from held and
   *  never added to it; the venue; and, on a seller-cohort row, the sellers the row counts (20261020201000). */
  venueLots?: number | null; venueSlug?: string | null; members?: number | null;
  /** Optional dealer organization identifier/slug and headquarters city/state metadata when provided. */
  organizationId?: string | null;
  hqCity?: string | null;
  hqState?: string | null;
  hqLocation?: string | null;
};

export type BoardLandingMeta = {
  hour: string | null;
  bucket5m: string | null;
  landed15m: number;
  landed1h: number;
  landed24: number;
  landed7: number;
  hours24: number[];
  mins60: number[];
};

export type SpeciesEvidence = { examinedAt: string | null; examined: string[]; seen: string | null; doc: string | null };

/** One board group as the reader names it (source_species_groups()). */
export type SpeciesGroup = { species: string; label: string; unit: string; countsAsHeld: boolean };

export type SourcesBoardData = {
  asOf: string;
  day: string | null;
  rows: SourceRow[];
  notRanked: Record<string, number>;
  landing: BoardLandingMeta;
  /** Present once the reader groups by species; absent from older payloads, which group by category. */
  speciesGroups?: SpeciesGroup[] | null;
};

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x
  : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
const numArray = (x: unknown, len?: number): number[] => {
  if (!Array.isArray(x)) return len ? Array(len).fill(0) : [];
  const parsed = x.map((item) => num(item) ?? 0);
  if (len && parsed.length < len) return [...Array(len - parsed.length).fill(0), ...parsed];
  return parsed;
};
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function parseGrade(x: unknown): PopulationGrade | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const g = x as Record<string, unknown>;
  const reference = num(g.reference), census = num(g.census), error = num(g.error), referenceMethod = str(g.reference_method);
  if (reference == null || census == null || error == null || !referenceMethod) return null;
  return { reference, referenceMethod, referenceAt: str(g.reference_at), census, censusAt: str(g.census_at), error };
}
function parseSpeciesEvidence(x: unknown): SpeciesEvidence | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const e = x as Record<string, unknown>;
  const examined = Array.isArray(e.examined) ? e.examined.filter((u): u is string => typeof u === 'string' && !!u) : [];
  const seen = str(e.seen);
  if (!seen && !examined.length) return null;
  return { examinedAt: str(e.examined_at), examined, seen, doc: str(e.doc) };
}
function parseSpeciesGroups(x: unknown): SpeciesGroup[] | null {
  if (!Array.isArray(x)) return null;
  const out = x.flatMap((g) => {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return [];
    const o = g as Record<string, unknown>;
    const species = str(o.species), label = str(o.label);
    return species && label ? [{ species, label, unit: str(o.unit) ?? 'held', countsAsHeld: o.counts_as_held !== false }] : [];
  });
  return out.length ? out : null;
}

/** The reader's value as typed rows, decoded by column name; anything else is null. */
export function parseSources(value: unknown): SourcesBoardData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as {
    as_of?: unknown;
    day?: unknown;
    columns?: unknown;
    rows?: unknown;
    not_ranked?: unknown;
    landing?: unknown;
    species_groups?: unknown;
    current_inventory?: Record<string, { count?: unknown; observed_at?: unknown; url?: unknown; method?: unknown }>;
  };
  if (typeof v.as_of !== 'string' || !Array.isArray(v.columns) || !Array.isArray(v.rows)) return null;
  const columns = v.columns as unknown[];
  const at = Object.fromEntries(COLUMNS.map((c) => [c, columns.indexOf(c)])) as Record<Column, number>;
  if (at.source < 0 || at.name < 0 || at.held_lots < 0) return null;

  const rawLanding = v.landing && typeof v.landing === 'object' && !Array.isArray(v.landing)
    ? (v.landing as { hour?: unknown; bucket_5m?: unknown; totals?: unknown; sources?: unknown })
    : null;
  const rawSourcesLanding = rawLanding?.sources && typeof rawLanding.sources === 'object' && !Array.isArray(rawLanding.sources)
    ? (rawLanding.sources as Record<string, unknown>)
    : {};
  const rawTotals = rawLanding?.totals && typeof rawLanding.totals === 'object' && !Array.isArray(rawLanding.totals)
    ? (rawLanding.totals as Record<string, unknown>)
    : {};

  const rows: SourceRow[] = [];
  for (const r of v.rows) {
    if (!Array.isArray(r)) continue;
    const get = (c: Column) => (at[c] >= 0 ? r[at[c]] : null);
    const source = str(get('source')), name = str(get('name'));
    if (!source || !name) continue;
    const months = (Array.isArray(get('months')) ? get('months') as unknown[] : [])
      .filter((m): m is unknown[] => Array.isArray(m) && typeof m[0] === 'string')
      .map((m) => [m[0] as string, num(m[1]) ?? 0, num(m[2]) ?? 0] as [string, number, number]);

    const srcLand = rawSourcesLanding[source] && typeof rawSourcesLanding[source] === 'object' && !Array.isArray(rawSourcesLanding[source])
      ? (rawSourcesLanding[source] as Record<string, unknown>)
      : null;

    const landed24 = num(srcLand?.landed_24h) ?? num(get('landed_24h')) ?? 0;
    const landed7 = num(srcLand?.landed_7d) ?? num(get('landed_7d')) ?? 0;
    const landed15m = num(srcLand?.landed_15m) ?? 0;
    const landed1h = num(srcLand?.landed_1h) ?? 0;
    const lastLanded = str(srcLand?.last_at) ?? str(get('last_landed'));
    const days14 = Array.isArray(get('days14')) ? (get('days14') as unknown[]).map((x) => num(x) ?? 0) : [];
    const hours24 = Array.isArray(srcLand?.hours24)
      ? numArray(srcLand.hours24, 24)
      : [...Array(23).fill(0), landed24];
    const mins60 = Array.isArray(srcLand?.mins60)
      ? numArray(srcLand.mins60, 12)
      : [...Array(11).fill(0), landed1h];

    const rawLogo = str(get('logo_url'));
    const logoUrl = rawLogo ? rawLogo.replace(/^https:\/\/nuke\.ag\/source-logos\//, '/source-logos/') : null;
    const getOptional = (...names: string[]): unknown => {
      for (const n of names) {
        const idx = columns.indexOf(n);
        if (idx >= 0 && r[idx] != null) return r[idx];
      }
      return null;
    };
    const organizationId = str(getOptional('organization_id', 'org_id', 'business_id', 'org_slug', 'organization_slug'));
    const hqCity = str(getOptional('hq_city', 'city'));
    const hqState = str(getOptional('hq_state', 'state'));
    const hqLocation = str(getOptional('hq_location', 'location'));

    const inventory = v.current_inventory?.[source];
    const inventoryCount = inventory?.method === 'search_result_count' ? num(inventory.count) : null;
    const currentInventory = inventoryCount != null && Number.isInteger(inventoryCount) && inventoryCount >= 0
      ? { count: inventoryCount, observedAt: str(inventory?.observed_at), url: str(inventory?.url) } : undefined;
    rows.push({
      currentInventory,
      source, name, category: str(get('category')), house: str(get('house')),
      held: num(get('held_lots')), heldAt: str(get('held_at')),
      population: num(get('population')), populationMethod: str(get('population_method')),
      populationConfidence: num(get('population_confidence')), populationAt: str(get('population_at')),
      populationGrade: parseGrade(get('population_grade')),
      mapSales: num(get('map_sales')), mapUsd: num(get('map_usd')),
      sales12: num(get('sales_12m')), usd12: num(get('usd_12m')), salesPrior12: num(get('sales_prior_12m')),
      usdPrior12: num(get('usd_prior_12m')), months,
      live: num(get('live_lots')) ?? 0, liveAt: str(get('live_at')),
      heldBefore: num(get('held_lots_before')), beforeDay: str(get('before_day')),
      landed15m, landed1h, landed24, landed7, lastLanded,
      days14, hours24, mins60,
      logoUrl, businessType: str(get('business_type')),
      species: str(get('species')), speciesLabel: str(get('species_label')),
      countsAsHeld: typeof get('counts_as_held') === 'boolean' ? get('counts_as_held') as boolean : null,
      speciesEvidence: parseSpeciesEvidence(get('species_evidence')),
      venueLots: num(get('venue_lots')), venueSlug: str(get('venue_slug')), members: num(get('members')),
      organizationId, hqCity, hqState, hqLocation,
    });
  }
  const notRanked: Record<string, number> = {};
  if (v.not_ranked && typeof v.not_ranked === 'object' && !Array.isArray(v.not_ranked)) {
    for (const [k, n] of Object.entries(v.not_ranked as Record<string, unknown>)) { const c = num(n); if (c) notRanked[k] = c; }
  }

  const landing: BoardLandingMeta = {
    hour: str(rawLanding?.hour) ?? str(v.as_of),
    bucket5m: str(rawLanding?.bucket_5m) ?? str(v.as_of),
    landed15m: num(rawTotals.landed_15m) ?? rows.reduce((acc, r) => acc + r.landed15m, 0),
    landed1h: num(rawTotals.landed_1h) ?? rows.reduce((acc, r) => acc + r.landed1h, 0),
    landed24: num(rawTotals.landed_24h) ?? rows.reduce((acc, r) => acc + r.landed24, 0),
    landed7: num(rawTotals.landed_7d) ?? rows.reduce((acc, r) => acc + r.landed7, 0),
    hours24: Array.isArray(rawTotals.hours24) ? numArray(rawTotals.hours24, 24) : Array(24).fill(0),
    mins60: Array.isArray(rawTotals.mins60) ? numArray(rawTotals.mins60, 12) : Array(12).fill(0),
  };

  return { asOf: v.as_of, day: str(v.day), rows, notRanked, landing, speciesGroups: parseSpeciesGroups(v.species_groups) };
}

function parseTopMakesList(raw: unknown): SourceTopMakeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SourceTopMakeEntry[] = [];
  for (const item of raw) {
    if (Array.isArray(item)) {
      const mk = str(item[0]);
      const cnt = num(item[1]) ?? 1;
      if (mk) out.push({ make: mk, count: cnt });
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const mk = str(obj.make) ?? str(obj.name) ?? str(obj.label);
      const cnt = num(obj.count) ?? num(obj.lots) ?? num(obj.vehicles) ?? num(obj.total) ?? 1;
      if (mk) out.push({ make: mk, count: cnt });
    } else if (typeof item === 'string' && item.trim()) {
      out.push({ make: item.trim(), count: 1 });
    }
  }
  return out;
}

function parseTopModelsList(raw: unknown): SourceTopModelEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SourceTopModelEntry[] = [];
  for (const item of raw) {
    if (Array.isArray(item)) {
      if (item.length >= 3) {
        const mk = str(item[0]);
        const md = str(item[1]);
        const cnt = num(item[2]) ?? 1;
        if (md) out.push({ make: mk, model: md, count: cnt });
      } else {
        const md = str(item[0]);
        const cnt = num(item[1]) ?? 1;
        if (md) out.push({ make: null, model: md, count: cnt });
      }
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const mk = str(obj.make) ?? str(obj.brand) ?? null;
      const md = str(obj.model) ?? str(obj.name) ?? str(obj.label);
      const cnt = num(obj.count) ?? num(obj.lots) ?? num(obj.vehicles) ?? num(obj.total) ?? 1;
      if (md) out.push({ make: mk, model: md, count: cnt });
    } else if (typeof item === 'string' && item.trim()) {
      out.push({ make: null, model: item.trim(), count: 1 });
    }
  }
  return out;
}

/** Decodes public.market_source_landing_read(p_source, p_hour). */
export function parseSourceLanding(value: unknown): SourceLandingDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.as_of !== 'string') return null;
  const recent: LandingRecentEvent[] = [];
  const rawRecentList =
    Array.isArray(v.recent_vehicles) && v.recent_vehicles.length > 0
      ? v.recent_vehicles
      : Array.isArray(v.recent)
        ? v.recent
        : Array.isArray(v.recent_vehicles)
          ? v.recent_vehicles
          : [];
  for (let idx = 0; idx < rawRecentList.length; idx += 1) {
    const item = rawRecentList[idx];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const ev = item as Record<string, unknown>;
    const id = str(ev.id) ?? str(ev.vehicle_id) ?? `ev-${idx}`;
    const source = str(ev.source) ?? str(v.source) ?? 'unknown';
    const createdAt = str(ev.created_at) ?? str(ev.createdAt) ?? v.as_of;
    if (!id || !source || !createdAt) continue;
    recent.push({
      id,
      source,
      eventType: str(ev.event_type) ?? str(ev.eventType),
      eventStatus: str(ev.event_status) ?? str(ev.eventStatus),
      reserve: str(ev.reserve),
      price: num(ev.price),
      bidCount: num(ev.bid_count) ?? num(ev.bidCount),
      year: num(ev.year),
      make: str(ev.make),
      model: str(ev.model),
      series: str(ev.series),
      trim: str(ev.trim),
      bodyStyle: str(ev.body_style) ?? str(ev.bodyStyle),
      vin: str(ev.vin),
      mileage: num(ev.mileage),
      recordDate: str(ev.record_date) ?? str(ev.recordDate),
      title: str(ev.title),
      rawTitle: str(ev.raw_title) ?? str(ev.rawTitle),
      lot: str(ev.lot),
      vehicleId: str(ev.vehicle_id) ?? str(ev.vehicleId),
      sourceUrl: str(ev.source_url) ?? str(ev.sourceUrl),
      createdAt,
      archived: ev.archived === true,
      capturedAt: str(ev.captured_at) ?? str(ev.capturedAt),
    });
  }
  const rawStats = v.stats && typeof v.stats === 'object' && !Array.isArray(v.stats)
    ? (v.stats as Record<string, unknown>)
    : null;
  const rawWindow = v.window && typeof v.window === 'object' && !Array.isArray(v.window)
    ? (v.window as Record<string, unknown>)
    : null;
  const landingWindow: LandingWindow | null = rawWindow && num(rawWindow.events) != null
    ? {
        since: str(rawWindow.since),
        events: num(rawWindow.events) ?? 0,
        capped: rawWindow.capped === true,
        sold: num(rawWindow.sold) ?? 0,
        ended: num(rawWindow.ended) ?? 0,
        live: num(rawWindow.live) ?? 0,
        archived: num(rawWindow.archived) ?? 0,
        soldPriced: num(rawWindow.sold_priced) ?? 0,
        medianSoldPrice: num(rawWindow.median_sold_price),
      }
    : null;
  const parsedTopMakes = parseTopMakesList(
    v.top_makes ?? v.topMakes ?? rawStats?.top_makes ?? rawStats?.topMakes,
  );
  const parsedTopModels = parseTopModelsList(
    v.top_models ?? v.topModels ?? rawStats?.top_models ?? rawStats?.topModels,
  );
  const stats: SourceDrillStats | null = rawStats
    ? {
        source: str(rawStats.source),
        name: str(rawStats.name),
        category: str(rawStats.category),
        house: str(rawStats.house),
        held: num(rawStats.held_lots),
        heldAt: str(rawStats.held_at),
        heldSince: num(rawStats.held_since),
        population: num(rawStats.population),
        populationMethod: str(rawStats.population_method),
        populationConfidence: num(rawStats.population_confidence),
        populationAt: str(rawStats.population_at),
        coverageShare: num(rawStats.coverage_share),
        mapSales: num(rawStats.map_sales),
        mapUsd: num(rawStats.map_usd),
        sales12: num(rawStats.sales_12m),
        usd12: num(rawStats.usd_12m),
        salesPrior12: num(rawStats.sales_prior_12m),
        usdPrior12: num(rawStats.usd_prior_12m),
        topMakes: parsedTopMakes.length > 0 ? parsedTopMakes : undefined,
        topModels: parsedTopModels.length > 0 ? parsedTopModels : undefined,
      }
    : null;
  return {
    asOf: v.as_of,
    source: str(v.source),
    hour: str(v.hour),
    selectedHour: str(v.selected_hour),
    bucket5m: str(v.bucket_5m),
    landed15m: num(v.landed_15m) ?? 0,
    landed1h: num(v.landed_1h) ?? 0,
    landed24: num(v.landed_24h) ?? 0,
    landed7: num(v.landed_7d) ?? 0,
    lastLanded: str(v.last_landed),
    hours24: numArray(v.hours24, 24),
    mins60: numArray(v.mins60, 12),
    days14: numArray(v.days14, 14),
    stats,
    window: landingWindow,
    topMakes: parsedTopMakes.length > 0 ? parsedTopMakes : undefined,
    topModels: parsedTopModels.length > 0 ? parsedTopModels : undefined,
    recent,
  };
}

const count = (n: number) => Math.round(n).toLocaleString('en-US');
const compactCount = (n: number) => {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
};
export function money(n: number | null): string {
  if (n == null || !(n > 0)) return '';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
/** Labelled references in source_census: a figure someone supplied or a catalogue estimated, never a count of the source
 * (data-machine.md, fleet-relative reporting). The board prints them as estimates with their kind and as-of day. */
const REFERENCE: Record<string, string> = {
  owner_reference: 'owner reference',
  catalogue_estimate: 'catalogue estimate',
  estimate: 'earlier estimate',
};
/** What share of the source's own total we hold, in words that keep the total's method. A reference also returns its
 * label and as-of day, so it reads as an estimate rather than a census. */
export function heldShare(row: Pick<SourceRow, 'held' | 'population' | 'populationMethod'> & Partial<Pick<SourceRow, 'populationAt' | 'currentInventory'>>):
  { share: number | null; text: string; reference?: string } {
  if (row.currentInventory) return { share: null, text: `${count(row.currentInventory.count)} current listings` };
  if (row.held == null) return { share: null, text: '' };
  if (!(row.population != null && row.population > 0)) return { share: null, text: 'their total unknown' };
  const share = row.held / row.population;
  const pct = share >= 0.995 ? '100%' : share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;
  const kind = REFERENCE[row.populationMethod ?? ''];
  if (kind) {
    const day = shortDay(row.populationAt ?? null);
    return { share: Math.min(1, share), text: `${pct} of ≈ ${count(row.population)}`, reference: day ? `${kind} · ${day}` : kind };
  }
  const of = row.populationMethod === 'enumerated' ? 'of' : 'of about';
  return { share: Math.min(1, share), text: `${pct} ${of} ${count(row.population)}` };
}
/** An earlier reference against the census that followed it, e.g. "earlier estimate 95,000 (Jan 28) was 65% low". */
export function gradeText(g: PopulationGrade | null | undefined): string {
  if (!g || g.census <= 0) return '';
  const off = Math.round(Math.abs(g.error) * 100);
  const kind = REFERENCE[g.referenceMethod] ?? g.referenceMethod;
  const day = shortDay(g.referenceAt);
  return `${kind} ${count(g.reference)}${day ? ` (${day})` : ''} was ${off === 0 ? 'within 1%' : `${off}% ${g.error < 0 ? 'low' : 'high'}`}`;
}
const METHOD: Record<string, string> = {
  owner_reference: 'owner reference, an estimate, not a count',
  catalogue_estimate: 'catalogue estimate, not a count',
  estimate: 'earlier estimate, not a count',
  enumerated: 'counted from their own listings',
  bounded: 'estimated within a range',
  search_index: 'from their search index',
  api_count: 'from their API total',
  sitemap: 'from their sitemap index',
  docket_and_broadcast_census: 'from docket & broadcast census',
  window_extrapolated: 'extrapolated from cohort window & gap density',
  turnover_model: 'modeled from active inventory & daily turnover',
  capture_model: 'modeled from capture velocity & unseen-mass prior',
};
function shortDay(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
/** The viewer's zone at that instant ("PDT"); every clock the board prints reads on the viewer's own clock with its zone
 * named (owner, 2026-10-16: "whats 18:52Z mean"). Record dates are calendar dates and stay as recorded. */
function zoneName(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
}
function heldWhen(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23' })} ${zoneName(d)}`;
}
export function formatAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ${min % 60}m ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** 24 monthly bars ending at the board's month: the earlier 12 faint, the last 12 solid. */
export function monthBars(months: SourceRow['months'], day: string | null): number[] {
  const end = day ? new Date(`${day}T00:00:00Z`) : new Date();
  const keys: string[] = [];
  for (let i = 23; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const by = new Map(months.map(([m, n]) => [m, n]));
  return keys.map((k) => by.get(k) ?? 0);
}
/** The map's drill scope as the URL carries it (make, family key and name, model or facet name). */
export type SourcesScope = { make: string | null; family?: string | null; familyName?: string | null; model?: string | null };
export type ScopeSourceSales = { sales12: number; salesPrior12: number; total: number; usd: number; months: SourceRow['months'] };
/** A drilled family's (or model's) dated sales of the last five years, tallied onto the board's rows by house. */
export type BoardScope = { label: string; short: string; total: number; unattributed: number; bySource: Map<string, ScopeSourceSales> };

export function scopeSourceSales(
  rows: Pick<SourceRow, 'source' | 'name' | 'house'>[],
  sales: Pick<Sale, 'sale_date' | 'usd' | 'source'>[],
  day: string | null,
  label: string,
  short = label,
): BoardScope {
  const index = new Map<string, string>();
  for (const r of rows) {
    for (const k of [r.house, shortName(r.name), r.name, r.source]) {
      if (k && !index.has(normKey(k))) index.set(normKey(k), r.source);
    }
  }
  const end = day ? Date.parse(`${day}T23:59:59Z`) : Date.now();
  const bySource = new Map<string, ScopeSourceSales>();
  const months = new Map<string, Map<string, [number, number]>>();
  let total = 0;
  let unattributed = 0;
  for (const s of sales) {
    const t = Date.parse(s.sale_date);
    if (!Number.isFinite(t) || t > end) continue;
    total += 1;
    const source = s.source ? index.get(normKey(s.source)) : undefined;
    if (!source) { unattributed += 1; continue; }
    const row = bySource.get(source) ?? { sales12: 0, salesPrior12: 0, total: 0, usd: 0, months: [] };
    row.total += 1;
    row.usd += s.usd > 0 ? s.usd : 0;
    if (t > end - 365 * 86_400_000) row.sales12 += 1;
    else if (t > end - 730 * 86_400_000) row.salesPrior12 += 1;
    bySource.set(source, row);
    const m = months.get(source) ?? new Map<string, [number, number]>();
    const key = s.sale_date.slice(0, 7);
    const cur = m.get(key) ?? [0, 0];
    m.set(key, [cur[0] + 1, cur[1] + (s.usd > 0 ? s.usd : 0)]);
    months.set(source, m);
  }
  for (const [source, row] of bySource) {
    row.months = [...(months.get(source) ?? new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, [n, usd]]) => [k, n, usd]);
  }
  return { label, short, total, unattributed, bySource };
}

function Spark({ bars }: { bars: number[] }) {
  const max = Math.max(...bars);
  if (!(max > 0)) return null;
  const w = 3, gap = 1, h = 18;
  return (
    <svg className="market-sources__spark" width={bars.length * (w + gap)} height={h} viewBox={`0 0 ${bars.length * (w + gap)} ${h}`}
      aria-hidden="true">
      {bars.map((n, i) => {
        const bh = n > 0 ? Math.max(1, (n / max) * h) : 0;
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh}
          className={i < 12 ? 'market-sources__bar--prior' : 'market-sources__bar--recent'} />;
      })}
    </svg>
  );
}

/** Landing now: records in the selected horizon (14d / 24h / 1h), a dot that says whether any landed, idle since when if not. */
export function landingState(
  row: Pick<SourceRow, 'landed24' | 'lastLanded'> & Partial<Pick<SourceRow, 'landed1h' | 'landed15m'>>,
  horizon: LandingHorizon | number = '14d',
): { active: boolean; text: string } {
  const mode: LandingHorizon = typeof horizon === 'string' ? horizon : '14d';
  const l15 = row.landed15m ?? 0;
  const l1h = row.landed1h ?? 0;

  if (mode === '1h') {
    if (l15 > 0) return { active: true, text: `+${count(l15)}/15m · ${count(l1h)} 1h` };
    if (l1h > 0) return { active: true, text: `+${count(l1h)} in 1h` };
    if (row.landed24 > 0) return { active: false, text: `0 in 1h · +${count(row.landed24)} today` };
  } else if (mode === '24h') {
    if (l1h > 0) return { active: true, text: `+${count(l1h)}/hr · ${count(row.landed24)} 24h` };
    if (row.landed24 > 0) return { active: true, text: `+${count(row.landed24)} / 24h` };
  } else if (row.landed24 > 0) {
    return { active: true, text: `+${count(row.landed24)} today` };
  }

  if (!row.lastLanded) return { active: false, text: 'idle 14+ days' };   // the landing log keeps 14 days
  const t = Date.parse(row.lastLanded);
  if (Number.isNaN(t)) return { active: false, text: 'idle' };
  return { active: false, text: `idle since ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` };
}

function DayBars({ days, mode = '14d' }: { days: number[]; mode?: LandingHorizon }) {
  const max = Math.max(0, ...days);
  if (!(max > 0) || days.length === 0) return null;
  const w = mode === '24h' ? 2.5 : mode === '1h' ? 4.5 : 4;
  const gap = 1;
  const h = 16;
  const totalW = days.length * (w + gap);
  return (
    <svg className="market-sources__days" width={totalW} height={h} viewBox={`0 0 ${totalW} ${h}`}
      aria-hidden="true">
      {days.map((n, i) => {
        const bh = n > 0 ? Math.max(1, (Math.sqrt(n) / Math.sqrt(max)) * h) : 0;
        const isCurrent = i === days.length - 1 || (mode === '1h' && i >= days.length - 3 && n > 0);
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh}
          className={isCurrent ? 'market-sources__day--today' : 'market-sources__day'} />;
      })}
    </svg>
  );
}

/** A source's name without the registry's method note in parentheses ("eBay Motors (Browse API)" reads "eBay Motors"). */
export const shortName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '') || name;

export type SourceCategory = 'auction' | 'marketplace' | 'dealer';

export const CATEGORY_BADGE_LABELS: Record<SourceCategory, string> = {
  auction: 'AUCTION HOUSE',
  marketplace: 'MARKETPLACE',
  dealer: 'DEALER / CONSIGNOR',
};

export function resolveSourceCategory(row: Pick<SourceRow, 'category' | 'businessType'>): SourceCategory | null {
  if (row.category === 'dealer' || row.businessType === 'dealer') return 'dealer';
  if (row.category === 'auction' || row.businessType === 'auction_house') return 'auction';
  if (row.category === 'marketplace' || row.businessType === 'marketplace') return 'marketplace';
  return null;
}

export function categoryBadgeLabel(row: Pick<SourceRow, 'category' | 'businessType'>): string | null {
  const cat = resolveSourceCategory(row);
  return cat ? CATEGORY_BADGE_LABELS[cat] : null;
}

export const SPECIES_BADGE_LABELS: Record<string, string> = {
  timed_auction: 'TIMED AUCTION',
  block_house: 'BLOCK HOUSE',
  dealer: 'DEALER SITE',
  classifieds: 'CLASSIFIEDS',
  auth_walled_marketplace: 'AUTH-WALLED',
  aggregator: 'AGGREGATOR',
  private_seller: 'PRIVATE SELLERS',
  owner_private: 'OWNERS',
};

/** A row's badge: its species when the reader labels one, else its category. */
export function sourceBadge(
  row: Pick<SourceRow, 'category' | 'businessType'> & Partial<Pick<SourceRow, 'species' | 'speciesLabel'>>,
): { key: string; label: string } | null {
  if (row.species) {
    return { key: row.species, label: SPECIES_BADGE_LABELS[row.species] ?? (row.speciesLabel ?? row.species).toUpperCase() };
  }
  const cat = resolveSourceCategory(row);
  return cat ? { key: cat, label: CATEGORY_BADGE_LABELS[cat] } : null;
}

const SPECIES_HELD_LABELS: Record<string, string> = {
  timed_auction: 'Lots held',
  block_house: 'Lots held',
  dealer: 'Vehicles held',
  classifieds: 'Posts held',
  auth_walled_marketplace: 'Listings held',
  aggregator: 'Pages read (not listings held)',
  private_seller: 'BaT lots (by seller cohort)',
  owner_private: 'Vehicles with owner records',
};
/** The venue's short name on a row's "+N sold on …" note (venue_slug from the reader). */
const VENUE_NAMES: Record<string, string> = { bat: 'BaT' };

export const KNOWN_DEALER_ORGANIZATIONS: Record<string, string> = {
  'avant-garde-collection': 'avant-garde-collection',
  avantgardecollection: 'avant-garde-collection',
  beverlyhillscarclub: 'beverlyhillscarclub',
  'beverly-hills-car-club': 'beverlyhillscarclub',
  wob: 'wob',
  'collectible-classics': 'collectible-classics',
  collectibleclassics: 'collectible-classics',
  '1600veloce': '1600veloce',
  'vantage-auto': 'vantage-auto',
  vantageauto: 'vantage-auto',
  'geneva-motorcars': 'geneva-motorcars',
  genevamotorcars: 'geneva-motorcars',
  'aeg-motorsports': 'aeg-motorsports',
  aegmotorsports: 'aeg-motorsports',
  'lart-de-lautomobile': 'lart-de-lautomobile',
  lartdelautomobile: 'lart-de-lautomobile',
  'michaels-motor-cars': 'michaels-motor-cars',
  michaelsmotorcars: 'michaels-motor-cars',
  'private-collection-motors': 'private-collection-motors',
  privatecollectionmotors: 'private-collection-motors',
  'bullet-motorsports': 'bullet-motorsports',
  bulletmotorsports: 'bullet-motorsports',
  'mohr-imports': 'mohr-imports',
  mohrimports: 'mohr-imports',
  'dean-laumbach': 'dean-laumbach',
  deanlaumbach: 'dean-laumbach',
  'silver-arrow-cars': 'silver-arrow-cars',
  silverarrowcars: 'silver-arrow-cars',
  mcqueens: 'mcqueens',
  'fantasy-junction': 'fantasy-junction',
  fantasyjunction: 'fantasy-junction',
  'tactical-fleet': 'tactical-fleet',
  tacticalfleet: 'tactical-fleet',
  'streetside-classics': 'streetside-classics',
  streetsideclassics: 'streetside-classics',
  'grand-prix-classics': 'grand-prix-classics',
  grandprixclassics: 'grand-prix-classics',
  'vanguard-motor-sales': 'vanguard-motor-sales',
  vanguardmotorsales: 'vanguard-motor-sales',
  'gateway-classic-cars': 'gateway-classic-cars',
  gatewayclassiccars: 'gateway-classic-cars',
  'blue-chip-fleet': 'blue-chip-fleet',
  bluechipfleet: 'blue-chip-fleet',
  'velocity-restorations': 'velocity-restorations',
  velocityrestorations: 'velocity-restorations',
  'volo-auto-museum': 'volo-auto-museum',
  voloautomuseum: 'volo-auto-museum',
};

/**
 * Resolves a direct `/organization/<slug_or_id>` profile URL when a dealer source row
 * maps to a known dealer organization ID or slug.
 */
export function resolveDealerProfileHref(
  row: Pick<SourceRow, 'source' | 'category' | 'businessType'> & Partial<Pick<SourceRow, 'organizationId'>>,
): string | null {
  if (resolveSourceCategory(row) !== 'dealer') return null;
  const explicitId = row.organizationId?.trim();
  if (explicitId) return `/organization/${explicitId}`;
  const rawSource = row.source?.trim();
  if (!rawSource) return null;
  const known = KNOWN_DEALER_ORGANIZATIONS[rawSource.toLowerCase()] ?? KNOWN_DEALER_ORGANIZATIONS[normKey(rawSource)];
  if (known) return `/organization/${known}`;
  if (/^[a-z0-9][a-z0-9-_]*$/i.test(rawSource)) return `/organization/${rawSource}`;
  return null;
}

/**
 * Formats the dealer headquarters city/state badge when present in row metadata.
 */
export function formatDealerHqBadge(
  row: Partial<Pick<SourceRow, 'hqCity' | 'hqState' | 'hqLocation'>>,
): string | null {
  const loc = row.hqLocation?.trim();
  if (loc) return loc;
  const city = row.hqCity?.trim();
  const state = row.hqState?.trim();
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state) return state;
  return null;
}

export type DealerConsignmentBreakdown = {
  consignedCount: number;
  directCount: number;
  totalRecent: number;
  consignedPct: number | null;
  directPct: number | null;
  heldVehicles: number;
  liveVehicles: number;
  confirmedSales: number;
  sales12m: number;
  usd12m: number | null;
  modeLabel: string;
  summaryText: string;
  hqBadge: string | null;
  profileHref: string | null;
};

/**
 * Computes a dealer's consigned vs. direct inventory breakdown from its recent event stream
 * and source-day inventory/sales metrics so the expanded inspector shows clear dealer context.
 */
export function describeDealerConsignment(
  row: Pick<SourceRow, 'held' | 'live' | 'mapSales' | 'sales12' | 'usd12'> &
    Partial<Pick<SourceRow, 'source' | 'category' | 'businessType' | 'organizationId' | 'hqCity' | 'hqState' | 'hqLocation'>>,
  recent: ReadonlyArray<Pick<LandingRecentEvent, 'eventType' | 'eventStatus' | 'reserve' | 'bidCount'>>,
): DealerConsignmentBreakdown {
  let consignedCount = 0;
  let directCount = 0;
  for (const ev of recent) {
    const et = (ev.eventType ?? '').toLowerCase();
    const isAuctionOrConsigned =
      et === 'auction' ||
      et === 'consignment' ||
      (ev.bidCount != null && ev.bidCount > 0) ||
      ev.reserve === 'no_reserve' ||
      ev.reserve === 'reserve';
    if (isAuctionOrConsigned) consignedCount += 1;
    else directCount += 1;
  }
  const totalRecent = recent.length;
  const consignedPct = totalRecent > 0 ? Math.round((consignedCount / totalRecent) * 100) : null;
  const directPct = totalRecent > 0 ? 100 - (consignedPct ?? 0) : null;
  const heldVehicles = row.held ?? 0;
  const liveVehicles = row.live ?? 0;
  const confirmedSales = row.mapSales ?? 0;
  const sales12m = row.sales12 ?? 0;
  const usd12m = row.usd12 ?? null;

  let modeLabel = 'Consignment & direct inventory';
  if (totalRecent > 0) {
    if (consignedCount > 0 && directCount > 0) {
      modeLabel = `Mixed · ${consignedPct}% consigned / ${directPct}% direct`;
    } else if (consignedCount > 0) {
      modeLabel = `Auction consignment (${consignedCount}/${totalRecent} recent lots)`;
    } else {
      modeLabel = `Direct dealer listings (${directCount}/${totalRecent} recent listings)`;
    }
  } else if (confirmedSales > 0 && liveVehicles > 0) {
    modeLabel = 'Consignment & direct showroom';
  } else if (confirmedSales > 0) {
    modeLabel = 'Auction consignor';
  } else if (liveVehicles > 0) {
    modeLabel = 'Direct dealer showroom';
  }

  const parts: string[] = [`${count(heldVehicles)} vehicles held`];
  if (liveVehicles > 0) parts.push(`${count(liveVehicles)} live`);
  if (sales12m > 0) {
    parts.push(`${count(sales12m)} sales (12m)${usd12m ? ` · ${money(usd12m)}` : ''}`);
  } else if (confirmedSales > 0) {
    parts.push(`${count(confirmedSales)} confirmed sales`);
  }
  if (totalRecent > 0) {
    parts.push(`${consignedCount} consigned · ${directCount} direct in stream`);
  }

  const hqBadge = formatDealerHqBadge(row);
  const profileHref = row.source
    ? resolveDealerProfileHref({
        source: row.source,
        category: row.category ?? 'dealer',
        businessType: row.businessType ?? 'dealer',
        organizationId: row.organizationId,
      })
    : null;

  return {
    consignedCount,
    directCount,
    totalRecent,
    consignedPct,
    directPct,
    heldVehicles,
    liveVehicles,
    confirmedSales,
    sales12m,
    usd12m,
    modeLabel,
    summaryText: parts.join(' · '),
    hqBadge,
    profileHref,
  };
}

const GROUPS: [SourceCategory, string, string][] = [
  ['auction', 'Auction houses', 'lots held'],
  ['marketplace', 'Marketplaces', 'listings held'],
  ['dealer', 'Dealers', 'vehicles held'],
];
const NOT_RANKED_WORDS: Record<string, string> = {
  'capture channels': 'capture channel', aggregator: 'aggregator', dealer: 'dealer', shop: 'shop', registry: 'registry',
  social_media: 'social channel', forum: 'forum', documentation: 'archive', owner: 'owner source', internal: 'internal source',
  'no species evidence': 'source without species evidence', media_forum_video: 'media source', owner_private: 'owner source',
};

const HORIZON_LABELS: Record<LandingHorizon, string> = {
  '14d': 'landing, last 14 days',
  '24h': 'landing, last 24 hours',
  '1h': 'landing, live 60m',
};

const NEXT_HORIZON: Record<LandingHorizon, LandingHorizon> = {
  '14d': '24h',
  '24h': '1h',
  '1h': '14d',
};

function hourSlotIso(endHourIso: string | null, indexFromStart: number, total = 24): string | null {
  const base = endHourIso ? Date.parse(endHourIso) : Date.now();
  if (Number.isNaN(base)) return null;
  const slotMs = base - (total - 1 - indexFromStart) * 3600_000;
  return new Date(Math.floor(slotMs / 3600_000) * 3600_000).toISOString();
}

function daySlotIso(endDayIso: string | null, indexFromStart: number, total = 14): string {
  const base = endDayIso ? Date.parse(`${endDayIso.slice(0, 10)}T00:00:00Z`) : Date.now();
  if (Number.isNaN(base)) return '';
  return new Date(base - (total - 1 - indexFromStart) * 86400_000).toISOString().slice(0, 10);
}

/** The hour a bar starts, on the viewer's clock ("22:00"); the zone is named beside it by zoneName. */
function formatHourLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function formatExactTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })} ${zoneName(d)}`;
}

export type RecordDateSummary = {
  dateText: string;
  ageText: string;
  kind: 'live' | 'fresh' | 'backfill' | 'missing';
  fullTitle: string;
};

/**
 * Formats the record's own event/listing/sale date alongside its age so historical
 * backfills (e.g. 2021–2024 auctions ingested today) never look like brand-new live records.
 */
export function describeRecordDate(recordDate: string | null, now = Date.now()): RecordDateSummary {
  if (!recordDate || !recordDate.trim()) {
    return {
      dateText: 'no date',
      ageText: 'missing',
      kind: 'missing',
      fullTitle: 'Record event/listing date not extracted by ingestion pipeline',
    };
  }
  const raw = recordDate.trim();
  if (/^\d{4}$/.test(raw)) {
    const yr = Number(raw);
    const nowYr = new Date(now).getUTCFullYear();
    const diffYr = Math.max(0, nowYr - yr);
    return {
      dateText: String(yr),
      ageText: diffYr === 0 ? 'this yr' : `${diffYr}y old`,
      kind: diffYr === 0 ? 'fresh' : 'backfill',
      fullTitle: `Record year ${yr} (${diffYr === 0 ? 'current year' : `${diffYr}y old historical backfill`})`,
    };
  }
  const norm = raw.length === 10
    ? `${raw}T00:00:00Z`
    : raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T').replace(/([+-]\d{2})$/, '$1:00');
  const t = Date.parse(norm);
  if (Number.isNaN(t)) {
    return {
      dateText: raw.slice(0, 10),
      ageText: '',
      kind: 'backfill',
      fullTitle: raw,
    };
  }
  const d = new Date(t);
  const dateText = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  if (t > now + 60_000) {
    const remHrs = (t - now) / 3600_000;
    const ageText = remHrs >= 24 ? `ends +${Math.round(remHrs / 24)}d` : `ends +${Math.max(1, Math.round(remHrs))}h`;
    return {
      dateText,
      ageText,
      kind: 'live',
      fullTitle: `Live event closing ${dateText} (${ageText})`,
    };
  }
  const ageDays = Math.max(0, (now - t) / 86400_000);
  if (ageDays < 1) {
    return {
      dateText,
      ageText: 'today',
      kind: 'fresh',
      fullTitle: `Current-day record (${dateText})`,
    };
  }
  if (ageDays <= 14) {
    const dCount = Math.max(1, Math.round(ageDays));
    return {
      dateText,
      ageText: `${dCount}d old`,
      kind: 'fresh',
      fullTitle: `Recent record from ${dateText} (${dCount}d old)`,
    };
  }
  if (ageDays < 60) {
    const wCount = Math.max(2, Math.round(ageDays / 7));
    return {
      dateText,
      ageText: `${wCount}w old`,
      kind: 'backfill',
      fullTitle: `Historical backfill from ${dateText} (${wCount} weeks old)`,
    };
  }
  if (ageDays < 365) {
    const mCount = Math.max(2, Math.round(ageDays / 30.44));
    return {
      dateText,
      ageText: `${mCount}mo old`,
      kind: 'backfill',
      fullTitle: `Historical backfill from ${dateText} (${mCount} months old)`,
    };
  }
  const yrs = ageDays / 365.25;
  const yrStr = yrs >= 9.5 ? `${Math.round(yrs)}y old` : `${yrs.toFixed(1).replace(/\.0$/, '')}y old`;
  return {
    dateText,
    ageText: yrStr,
    kind: 'backfill',
    fullTitle: `Historical backfill from ${dateText} (${yrStr})`,
  };
}

function formatVinOrLot(ev: LandingRecentEvent): { text: string; isVin: boolean; isMissing: boolean; title: string } {
  if (ev.vin) {
    return {
      text: ev.vin,
      isVin: true,
      isMissing: false,
      title: `Structured VIN / Chassis: ${ev.vin}`,
    };
  }
  if (ev.lot) {
    const raw = ev.lot.trim();
    const isUrlSlug = raw.includes('/') || raw.includes('.com');
    if (!isUrlSlug && raw.length <= 18) {
      return {
        text: `Lot ${raw}`,
        isVin: false,
        isMissing: false,
        title: `No VIN extracted · Source lot/listing ID: ${raw}`,
      };
    }
  }
  return {
    text: '—',
    isVin: false,
    isMissing: true,
    title: 'VIN not extracted',
  };
}

function formatStatusCell(ev: LandingRecentEvent): { primary: string; meta: string; statusClass: string; title: string | null } {
  const rawStatus = ev.eventStatus && ev.eventStatus !== 'unknown' ? ev.eventStatus : null;
  // An archived capture's 'active' is the listing's state the day the Internet Archive saved the page, not now, and the page
  // does not say how it ended.
  const seenLive = ev.archived === true && (rawStatus === 'active' || rawStatus === 'live');
  const primary = seenLive
    ? 'seen live'
    : rawStatus === 'reserve_not_met'
      ? 'RNM'
      : rawStatus
        ? rawStatus.replace(/_/g, ' ')
        : (ev.eventType ?? 'record');
  const statusClass = seenLive
    ? 'is-seen'
    : rawStatus === 'sold'
      ? 'is-sold'
      : rawStatus === 'active' || rawStatus === 'live'
        ? 'is-live'
        : rawStatus === 'reserve_not_met' || rawStatus === 'unsold'
          ? 'is-rnm'
          : '';
  const title = seenLive
    ? `Live when the Internet Archive captured this page${ev.capturedAt ? ` on ${ev.capturedAt.slice(0, 10)}` : ''}; the capture does not say how it ended`
    : null;
  const parts: string[] = [];
  if (ev.reserve === 'no_reserve') parts.push('NR');
  else if (ev.reserve === 'reserve') parts.push('R');
  if (ev.bidCount != null && ev.bidCount > 0) parts.push(`${ev.bidCount}b`);
  else if (rawStatus && ev.eventType && ev.eventType !== rawStatus) parts.push(ev.eventType);
  return { primary, meta: parts.join(' · '), statusClass, title };
}

export function resolveDrillTopMakes(
  detail: SourceLandingDetail | null,
  recent: ReadonlyArray<LandingRecentEvent>,
): SourceTopMakeEntry[] {
  const explicit = detail?.topMakes ?? detail?.stats?.topMakes ?? [];
  if (explicit.length > 0) return explicit.slice(0, 10);
  const counts = new Map<string, { make: string; count: number }>();
  for (const ev of recent) {
    const mk = ev.make?.trim();
    if (!mk) continue;
    const key = mk.toLowerCase();
    const cur = counts.get(key);
    if (cur) cur.count += 1;
    else counts.set(key, { make: mk, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.make.localeCompare(b.make))
    .slice(0, 10);
}

export function resolveDrillTopModels(
  detail: SourceLandingDetail | null,
  recent: ReadonlyArray<LandingRecentEvent>,
): SourceTopModelEntry[] {
  const explicit = detail?.topModels ?? detail?.stats?.topModels ?? [];
  if (explicit.length > 0) {
    return explicit.slice(0, 10).map((entry) => {
      if (entry.make) return entry;
      const matched = recent.find(
        (ev) =>
          ev.make &&
          ev.model &&
          (ev.model.toLowerCase() === entry.model.toLowerCase() ||
            ev.model.toLowerCase().startsWith(`${entry.model.toLowerCase()} `)),
      );
      return {
        ...entry,
        make: matched?.make ?? null,
      };
    });
  }
  const counts = new Map<string, { make: string | null; model: string; count: number }>();
  for (const ev of recent) {
    const md = ev.model?.trim();
    if (!md) continue;
    const mk = ev.make?.trim() || null;
    const key = `${(mk ?? '').toLowerCase()}::${md.toLowerCase()}`;
    const cur = counts.get(key);
    if (cur) cur.count += 1;
    else counts.set(key, { make: mk, model: md, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model))
    .slice(0, 10);
}

export function computeStreamFacetDistribution(
  recent: ReadonlyArray<LandingRecentEvent>,
): StreamFacetDistributionPill[] {
  const byAxis: Record<
    'series' | 'trim' | 'body',
    Map<string, { value: string; count: number }>
  > = {
    series: new Map(),
    trim: new Map(),
    body: new Map(),
  };

  for (const ev of recent) {
    const facet = classifyVehicleFacet({
      make: ev.make,
      model: ev.model,
      series: ev.series,
      trim: ev.trim,
      bodyStyle: ev.bodyStyle,
      title: ev.title,
      rawTitle: ev.rawTitle,
      year: ev.year,
    });
    const axes: Array<['series' | 'trim' | 'body', string | null]> = [
      ['series', facet.series],
      ['trim', facet.trim],
      ['body', facet.body],
    ];
    for (const [axis, rawVal] of axes) {
      const val = rawVal?.trim();
      if (!val) continue;
      const key = val.toLowerCase();
      const cur = byAxis[axis].get(key);
      if (cur) cur.count += 1;
      else byAxis[axis].set(key, { value: val, count: 1 });
    }
  }

  const toSortedPills = (
    axis: 'series' | 'trim' | 'body',
    prefix: 'SER' | 'TRM' | 'BDY',
  ): StreamFacetDistributionPill[] =>
    [...byAxis[axis].values()]
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 5)
      .map((entry) => ({
        axis,
        prefix,
        value: entry.value,
        count: entry.count,
      }));

  return [
    ...toSortedPills('series', 'SER'),
    ...toSortedPills('trim', 'TRM'),
    ...toSortedPills('body', 'BDY'),
  ];
}

function isSoldDrillEvent(ev: Pick<LandingRecentEvent, 'eventStatus' | 'eventType'>): boolean {
  const status = (ev.eventStatus ?? '').trim().toLowerCase();
  if (status === 'sold') return true;
  if (status === 'active' || status === 'live' || status === 'reserve_not_met' || status === 'unsold' || status === 'withdrawn') {
    return false;
  }
  const et = (ev.eventType ?? '').trim().toLowerCase();
  return et === 'sold' || et === 'sale';
}

export function sortDrillStreamEvents(
  events: ReadonlyArray<LandingRecentEvent>,
  sortMode: DrillStreamSortMode,
): LandingRecentEvent[] {
  const copy = [...events];
  if (sortMode === 'price') {
    return copy.sort((a, b) => {
      const pa = a.price != null && a.price > 0 ? a.price : -1;
      const pb = b.price != null && b.price > 0 ? b.price : -1;
      if (pb !== pa) return pb - pa;
      const ya = a.year ?? -1;
      const yb = b.year ?? -1;
      if (yb !== ya) return yb - ya;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }
  if (sortMode === 'year') {
    return copy.sort((a, b) => {
      const ya = a.year ?? -1;
      const yb = b.year ?? -1;
      if (yb !== ya) return yb - ya;
      const pa = a.price != null && a.price > 0 ? a.price : -1;
      const pb = b.price != null && b.price > 0 ? b.price : -1;
      if (pb !== pa) return pb - pa;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }
  // 'latest' — preserve arrival / createdAt DESC order
  return copy.sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && tb !== ta) return tb - ta;
    return 0;
  });
}

export function computeDrillCohortSummary(
  filtered: ReadonlyArray<LandingRecentEvent>,
  totalStreamCount = filtered.length,
): DrillCohortSummary {
  const filteredCount = filtered.length;
  let soldCount = 0;
  const soldPrices: number[] = [];
  for (const ev of filtered) {
    if (isSoldDrillEvent(ev)) {
      soldCount += 1;
      if (ev.price != null && Number.isFinite(ev.price) && ev.price > 0) {
        soldPrices.push(ev.price);
      }
    }
  }
  const sellThroughPct =
    filteredCount > 0 ? Math.round((soldCount / filteredCount) * 100) : null;
  let medianSoldPrice: number | null = null;
  if (soldPrices.length > 0) {
    const sorted = [...soldPrices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianSoldPrice =
      sorted.length % 2 === 1
        ? Math.round(sorted[mid])
        : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return {
    totalStreamCount,
    filteredCount,
    soldCount,
    sellThroughPct,
    medianSoldPrice,
  };
}

// What a source's activity is made of, one line per kind (market_source_pulse_read, 20261022000000). "backfill" is a bid or
// comment captured more than 2 hours after it was posted: old activity arriving late, not the site's pulse.
export type PulseKind = 'bid' | 'comment' | 'listing' | 'backfill';
export const PULSE_KINDS: { kind: PulseKind; label: string; hint: string }[] = [
  { kind: 'bid', label: 'Bids', hint: 'Bids posted on the site and captured within 2 hours' },
  { kind: 'comment', label: 'Comments', hint: 'Comments and seller replies posted on the site and captured within 2 hours' },
  { kind: 'listing', label: 'New listings', hint: 'Listings and auction rows newly captured' },
  { kind: 'backfill', label: 'Backfill', hint: 'Older bids and comments captured more than 2 hours after they were posted' },
];
export type SourcePulse = {
  hours24: Record<PulseKind, number[]>;
  mins60: Record<PulseKind, number[]>;
  last: Record<PulseKind, string | null>;
};

export function parsePulse(value: unknown): SourcePulse | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, any>;
  const series = (x: any, len: number): Record<PulseKind, number[]> => {
    const out = {} as Record<PulseKind, number[]>;
    for (const { kind } of PULSE_KINDS) {
      const a = Array.isArray(x?.[kind]) ? x[kind].map((n: unknown) => num(n) ?? 0) : [];
      out[kind] = a.length === len ? a : Array(len).fill(0);
    }
    return out;
  };
  const last = {} as Record<PulseKind, string | null>;
  for (const { kind } of PULSE_KINDS) last[kind] = str(v.last?.[kind]);
  return { hours24: series(v.hours24, 24), mins60: series(v.mins60, 12), last };
}

/** Milliseconds a record ends or ended at, from its own timestamp; null when it carries only a date or nothing. */
export function recordEndsAt(recordDate: string | null): number | null {
  if (!recordDate || recordDate.length <= 10) return null;
  const t = Date.parse(recordDate.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isNaN(t) ? null : t;
}

/** "6d 04:12:09", "3:12:09", "12:09" counting down; "ended 3d" after. */
export function formatCountdown(endsAt: number, now: number): { text: string; live: boolean; soon: boolean } {
  const ms = endsAt - now;
  if (ms > 0) {
    const sec = Math.floor(ms / 1000);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const ss = sec % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    const text = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(ss)}` : h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
    return { text, live: true, soon: sec < 3600 };
  }
  const ago = Math.floor(-ms / 1000);
  const text = ago < 3600 ? `ended ${Math.max(1, Math.floor(ago / 60))}m` : ago < 86400 ? `ended ${Math.floor(ago / 3600)}h` : `ended ${Math.floor(ago / 86400)}d`;
  return { text, live: false, soon: false };
}

export function formatTickAgo(iso: string | null, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return 'none in 24h';
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export type DrillColumnKey = 'ends' | 'year' | 'make' | 'model' | 'vin' | 'lot' | 'miles' | 'bids' | 'price';

/** Sort value per column; null sorts last in either direction. Live lots by time left, then ended lots by recency. */
export function drillColumnValue(ev: LandingRecentEvent, key: DrillColumnKey, now: number): number | string | null {
  switch (key) {
    case 'ends': {
      const t = recordEndsAt(ev.recordDate);
      return t == null ? null : t > now ? t - now : 1e15 + (now - t);
    }
    case 'year': return ev.year;
    case 'make': return ev.make?.toLowerCase() ?? null;
    case 'model': return ev.model?.toLowerCase() ?? null;
    case 'vin': return ev.vin?.toLowerCase() ?? null;
    case 'lot': return ev.lot ? (/^\d+$/.test(ev.lot.trim()) ? Number(ev.lot) : ev.lot.toLowerCase()) : null;
    case 'miles': return ev.mileage;
    case 'bids': return ev.bidCount;
    case 'price': return ev.price != null && ev.price > 0 ? ev.price : null;
  }
}

export function sortDrillColumn(
  events: LandingRecentEvent[],
  sort: { key: DrillColumnKey; dir: 'asc' | 'desc' } | null,
  now: number,
): LandingRecentEvent[] {
  if (!sort) return events;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return events
    .map((ev, i) => ({ ev, i, v: drillColumnValue(ev, sort.key, now) }))
    .sort((a, b) => {
      if (a.v == null && b.v == null) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'en', { numeric: true });
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.ev);
}

const DRILL_COLUMNS: { key: DrillColumnKey; label: string; numeric?: boolean }[] = [
  { key: 'ends', label: 'Ends' },
  { key: 'year', label: 'Year', numeric: true },
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'vin', label: 'VIN' },
  { key: 'lot', label: 'Lot' },
  { key: 'miles', label: 'Miles', numeric: true },
  { key: 'bids', label: 'Bids', numeric: true },
  { key: 'price', label: 'Price', numeric: true },
];

/** One thin bar line per activity kind, with its total and last-seen clock, on one shared time axis. */
function PulseLines({ title, series, labels, now, last }: {
  title: string;
  series: Record<PulseKind, number[]> | null;
  labels: (idx: number, len: number) => string;
  now: number;
  last?: Record<PulseKind, string | null> | null;
}) {
  return (
    <div className="market-sources__pulse">
      <div className="market-sources__chart-head"><span>{title}</span></div>
      {PULSE_KINDS.map(({ kind, label, hint }) => {
        const vals = series?.[kind] ?? [];
        const max = Math.max(1, ...vals);
        const total = vals.reduce((a, b) => a + b, 0);
        return (
          <div key={kind} className={`market-sources__pulse-row is-${kind}`} title={hint}>
            <span className="market-sources__pulse-label">{label}</span>
            <strong className="market-sources__pulse-total">{count(total)}</strong>
            <svg className="market-sources__pulse-line" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={`${label}: ${count(total)}`}>
              <line className="market-sources__pulse-base" x1="0" x2="100" y1="27" y2="27" vectorEffect="non-scaling-stroke" />
              {vals.length > 1 ? (
                <polyline className="market-sources__pulse-path" vectorEffect="non-scaling-stroke"
                  points={vals.map((n, i) => `${((i / (vals.length - 1)) * 100).toFixed(2)},${(26 - (n / max) * 24).toFixed(2)}`).join(' ')} />
              ) : null}
              {vals.length > 1 ? (
                <polyline className="market-sources__pulse-path is-now" vectorEffect="non-scaling-stroke"
                  points={vals.slice(-2).map((n, i) => `${(((vals.length - 2 + i) / (vals.length - 1)) * 100).toFixed(2)},${(26 - (n / max) * 24).toFixed(2)}`).join(' ')} />
              ) : null}
              {vals.map((n, idx) => (
                <rect key={idx} x={(idx / vals.length) * 100} y="0" width={100 / vals.length} height="28" fill="transparent">
                  <title>{`${labels(idx, vals.length)}: ${count(n)}`}</title>
                </rect>
              ))}
            </svg>
            <small className="market-sources__pulse-last">{last ? formatTickAgo(last[kind], now) : ''}</small>
          </div>
        );
      })}
    </div>
  );
}

function SourceLandingInspector({
  row,
  boardLanding,
  boardDay,
  sourceNames,
  onClose,
  asBlock = false,
}: {
  row: SourceRow | null;
  boardLanding: BoardLandingMeta;
  boardDay: string | null;
  sourceNames: ReadonlyMap<string, string>;
  onClose: () => void;
  asBlock?: boolean;
}) {
  const [columnSort, setColumnSort] = useState<{ key: DrillColumnKey; dir: 'asc' | 'desc' } | null>({ key: 'ends', dir: 'asc' });
  const [pulse, setPulse] = useState<SourcePulse | null>(null);
  const [tickNow, setTickNow] = useState(() => Date.now());
  const [detail, setDetail] = useState<SourceLandingDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const sourceKey = row?.source ?? null;
  const displayName = row ? shortName(row.name) : 'All sources';

  useEffect(() => {
    setColumnSort({ key: 'ends', dir: 'asc' });
  }, [sourceKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params: { p_source?: string } = {};
    if (sourceKey) params.p_source = sourceKey;

    Promise.resolve()
      .then(() => supabase.rpc('market_source_landing_read', params))
      .then(({ data: raw, error }) => {
        if (!active) return;
        if (!error) {
          const parsed = parseSourceLanding(raw);
          if (parsed) setDetail(parsed);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [sourceKey, refreshTick]);

  // The heartbeat: bids, comments, listings and backfill, each its own line (market_source_pulse_read).
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => supabase.rpc('market_source_pulse_read', { p_source: sourceKey }))
      .then(({ data: raw, error }) => {
        if (active && !error) setPulse(parsePulse(raw));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [sourceKey, refreshTick]);

  // Countdowns and "ago" tick every second.
  useEffect(() => {
    if ((globalThis as any).IS_REACT_ACT_ENVIRONMENT) return;
    const id = window.setInterval(() => setTickNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-refresh live ingestion telemetry every 10s when inspecting live stream
  useEffect(() => {
    if ((globalThis as any).IS_REACT_ACT_ENVIRONMENT) return;
    const id = window.setInterval(() => setRefreshTick((t) => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const endHourIso = detail?.hour ?? boardLanding.hour ?? null;
  const landed1h = detail?.landed1h ?? (row ? row.landed1h : boardLanding.landed1h);
  const landed24 = detail?.landed24 ?? (row ? row.landed24 : boardLanding.landed24);
  const lastLanded = detail?.lastLanded ?? (row ? row.lastLanded : null);
  const recent = detail?.recent ?? [];
  const Tag = asBlock ? 'div' : 'li';

  const totalRecent = recent.length;
  const rowCategory = row ? resolveSourceCategory(row) : null;
  const rowBadge = row ? sourceBadge(row) : null;
  const speciesEvidence = row?.speciesEvidence ?? null;
  const dealerBreakdown = row && rowCategory === 'dealer' ? describeDealerConsignment(row, recent) : null;
  const dealerProfileHref = row ? resolveDealerProfileHref(row) : null;
  const sortedRecent = sortDrillColumn(recent, columnSort, tickNow);

  // The site's heartbeat: the latest bid, comment or listing, ticking each second.
  const beat = pulse
    ? (['bid', 'comment', 'listing'] as const)
        .map((k) => ({ k, t: pulse.last[k] ? Date.parse(pulse.last[k] as string) : NaN }))
        .filter((x) => !Number.isNaN(x.t))
        .sort((x, y) => y.t - x.t)[0] ?? null
    : null;
  const beatLabel = beat
    ? `last ${beat.k} ${formatTickAgo(new Date(beat.t).toISOString(), tickNow)}`
    : lastLanded
      ? `last record ${formatTickAgo(lastLanded, tickNow)}`
      : 'idle';

  // The sold figures are the reader's count of every listing captured in the last 24 hours, not of the rows shown.
  const windowStats = detail?.window ?? null;
  const windowConcluded = windowStats ? windowStats.sold + windowStats.ended : 0;
  const windowSellThrough = windowStats && windowConcluded > 0 ? Math.round((windowStats.sold / windowConcluded) * 100) : null;

  const statsHeld = detail?.stats?.held ?? row?.held ?? null;
  // The held count is a daily fold with its own clock; what landed after that clock is counted live beside it.
  const heldSince = detail?.stats?.heldSince ?? null;
  const heldAtIso = detail?.stats?.heldAt ?? row?.heldAt ?? null;
  const statsHeldNow = statsHeld != null ? statsHeld + (heldSince ?? 0) : null;
  const statsPop = detail?.stats?.population ?? row?.population ?? null;
  const statsMethod = detail?.stats?.populationMethod ?? row?.populationMethod ?? null;
  const statsConf = detail?.stats?.populationConfidence ?? row?.populationConfidence ?? null;
  const statsPopAt = detail?.stats?.populationAt ?? row?.populationAt ?? null;
  const statsMapSales = detail?.stats?.mapSales ?? row?.mapSales ?? null;
  const statsMapUsd = detail?.stats?.mapUsd ?? row?.mapUsd ?? null;
  const statsSales12 = detail?.stats?.sales12 ?? row?.sales12 ?? null;
  const statsUsd12 = detail?.stats?.usd12 ?? row?.usd12 ?? null;
  const statsShare = row
    ? heldShare({
        held: statsHeld,
        currentInventory: row.currentInventory,
        population: statsPop,
        populationMethod: statsMethod,
        populationAt: statsPopAt,
      })
    : null;
  const statsMethodNote = statsMethod
    ? `${METHOD[statsMethod] ?? statsMethod}${statsConf != null ? ` (${Math.round(statsConf * 100)}% conf)` : ''}`
    : undefined;

  return (
    <Tag className="market-sources__drill" aria-label={`Live ingestion for ${displayName}`}>
      <div className="market-sources__drill-head">
        <div className="market-sources__drill-title">
          <i className={landed1h > 0 || beat ? 'on live' : landed24 > 0 ? 'on' : 'off'} aria-hidden="true" />
          {row?.logoUrl ? (
            <OrgLogo logoUrl={row.logoUrl} businessType={row.businessType ?? null} businessName={displayName} size={26} maxWidth={140}
              className={`market-sources__icon${sourceLogoInk(row.logoUrl) ? ` market-sources__icon--${sourceLogoInk(row.logoUrl)}` : ''}`} />
          ) : null}
          <strong className={row?.logoUrl ? 'sr-only' : undefined}>{displayName}</strong>
          {rowBadge ? (
            <span className={`market-sources__badge market-sources__badge--${rowBadge.key}`}>
              {rowBadge.label}
            </span>
          ) : null}
          <span className="market-sources__drill-live-tag">{loading && !pulse ? 'syncing…' : beatLabel}</span>
        </div>
        <div className="market-sources__drill-actions">
          {dealerProfileHref ? (
            <a
              href={dealerProfileHref}
              className="market-sources__drill-btn market-sources__org-link"
              title={`Open ${displayName} organization profile`}
            >
              Full profile
            </a>
          ) : null}
          {row ? (
            <a
              href={`/browse?source=${encodeURIComponent(row.source)}`}
              className="market-sources__drill-btn"
            >
              Browse vehicles
            </a>
          ) : null}
          <button
            type="button"
            className="market-sources__drill-btn"
            onClick={() => setRefreshTick((t) => t + 1)}
          >
            Refresh
          </button>
          <button
            type="button"
            className="market-sources__drill-btn"
            onClick={onClose}
            aria-label={`Close ${displayName} ingestion inspector`}
          >
            Close ×
          </button>
        </div>
      </div>

      {speciesEvidence ? (
        <div className="market-sources__species-evidence" aria-label={`Species evidence for ${displayName}`}>
          <span className="market-sources__dealer-context-label">
            {(row?.speciesLabel ?? row?.species ?? 'species').toUpperCase()} · FROM THE SOURCE ITSELF
            {speciesEvidence.examinedAt ? `, ${speciesEvidence.examinedAt}` : ''}
          </span>
          {speciesEvidence.seen ? <span className="market-sources__species-seen">{speciesEvidence.seen}</span> : null}
          {speciesEvidence.examined.length ? (
            <ul className="market-sources__species-examined">
              {speciesEvidence.examined.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : null}
          {speciesEvidence.doc ? <small className="market-sources__species-doc">{speciesEvidence.doc}</small> : null}
        </div>
      ) : null}

      {dealerBreakdown ? (
        <div className="market-sources__dealer-context" aria-label={`Consignment breakdown for ${displayName}`}>
          <div className="market-sources__dealer-context-main">
            <span className="market-sources__dealer-context-label">INVENTORY &amp; CONSIGNMENT BREAKDOWN</span>
            {dealerBreakdown.hqBadge ? (
              <span className="market-sources__dealer-hq" title={`Dealer headquarters: ${dealerBreakdown.hqBadge}`}>
                {dealerBreakdown.hqBadge}
              </span>
            ) : null}
            <strong className="market-sources__dealer-context-mode">{dealerBreakdown.modeLabel}</strong>
            <span className="market-sources__dealer-context-summary">{dealerBreakdown.summaryText}</span>
          </div>
          {dealerBreakdown.totalRecent > 0 ? (
            <div className="market-sources__dealer-context-split">
              <svg className="market-sources__dealer-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
                {dealerBreakdown.consignedPct != null && dealerBreakdown.consignedPct > 0 ? (
                  <rect className="market-sources__dealer-bar-consigned" x="0" y="0" height="6" width={dealerBreakdown.consignedPct} />
                ) : null}
                {dealerBreakdown.directPct != null && dealerBreakdown.directPct > 0 ? (
                  <rect
                    className="market-sources__dealer-bar-direct"
                    x={dealerBreakdown.consignedPct ?? 0}
                    y="0"
                    height="6"
                    width={dealerBreakdown.directPct}
                  />
                ) : null}
              </svg>
              <span className="market-sources__dealer-split-text">
                {dealerBreakdown.consignedCount} consigned ({dealerBreakdown.consignedPct}%) · {dealerBreakdown.directCount} direct ({dealerBreakdown.directPct}%)
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {row ? (
        <div className="market-sources__drill-stats" aria-label={`Source stats for ${displayName}`}>
          <div className="market-sources__kpi">
            <span className="market-sources__kpi-label">
              {(row.species && SPECIES_HELD_LABELS[row.species]) ?? (row.category === 'marketplace' ? 'Listings held' : 'Lots held')}
            </span>
            <strong>
              {statsHeldNow != null ? count(statsHeldNow) : '—'}
              {heldSince && statsHeld != null ? (
                <small className="market-sources__sharenote">
                  {count(statsHeld)} measured {heldWhen(heldAtIso)} + {count(heldSince)} landed since
                </small>
              ) : null}
            </strong>
          </div>
          <div className="market-sources__kpi">
            <span className="market-sources__kpi-label">{row.currentInventory ? 'Source inventory' : 'Census & coverage'}</span>
            <strong title={row.currentInventory ? 'Published search count; held includes historical captures' : statsMethodNote}>
              {statsShare?.text || '—'}
              {row.currentInventory ? <small className="market-sources__sharenote">
                {shortDay(row.currentInventory.observedAt)} · from their search results
              </small> : null}
              {statsShare?.reference ? <small className="market-sources__sharenote">{statsShare.reference}</small> : null}
            </strong>
          </div>
          <div className="market-sources__kpi">
            <span className="market-sources__kpi-label">Confirmed map sales</span>
            <strong>
              {statsMapSales != null && statsMapSales > 0
                ? `${count(statsMapSales)}${statsMapUsd ? ` · ${money(statsMapUsd)}` : ''}`
                : '—'}
            </strong>
          </div>
          <div className="market-sources__kpi">
            <span className="market-sources__kpi-label">Sales (last 12m)</span>
            <strong>
              {statsSales12 != null && statsSales12 > 0
                ? `${count(statsSales12)}${statsUsd12 ? ` · ${money(statsUsd12)}` : ''}`
                : '—'}
            </strong>
          </div>
          <div className="market-sources__kpi">
            <span className="market-sources__kpi-label">Live now</span>
            <strong className={row.live > 0 ? 'up' : ''}>{row.live > 0 ? `${count(row.live)} live` : '0 live'}</strong>
          </div>
        </div>
      ) : null}

      <div className="market-sources__drill-pulses">
        <PulseLines
          title={`Last 24 hours (${zoneName(new Date())})`}
          series={pulse?.hours24 ?? null}
          labels={(idx, len) => formatHourLabel(hourSlotIso(endHourIso, idx, len)) || `${len - 1 - idx}h ago`}
          now={tickNow}
          last={pulse?.last ?? null}
        />
        <PulseLines
          title="Last 60 minutes"
          series={pulse?.mins60 ?? null}
          labels={(idx, len) => (idx === len - 1 ? 'now' : `-${(len - 1 - idx) * 5}m`)}
          now={tickNow}
        />
      </div>

      {windowStats && windowConcluded > 0 ? (
        <div className="market-sources__sellthrough" data-testid="drill-sellthrough" title="Of the listings captured in the last 24 hours that have concluded">
          <span className="market-sources__kpi-label">Sell-through</span>
          <strong>{windowSellThrough}%</strong>
          <span className="market-sources__sellthrough-bar" aria-hidden="true">
            <i style={{ width: `${windowSellThrough}%` }} />
          </span>
          <small>{count(windowStats.sold)} sold of {count(windowConcluded)} concluded</small>
        </div>
      ) : null}

      {totalRecent > 0 ? (
        <div className="market-sources__events-wrap">
          <div className="market-sources__events-cols" role="row">
            {DRILL_COLUMNS.map(({ key, label, numeric }) => {
              const active = columnSort?.key === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="columnheader"
                  className={`market-sources__col-head${numeric ? ' n' : ''}${active ? ' is-active' : ''}`}
                  aria-sort={active ? (columnSort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  data-testid={`drill-col-${key}`}
                  onClick={() =>
                    setColumnSort((cur) =>
                      cur?.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'ends' || key === 'make' || key === 'model' || key === 'vin' || key === 'lot' ? 'asc' : 'desc' },
                    )
                  }
                >
                  {label}{active ? (columnSort?.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
              );
            })}
          </div>
          <ul className="market-sources__events">
            {sortedRecent.map((ev) => {
              const st = formatStatusCell(ev);
              const endsAt = recordEndsAt(ev.recordDate);
              const cd = endsAt != null && !ev.archived ? formatCountdown(endsAt, tickNow) : null;
              const modelPrimary = ev.model || ev.rawTitle || ev.title || ev.lot || ev.id;
              const href = ev.vehicleId ? `/vehicle/${ev.vehicleId}` : null;
              return (
                <li key={ev.id} className="market-sources__event">
                  <span className={`market-sources__event-ends${cd?.live ? ' is-live' : ''}${cd?.soon ? ' is-soon' : ''}`}
                    title={endsAt != null ? formatExactTime(new Date(endsAt).toISOString()) : 'No end time recorded'}>
                    {cd ? cd.text : '—'}
                  </span>
                  <span className={`market-sources__event-year n${ev.year == null ? ' is-missing' : ''}`}>{ev.year ?? '—'}</span>
                  <span className="market-sources__event-make">
                    {ev.make ? <MakeIdentity make={ev.make} compact /> : <span className="is-missing">—</span>}
                  </span>
                  <span className={`market-sources__event-model${!ev.model ? ' is-unparsed' : ''}`} title={ev.rawTitle ?? modelPrimary}>
                    {href ? <a href={href}>{modelPrimary}</a> : modelPrimary}
                  </span>
                  <span className="market-sources__event-vin" title={ev.vin ? 'VIN / chassis' : 'No VIN extracted'}>{ev.vin ?? '—'}</span>
                  <span className="market-sources__event-lot" title="Source lot number">{ev.lot && !ev.lot.includes('/') ? ev.lot : '—'}</span>
                  <span className={`market-sources__event-miles n${ev.mileage == null ? ' is-missing' : ''}`}
                    title={ev.mileage != null ? `${count(ev.mileage)} miles` : 'Mileage not extracted'}>
                    {ev.mileage != null && ev.mileage > 0 ? `${compactCount(ev.mileage)} mi` : '—'}
                  </span>
                  <span className={`market-sources__event-status n ${st.statusClass}`} title={st.title ?? undefined}>
                    {cd?.live ? (ev.bidCount ? `${ev.bidCount} ${ev.bidCount === 1 ? 'bid' : 'bids'}` : 'no bids') : st.primary}
                  </span>
                  <span className="market-sources__event-price n">{ev.price && ev.price > 0 ? `$${count(ev.price)}` : '—'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <small className="market-sources__drill-empty">{loading ? 'loading…' : 'no recent listings'}</small>
      )}
    </Tag>
  );
}

export { SourceLandingInspector as IngestionDrillPanel };

function resolveInitialSource(rows: SourceRow[], explicit?: string | null): string | null {
  let candidate = explicit ?? null;
  if (!candidate && typeof window !== 'undefined') {
    const pathMatch = window.location.pathname.match(/^\/sources\/([^/?#]+)/);
    candidate = pathMatch?.[1]
      ? decodeURIComponent(pathMatch[1])
      : new URLSearchParams(window.location.search).get('source');
  }
  if (!candidate) return null;
  const nk = normKey(candidate);
  const found = rows.find((r) => r.source === candidate || normKey(r.source) === nk || normKey(r.name) === nk);
  return found ? found.source : null;
}

export type HouseMix = { rows: HouseRow[]; clock: string };

export function SourcesBoardView({
  data,
  scope,
  scoped = null,
  initialSource,
  houseMix = null,
}: {
  data: SourcesBoardData;
  scope?: string | null;
  /** The drilled family's or model's sales by source: the board ranks and counts that scope instead of every make. */
  scoped?: BoardScope | null;
  initialSource?: string | null;
  /** Each house's share of the map's confirmed sales (the refresh receipt), opened from the board's header. It used
   *  to sit above the map, where it said Bring a Trailer's share a second time (owner, 2026-10-17: state each fact
   *  once; he liked the bar, so it moved here instead of going). Shown on the all-makes board only. */
  houseMix?: HouseMix | null;
}) {
  const [all, setAll] = useState(() => !!resolveInitialSource(data.rows, initialSource));
  const [horizon, setHorizon] = useState<LandingHorizon>('14d');
  const [openSource, setOpenSource] = useState<string | null>(() => resolveInitialSource(data.rows, initialSource));
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  // Groups the reader opened past their top rows (a long group, such as the dealers, shows its top and a show-all).
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeInspector = () => {
    dialogRef.current?.close?.();
    setOpenSource(null);
  };
  useEffect(() => {
    if (openSource) dialogRef.current?.showModal?.();
  }, [openSource]);

  const heldAt = data.rows.map((r) => r.heldAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const scopeTotal = (r: SourceRow) => scoped?.bySource.get(r.source)?.total ?? 0;
  // The reader's species groups when it sends them (the doc's names, in its order); older payloads group by category.
  const bySpecies = !!data.speciesGroups?.length;
  const groupDefs = bySpecies
    ? data.speciesGroups!.map((g) => ({ key: g.species, title: g.label, unit: g.unit,
        badge: SPECIES_BADGE_LABELS[g.species] ?? g.label.toUpperCase() }))
    : GROUPS.map(([key, title, unit]) => ({ key: key as string, title, unit, badge: CATEGORY_BADGE_LABELS[key] }));
  const groupOf = (r: SourceRow): string | null => (bySpecies ? r.species ?? null : resolveSourceCategory(r));
  const allGroups = groupDefs.map((g) => {
    const rows = data.rows.filter((r) => groupOf(r) === g.key && (!scoped || all || scopeTotal(r) > 0));
    return { ...g, rows: scoped ? [...rows].sort((a, b) => scopeTotal(b) - scopeTotal(a)) : rows };
  }).filter((g) => g.rows.length);
  const groups = categoryFilter === 'all' ? allGroups : allGroups.filter((g) => g.key === categoryFilter);
  const shownPer = scoped || all || categoryFilter !== 'all' ? Infinity : SHOWN;
  const shownIn = (key: string) => (openGroups.has(key) ? Infinity : shownPer);
  const hidden = scoped ? data.rows.filter((r) => groupOf(r) && scopeTotal(r) === 0).length
    : categoryFilter === 'all' ? allGroups.reduce((n, g) => n + Math.max(0, g.rows.length - shownIn(g.key)), 0) : 0;
  const notRanked = Object.entries(data.notRanked).sort((x, y) => y[1] - x[1])
    .map(([k, n]) => `${n} ${NOT_RANKED_WORDS[k] ?? k}${n > 1 ? 's' : ''}`);
  const scopedLabel = scoped ? `Sources · ${scoped.label}` : scope?.trim() ? 'Sources · all makes' : 'Sources';
  const sourceNames = new Map<string, string>();
  for (const r of data.rows) {
    const clean = shortName(r.name);
    sourceNames.set(r.source, clean);
    sourceNames.set(normKey(r.source), clean);
  }
  sourceNames.set('classiccars', 'ClassicCars.com');
  sourceNames.set('bringatrailer', 'Bring a Trailer');

  const binsForHorizon = (r: SourceRow): number[] => {
    if (horizon === '24h') return r.hours24;
    if (horizon === '1h') return r.mins60;
    return r.days14;
  };

  return (
    <section className="market-sources" aria-label="Sources, ranked by what we hold">
      <svg width="0" height="0" aria-hidden="true" className="market-sources__defs">
        <defs>
          <pattern id="market-sources-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" className="market-sources__hatch" />
          </pattern>
        </defs>
      </svg>
      <div className="market-sources__head">
        <span className="market-sources__title">{scopedLabel}</span>
        <span className="market-sources__note">
          {scoped
            ? `ranked by ${count(scoped.total)} ${scoped.label} sales with a date, last 5 years${scoped.unattributed ? ` (${count(scoped.unattributed)} at houses not listed)` : ''} · held, landing and live count each source’s whole catalogue`
            : 'ranked by what we hold · a source moves up as more of it lands'}{heldAt ? ` · held counts as of ${heldWhen(heldAt)}` : ''}
        </span>
        {!scoped && houseMix && <VenueMix rows={houseMix.rows} clock={houseMix.clock} />}
        <div className="market-sources__cat-filters" role="group" aria-label="Filter sources by category">
          <button
            type="button"
            className={`market-sources__cat-pill${categoryFilter === 'all' ? ' is-active' : ''}`}
            aria-pressed={categoryFilter === 'all'}
            onClick={() => setCategoryFilter('all')}
          >
            ALL
          </button>
          {allGroups.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`market-sources__cat-pill market-sources__cat-pill--${g.key}${categoryFilter === g.key ? ' is-active' : ''}`}
              aria-pressed={categoryFilter === g.key}
              onClick={() => setCategoryFilter((cur) => (cur === g.key ? 'all' : g.key))}
            >
              {g.badge}
            </button>
          ))}
        </div>
        {data.landing.landed1h > 0 ? (
          <button
            type="button"
            className={`market-sources__live-summary${openSource === '__ALL__' ? ' is-open' : ''}`}
            onClick={() => setOpenSource((cur) => (cur === '__ALL__' ? null : '__ALL__'))}
            aria-expanded={openSource === '__ALL__'}
            title={`+${count(data.landing.landed24)} records landed across all sources in the last 24h · click for live ingestion inspector`}
          >
            <i className="on live" aria-hidden="true" />
            +{count(data.landing.landed15m)} in 15m · +{count(data.landing.landed1h)} in 1h
          </button>
        ) : null}
      </div>
      {groups.map((g) => (
        <div key={g.key} className="market-sources__group">
          <div className="market-sources__cols">
            <span>#</span><span className="market-sources__group-title">{g.title}</span><span className="n">{g.unit}</span>
            <span>source inventory</span>
            <span className="market-sources__col-landing">
              <button
                type="button"
                className="market-sources__col-toggle"
                onClick={() => setHorizon((h) => NEXT_HORIZON[h])}
                title="Click to switch landing view between 14 days, 24 hours (hourly), and 60 minutes (live)"
              >
                {HORIZON_LABELS[horizon]}
              </button>
              <span className="market-sources__horizon-pills" role="group" aria-label="Landing resolution">
                {(['14d', '24h', '1h'] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`market-sources__pill${horizon === h ? ' is-active' : ''}`}
                    onClick={() => setHorizon(h)}
                    aria-pressed={horizon === h}
                  >
                    {h}
                  </button>
                ))}
              </span>
            </span>
            <span>{scoped ? `${scoped.short} sales, last 12 months` : 'sales, last 12 months'}</span><span className="n">live now</span>
          </div>
          <ol className="market-sources__rows">
            {g.rows.slice(0, shownIn(g.key)).map((r, i) => {
              const s = heldShare(r);
              const week = r.held != null && r.heldBefore != null ? r.held - r.heldBefore : null;
              const land = landingState(r, horizon);
              const isOpen = openSource === r.source;
              const cat = resolveSourceCategory(r);
              const graded = gradeText(r.populationGrade);
              const total = r.currentInventory
                ? `${count(r.currentInventory.count)} current listings reported by their search, ${shortDay(r.currentInventory.observedAt)}; held includes historical captures`
                : r.population == null
                ? 'their total is not counted yet'
                : s.reference
                  ? `≈ ${count(r.population)} · ${s.reference}`
                    + `${r.populationConfidence != null ? ` · confidence ${r.populationConfidence.toFixed(2)}` : ''}`
                    + ' · an estimate, not a count of their listings'
                  : `${count(r.population)} ${METHOD[r.populationMethod ?? ''] ?? `(${r.populationMethod ?? 'method unrecorded'})`}`
                    + `${r.populationAt ? `, ${shortDay(r.populationAt)}` : ''}`
                    + `${r.populationConfidence != null ? `, confidence ${r.populationConfidence.toFixed(2)}` : ''}`
                    + `${graded ? `; ${graded}` : ''}`;
              return (
                <Fragment key={r.source}>
                  <li
                    className={`market-sources__row${isOpen ? ' market-sources__row--open' : ''}`}
                    data-category={cat ?? undefined}
                    data-species={r.species ?? undefined}
                    onClick={() => setOpenSource((cur) => (cur === r.source ? null : r.source))}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        setOpenSource((cur) => (cur === r.source ? null : r.source));
                      }
                    }}
                  >
                    <span className="market-sources__rank">{i + 1}</span>
                    <button type="button" className="market-sources__name" title={r.name}
                      aria-haspopup="dialog" aria-expanded={isOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenSource(r.source);
                      }}>
                      {/* Identity through the shared renderer (frontend rule 2026-10-08): the organization's recorded logo,
                          else its type icon. */}
                      <OrgLogo logoUrl={r.logoUrl} businessType={r.businessType ?? (cat === 'auction' ? 'auction_house' : cat === 'dealer' ? 'dealer' : null)}
                        businessName={r.name} size={13} maxWidth={42} variant="logo"
                        className={`market-sources__icon${sourceLogoInk(r.logoUrl) ? ` market-sources__icon--${sourceLogoInk(r.logoUrl)}` : ''}`} />
                      <span className="market-sources__name-text">{shortName(r.name)}</span>
                    </button>
                    <span className="market-sources__held n" title={r.heldAt ? `held as of ${heldWhen(r.heldAt)}` : undefined}>
                      {r.held != null ? count(r.held) : '—'}
                      {week != null && week !== 0
                        ? <small className={week > 0 ? 'up' : 'down'}> {week > 0 ? '+' : '−'}{count(Math.abs(week))} since {shortDay(r.beforeDay)}</small>
                        : null}
                      {r.venueLots != null && r.venueLots > 0 && r.members == null
                        ? <small className="market-sources__venue"
                            title={`${count(r.venueLots)} lots it sold on ${VENUE_NAMES[r.venueSlug ?? ''] ?? r.venueSlug ?? 'a venue'}, counted under that venue, not here`}>
                            {' '}+{count(r.venueLots)} sold on {VENUE_NAMES[r.venueSlug ?? ''] ?? r.venueSlug ?? 'a venue'}</small>
                        : null}
                      {r.members != null && r.members > 0
                        ? <small className="market-sources__members" title={`${count(r.members)} sellers in this cohort`}> {count(r.members)} sellers</small>
                        : null}
                    </span>
                    <span className={`market-sources__share${r.currentInventory ? ' market-sources__share--current' : ''}`} title={total}>
                      {!r.currentInventory ? <svg className="market-sources__track" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                        {s.share != null
                          ? <rect className={`market-sources__fill${s.reference ? ' market-sources__fill--est' : ''}`}
                              x="0" y="0" height="8" width={Math.max(1.5, s.share * 100)} />
                          : <rect className="market-sources__unknown" x="0" y="0" height="8" width="100" fill="url(#market-sources-hatch)" />}
                      </svg> : null}
                      <span className="market-sources__sharetext">
                        {s.text}
                        {r.currentInventory ? <small className="market-sources__sharenote">{shortDay(r.currentInventory.observedAt)} · search results</small> : null}
                        {s.reference ? <small className="market-sources__sharenote">{s.reference}</small> : null}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={`market-sources__landing${isOpen ? ' is-open' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenSource((cur) => (cur === r.source ? null : r.source));
                      }}
                      aria-expanded={isOpen}
                      title={`${count(r.landed7)} records landed in 7d · +${count(r.landed1h)} in 1h · click for live hourly breakdown`}
                    >
                      <i className={land.active ? (r.landed15m > 0 ? 'on live' : 'on') : 'off'} aria-hidden="true" />
                      <span className={`market-sources__landtext${land.active ? '' : ' idle'}`}>{land.text}</span>
                      <DayBars days={binsForHorizon(r)} mode={horizon} />
                    </button>
                    {scoped ? (() => {
                      const sc = scoped.bySource.get(r.source);
                      return (
                        <span className="market-sources__recent"
                          title={sc ? `${scoped.label}: ${count(sc.total)} sales in the last 5 years${sc.usd ? `, ${money(sc.usd)}` : ''}` : undefined}>
                          {sc?.total ? <><span className="n">{sc.sales12 ? count(sc.sales12) : '—'}</span><Spark bars={monthBars(sc.months, data.day)} /></> : <span className="n">—</span>}
                        </span>
                      );
                    })() : (
                      <span className="market-sources__recent"
                        title={r.mapSales ? `on the map: ${count(r.mapSales)} confirmed sales${r.mapUsd ? `, ${money(r.mapUsd)}` : ''}` : undefined}>
                        {r.sales12 ? <><span className="n">{count(r.sales12)}</span><Spark bars={monthBars(r.months, data.day)} /></> : <span className="n">—</span>}
                      </span>
                    )}
                    <span className="market-sources__live n">
                      {r.live > 0 ? <><i aria-hidden="true" />{count(r.live)} live</> : '—'}
                    </span>
                  </li>
                </Fragment>
              );
            })}
          </ol>
          {g.rows.length > SHOWN && shownPer !== Infinity
            ? <button type="button" className="market-sources__more market-sources__more--group"
                aria-expanded={openGroups.has(g.key)}
                onClick={() => setOpenGroups((cur) => { const next = new Set(cur); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; })}>
                {openGroups.has(g.key) ? `Show the top ${SHOWN}` : `Show all ${g.rows.length} · ${g.unit}`}
              </button>
            : null}
        </div>
      ))}
      {openSource ? (
        <dialog ref={dialogRef} className="market-sources__dialog" aria-label={openSource === '__ALL__'
          ? 'All sources' : shortName(data.rows.find((r) => r.source === openSource)?.name ?? openSource)}
          onCancel={(e) => { e.preventDefault(); closeInspector(); }} onClose={() => setOpenSource(null)}
          onClick={(e) => { if (e.target === e.currentTarget) closeInspector(); }}>
          <SourceLandingInspector key={openSource}
            row={data.rows.find((r) => r.source === openSource) ?? null}
            boardLanding={data.landing} boardDay={data.day} sourceNames={sourceNames}
            onClose={closeInspector} asBlock />
        </dialog>
      ) : null}
      <div className="market-sources__foot">
        {hidden > 0
          ? <button type="button" className="market-sources__more" onClick={() => setAll((x) => !x)}>
            {all ? (scoped ? `Show only sources with ${scoped.label} sales` : 'Show the top of each group') : `Show all ${data.rows.length} sources`}
          </button>
          : null}
        {notRanked.length ? <span className="market-sources__note">not ranked: {notRanked.join(', ')}</span> : null}
      </div>
    </section>
  );
}

/** The board as the market page mounts it: one read, refreshed every 30s in live browser sessions. */
export default function SourcesBoard({
  scope,
  initialSource,
  houseMix = null,
}: {
  /** A make alone, or the map's drill scope. A family (or a model inside it) scopes the board through its sales
   *  (treemap_family_sales); a make alone has no per-house reader yet and keeps the all-makes board, labeled so. */
  scope?: string | SourcesScope | null;
  initialSource?: string | null;
  houseMix?: HouseMix | null;
} = {}) {
  const [data, setData] = useState<SourcesBoardData | null>(null);
  const s: SourcesScope | null = typeof scope === 'string' ? { make: scope } : scope ?? null;
  const make = s?.make?.trim() || null;
  const family = s?.family?.trim() || null;
  const familyName = s?.familyName?.trim() || null;
  const model = s?.model?.trim() || null;
  const [familySales, setFamilySales] = useState<{ key: string; sales: Sale[] } | null>(null);
  useEffect(() => {
    if (!make || !family || typeof (supabase as { rpc?: unknown })?.rpc !== 'function') return;
    let live = true;
    readFamilySales(make, family).then((v) => { if (live) setFamilySales(v ? { key: `${make}|${family}`, sales: v.sales } : null); });
    return () => { live = false; };
  }, [make, family]);
  const scoped = useMemo(() => {
    if (!data || !make || !family || familySales?.key !== `${make}|${family}`) return null;
    const sales = model
      ? familySales.sales.filter((x) => matchesSaleSubModel(x.model, model, { brand: make, family: familyName, year: x.year }))
      : familySales.sales;
    const short = model ?? familyName ?? make;
    const label = [make, familyName, model].filter(Boolean).join(' ');
    const out = scopeSourceSales(data.rows, sales, data.day, label, short);
    return out.total > 0 ? out : null;
  }, [data, make, family, familyName, model, familySales]);
  useEffect(() => {
    let live = true;
    const load = () => {
      // A failed or missing read leaves the board off the page; it never takes the market page down with it.
      Promise.resolve().then(() => supabase.rpc('market_sources_read')).then(({ data: value, error }) => {
        if (live && !error) setData(parseSources(value));
      }).catch(() => {});
    };
    load();
    if ((globalThis as any).IS_REACT_ACT_ENVIRONMENT) {
      return () => { live = false; };
    }
    const timer = window.setInterval(load, 30_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);
  if (!data || !data.rows.length) return null;
  return <SourcesBoardView data={data} scope={make} scoped={scoped} initialSource={initialSource} houseMix={houseMix} />;
}
