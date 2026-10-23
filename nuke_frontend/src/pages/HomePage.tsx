import React, { useState, useEffect, useMemo, useCallback, useRef, useId, lazy, Suspense } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';
import { useVehiclesDashboard } from '../hooks/useVehiclesDashboard';
import { OnboardingSlideshow } from '../components/onboarding/OnboardingSlideshow';
import { useInterests } from '../hooks/useInterests';
import { optimizeImageUrl } from '../lib/imageOptimizer';
import { squarify } from '../lib/squarify';
import { MapCallouts, MapLegend, MarketCard, MarketSheet, MarketTile, money as fmtMoneyMap, type MapBasis } from './market/MarketTile';
import { batBaseline, callouts, gateMinForHorizon, measuredHouses, relativeMove } from './market/mapScale';
import { combineShareMovers, MOVER_HORIZONS, readShareMovers, type BaselineHorizon, type MoverHorizon, type ShareMovers } from './market/FamilyMovers';
import IntakePage from './intake/IntakePage';
import TruckFacetToolbar from './market/TruckFacetToolbar';
import { filterTruckMembers, parseTruckMembers, partitionTruckMembers, readTruckNavigation, TRUCK_AXES, TRUCK_AXIS_LABELS, type TruckAxis, type TruckRead } from './market/truckFacets';
import { Text } from '../kit';
import { MakeIdentity } from '../components/common/MakeIdentity';
import FamilyMovers from './market/FamilyMovers';
import BrandFamilyMap, { MapViewSwitch } from './market/BrandFamilyMap';
import FamilySalesChart, { FamilyViewSwitch, matchesSaleSubModel, useFamilySales, type Sale } from './market/FamilySalesChart';
import { getDefinedFamilyEras, getFamilyEraCohorts, matchesEraRange } from '../lib/market/familyEras';
import { buildMarketScopeUrl, resolveMarketScopeQuery } from '../lib/search/marketScopeResolver';
import {
  buildFacetNodes,
  classifyVehicleFacets,
  consolidateBrandPickupFamilies,
  isGmTruckBrand,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
  resolveVettedIdentityMarks,
  type FamilyFacetAxis,
} from './familyFacetsAndEmblems';

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

export interface TreemapNode {
  name: string;
  count: number;
  value: number;
  median_price?: number;
  min_price?: number;
  max_price?: number;
  sold_count?: number;
  auction_count?: number;
  avg_bids?: number;
  avg_watchers?: number;
  // A brand's market (mv_brand_market via treemap_brand_market, 2026-10-15): dollars, sell-through, the p10-p90 band,
  // the model year that trades, and the last 12 months against the 12 before.
  usd?: number | null;
  sold_any?: number | null;
  offered?: number | null;
  p10?: number | null;
  p90?: number | null;
  year_p50?: number | null;
  dated?: number | null;
  sold_12m?: number | null;
  sold_prior_12m?: number | null;
  usd_12m?: number | null;
  usd_prior_12m?: number | null;
  // A brand's factory model family (treemap_brand_families, 20261015131500): its key ('other' for the names not yet
  // keyed to a family) and how many model names in it sold. A model name the seller left out cannot be drilled.
  familyKey?: string;
  models?: number | null;
  noModel?: boolean;
  imageUrl?: string;
  id?: string;
  isVehicle?: boolean;
  listingTitle?: string;
  mileage?: number;
  facetRepresentativeModel?: string;
  badgeSvg?: string;
  facetAxis?: Exclude<FamilyFacetAxis, 'raw'>;
  familySharePct?: number;
}

export interface TreemapRect {
  node: TreemapNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DrillLevel {
  label: string;
  make?: string;
  family?: string;
  /** how many model names in the family sold (the family level's models), so the next level can say what it shows */
  names?: number;
  model?: string;
  year?: number;
}

const SCOPE_PARAM_KEYS = ['make', 'family', 'family_name', 'model', 'year'] as const;

export function parseFacetAxisParam(raw: string | null | undefined): FamilyFacetAxis | null {
  if (!raw) return null;
  const norm = raw.trim().toLowerCase();
  if (norm === 'series') return 'series';
  if (norm === 'trim') return 'trim';
  if (norm === 'body' || norm === 'body_style' || norm === 'bodystyle') return 'body';
  if (norm === 'raw') return 'raw';
  return null;
}

export function normalizeFacetSelection(
  axis: FamilyFacetAxis | null | undefined,
  rawFacet: string | null | undefined,
  make?: string | null,
  familyLabel?: string | null,
): string | null {
  if (!rawFacet) return null;
  const trimmed = rawFacet.trim();
  if (!trimmed) return null;
  if (!axis || axis === 'raw') return trimmed;
  const classified = classifyVehicleFacets(make, familyLabel, trimmed);
  const canonical = axis === 'series' ? classified.series : axis === 'trim' ? classified.trim : classified.body;
  if (canonical) {
    const isGenericFallback =
      (canonical === 'Mustang Standard' && !/\bstandard\b/i.test(trimmed)) ||
      (canonical === 'Corvette Base' && !/\bbase\b/i.test(trimmed)) ||
      (canonical === 'Standard Cab Pickup' && !/\bstandard\s+cab\b/i.test(trimmed));
    if (!isGenericFallback) return canonical;
  }
  return trimmed;
}

/** Build the treemap's drill stack from the page URL, resolving canonical brand and family names when loaded. */
export function drillStackFromSearchParams(
  params: URLSearchParams,
  brands?: readonly TreemapNode[] | null,
  families?: readonly TreemapNode[] | null,
): DrillLevel[] {
  const stack: DrillLevel[] = [{ label: 'ALL MAKES' }];
  const rawMake = params.get('make')?.trim();
  if (!rawMake || rawMake.toLowerCase() === 'all') return stack;
  const make = brands?.find((b) => b.name.toLowerCase() === rawMake.toLowerCase())?.name ?? rawMake;
  stack.push({ label: make, make });

  const rawFamily = params.get('family')?.trim();
  const rawFamilyName = params.get('family_name')?.trim();
  let familyLabel = '';
  let resolvedFamilyKey = rawFamily ?? '';
  if (rawFamily) {
    const matched = families?.find(
      (f) =>
        f.familyKey === rawFamily ||
        (f.familyKey != null && f.familyKey.toLowerCase() === rawFamily.toLowerCase()) ||
        f.name.toLowerCase() === rawFamily.toLowerCase() ||
        (rawFamilyName != null && f.name.toLowerCase() === rawFamilyName.toLowerCase()) ||
        (isPickupFamilyLabel(rawFamily) && /^(pickup|truck)$/i.test(f.name)),
    );
    resolvedFamilyKey = matched?.familyKey ?? rawFamily;
    familyLabel = matched?.name ?? rawFamilyName ?? (isPickupFamilyLabel(rawFamily) ? 'Pickup' : rawFamily);
    stack.push({ label: familyLabel, make, family: resolvedFamilyKey, names: matched?.models ?? undefined });
  }

  const rawAxis = parseFacetAxisParam(params.get('axis'));
  const rawFacet = params.get('facet')?.trim();
  const rawModelParam = params.get('model')?.trim();
  const effectiveFacet = rawFacet
    ? normalizeFacetSelection(rawAxis, rawFacet, make, familyLabel || rawFamily) ?? rawFacet
    : null;
  const rawModel = effectiveFacet ?? rawModelParam;
  const normKey = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, '');
  const isCollapsedDuplicateOfFamily =
    !effectiveFacet &&
    !!rawFamily &&
    !!rawModel &&
    !!familyLabel &&
    rawModel.toLowerCase() !== familyLabel.toLowerCase() &&
    normKey(rawModel) === normKey(familyLabel);
  if (rawModel && !isCollapsedDuplicateOfFamily) {
    stack.push({ label: rawModel, make, family: resolvedFamilyKey || undefined, model: rawModel });
  }
  const rawYear = params.get('year')?.trim();
  if (rawYear && (rawModel || rawFamily)) {
    const year = parseInt(rawYear, 10);
    if (Number.isFinite(year)) {
      stack.push({ label: String(year), make, family: resolvedFamilyKey || undefined, model: rawModel || undefined, year });
    }
  }
  return stack;
}

/** Write the treemap's drill stack into the page URL while preserving unrelated parameters. */
export function applyDrillStackToSearchParams(
  params: URLSearchParams,
  stack: readonly DrillLevel[],
  activeFacetAxis?: FamilyFacetAxis | null,
): URLSearchParams {
  const prevFamily = params.get('family');
  const prevAxis = parseFacetAxisParam(params.get('axis'));
  const effectiveAxis: FamilyFacetAxis | null =
    activeFacetAxis !== undefined ? activeFacetAxis : prevAxis;
  const next = new URLSearchParams(params);
  for (const k of SCOPE_PARAM_KEYS) next.delete(k);
  const leaf = stack[stack.length - 1];
  if (params.get('make') !== leaf?.make || prevFamily !== leaf?.family) {
    for (const key of [...next.keys()]) if (key.startsWith('truck_')) next.delete(key);
  }
  if (!leaf?.make) {
    next.delete('era');
    next.delete('axis');
    next.delete('facet');
    return next;
  }
  next.set('make', leaf.make);
  if (leaf.family) {
    next.set('family', leaf.family);
    const familyLevel = stack.find((l) => l.family === leaf.family && !l.model);
    if (familyLevel?.label && familyLevel.label !== leaf.family) {
      next.set('family_name', familyLevel.label);
    }
    const switchingFamily = Boolean(prevFamily && prevFamily !== leaf.family);
    if (switchingFamily) {
      next.delete('era');
      next.delete('axis');
      next.delete('facet');
    } else if (effectiveAxis && effectiveAxis !== 'raw') {
      next.set('axis', effectiveAxis);
    } else {
      if (effectiveAxis === 'raw' && prevFamily === leaf.family && isGmTruckBrand(leaf.make) && familyLevel?.label === 'Truck') next.set('axis', 'raw');
      else next.delete('axis');
      next.delete('facet');
    }
  } else {
    next.delete('era');
    next.delete('axis');
    next.delete('facet');
  }
  if (leaf.model) {
    const switchingFamily = Boolean(prevFamily && leaf.family && prevFamily !== leaf.family);
    if (!switchingFamily && effectiveAxis && effectiveAxis !== 'raw' && leaf.family) {
      const modelLevel = stack.find((l) => l.model && !l.year);
      next.set('axis', effectiveAxis);
      next.set('facet', modelLevel?.label ?? leaf.model);
    } else {
      next.delete('facet');
      next.set('model', leaf.model);
    }
  } else {
    next.delete('facet');
  }
  if (leaf.year != null && Number.isFinite(leaf.year)) next.set('year', String(leaf.year));
  return next;
}

// The map's levels: brands, a brand's model families, a family's model names, a name's years, the sales.
export type MapLevel = 'brands' | 'families' | 'models' | 'years' | 'vehicles';

// ────────────────────────────────────────────────────────────
// DATA HOOKS
// ────────────────────────────────────────────────────────────

// The brand read is 94 KB and the map mounts twice on a market-tab load (the home branch first, then the embedded
// one once the tab resolves), so one load fetched it twice (measured 2026-10-13, every logged-out capture). One
// promise per page lifetime; a failed read is forgotten so the next mount retries.
let brandsRead: Promise<TreemapNode[] | null> | null = null;
export function readTreemapBrands(): Promise<TreemapNode[] | null> {
  if (!brandsRead) {
    const market = Promise.resolve(supabase.rpc('treemap_brand_market'))
      .then(({ data, error }) => (error || !data ? [] : data as Partial<TreemapNode>[]), () => []);
    brandsRead = Promise.all([Promise.resolve(supabase.rpc('treemap_by_brand')), market]).then(([{ data: result, error }, rows]) => {
      if (error || !result) { brandsRead = null; return null; }
      const byName = new Map(rows.map((m) => [m.name, m]));
      // One map must use one area/color basis. Missing supplemental rows cannot mix dollars with record counts.
      const complete = (result as TreemapNode[]).every(n => {
        const usd = byName.get(n.name)?.usd;
        return typeof usd === 'number' && Number.isFinite(usd) && usd > 0;
      });
      if (!complete) { brandsRead = null; return result as TreemapNode[]; }
      return (result as TreemapNode[]).map((n) => {
        const m = byName.get(n.name);
        return m ? { ...n, usd: m.usd, sold_any: m.sold_any, offered: m.offered, p10: m.p10, p90: m.p90,
          year_p50: m.year_p50, dated: m.dated, sold_12m: m.sold_12m, sold_prior_12m: m.sold_prior_12m,
          usd_12m: m.usd_12m, usd_prior_12m: m.usd_prior_12m } : n;
      });
    }, () => { brandsRead = null; return null; });
  }
  return brandsRead;
}

// The clock of the ledger's views: the latest treemap_refreshes row, written by treemap_refresh_all() since 2026-10-14
// (job 175, daily 09:10 UTC), with the map's population receipt (treemap_populations()) since 20261014063000.
// Absent or unreadable, the legend says what it always said, without a time or a population.
export interface MapPopulations { measure?: string; public_records?: number; mapped_sales?: number;
  by_house?: { house: string | null; sales: number; amount: number; qualified_measured?: boolean }[];
  /** The houses held in full in both 12-month windows (market_measured_houses(), 20261018120000). */
  measured_houses?: string[] | null }
export interface MapRefresh { refreshedAt: string | null; populations: MapPopulations | null }
const NO_REFRESH: MapRefresh = { refreshedAt: null, populations: null };
let refreshRead: Promise<MapRefresh> | null = null;
export function readTreemapRefresh(): Promise<MapRefresh> {
  if (typeof (supabase as { from?: unknown })?.from !== 'function') return Promise.resolve(NO_REFRESH);
  if (!refreshRead) {
    refreshRead = Promise.resolve(
      supabase.from('treemap_refreshes').select('*').order('refreshed_at', { ascending: false }).limit(1),
    ).then(({ data, error }: { data: { refreshed_at: string; populations?: MapPopulations | null }[] | null; error: unknown }) => {
      if (error || !data || data.length === 0) { refreshRead = null; return NO_REFRESH; }
      return { refreshedAt: String(data[0].refreshed_at), populations: data[0].populations ?? null };
    }, () => { refreshRead = null; return NO_REFRESH; });
  }
  return refreshRead;
}

/** The legend's clock clause: how long ago the ledger's views were refreshed, the way a feed says it (owner,
 *  2026-10-15: no full date-and-time stamps). The exact time stays on the caption's title. */
export function ledgerViewsClock(refreshedAt: string | null, now = Date.now()): string {
  const t = refreshedAt ? Date.parse(refreshedAt) : NaN;
  if (!Number.isFinite(t)) return ' · as of the last refresh of the ledger\u2019s views';
  const m = Math.max(0, Math.floor((now - t) / 60_000));
  return ` · updated ${m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`}`;
}
export function ledgerViewsStamp(refreshedAt: string | null): string | undefined {
  const t = refreshedAt ? Date.parse(refreshedAt) : NaN;
  return Number.isFinite(t) ? `Views refreshed ${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC` : undefined;
}

/** The count beside the map, with its population and date. At the top level both numbers come from the refresh
 *  receipt (treemap_refreshes.populations), so they share one snapshot: the mapped sales of all public records. Below
 *  it the count is the level's own; the leaf shows at most 200 sales, the largest. */
export function mapCaption(level: MapLevel, levelCount: number, refresh: MapRefresh, now = Date.now(), clause = ''): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const p = refresh.populations;
  const receipt = level === 'brands' && p?.measure === 'confirmed_sale_v1'
    && Number.isFinite(p.mapped_sales) && Number.isFinite(p.public_records);
  const count = level === 'vehicles'
    ? `${levelCount >= 200 ? 'largest 200' : fmt(levelCount)} confirmed sales`
    : `${fmt(receipt ? p!.mapped_sales! : levelCount)} vehicles with a confirmed sale`;
  return `${count}${receipt ? ` of ${fmt(p!.public_records!)} public records` : ''}, all time${clause}${ledgerViewsClock(refresh.refreshedAt, now)}`;
}

/** The caption on a phone, where the full sentence does not fit: the count alone, the population still on the title. */
export function mapCaptionShort(level: MapLevel, levelCount: number, refresh: MapRefresh): string {
  const p = refresh.populations;
  const n = level === 'brands' && p?.measure === 'confirmed_sale_v1' && Number.isFinite(p.mapped_sales) ? p.mapped_sales! : levelCount;
  return `${n.toLocaleString('en-US')} ${level === 'vehicles' ? 'shown' : 'sold, all time'}`;
}

/** The bridge from the all-time count to the window the map's color and callouts read: the drilled brand's or
 *  family's measured sales in the window and the one before (owner, 2026-10-17: a "+38%" callout opened on an
 *  all-time count with nothing connecting the two). Empty without both windows. */
export function windowBridge(node: Pick<TreemapNode, 'sold_12m' | 'sold_prior_12m'> | null | undefined, recent = 'the last 12 months', prior = 'the 12 before'): string {
  if (!node || node.sold_12m == null || node.sold_prior_12m == null || node.sold_12m + node.sold_prior_12m === 0) return '';
  return ` · ${node.sold_12m.toLocaleString('en-US')} sold in ${recent} at the measured houses, ${node.sold_prior_12m.toLocaleString('en-US')} in ${prior}`;
}

/** How much of a brand's sales the family level names: the share of its sales in named families and how many there
 *  are; the rest sit in "Other models". Empty when the level holds no families. */
export function familyCoverage(nodes: readonly TreemapNode[] | null): string {
  if (!nodes?.some((n) => n.familyKey)) return '';
  const total = nodes.reduce((sum, n) => sum + (n.count || 0), 0);
  const named = nodes.filter((n) => n.familyKey && n.familyKey !== 'other');
  const share = total > 0 ? named.reduce((sum, n) => sum + n.count, 0) / total : 0;
  return ` · ${Math.round(share * 100)}% in ${named.length.toLocaleString('en-US')} model famil${named.length === 1 ? 'y' : 'ies'}`;
}

/** At a family's model names: when the reader's 200 are fewer than the family's names, say so. */
export function familyNamesShown(shown: number, names?: number): string {
  return names && shown > 0 && names > shown ? ` · largest ${shown.toLocaleString('en-US')} of ${names.toLocaleString('en-US')} names` : '';
}

/** What area and color mean at each level. The readers count public records with a confirmed sale (vehicle_sale_basis)
 *  and its sold amount (vehicle_price_facts); the median is withheld under 5 sales. */
export function mapLegend(level: MapLevel, measured = level === 'brands' || level === 'families' || level === 'models'): string {
  if (level === 'vehicles') return 'box size = confirmed sale price · click a box to open the car';
  if (measured) return `box size = dollars from confirmed sales · of offered sold = share of cars offered at auction that sold · 12 mo = sales and dollars in the last 12 months against the 12 before, measured at auction houses held in full both years (today Bring a Trailer, Mecum and Bonhams); color follows those sales (gray: the measured houses hold under half the sales, or too few a year earlier) · prices not adjusted for inflation${level === 'families' ? ' · other models = names not yet keyed to a family, and families with under 3 sales' : ''} · click a box to go deeper`;
  return 'box size = vehicles with a confirmed sale · color = their median sale price (gray: under 5 sales) · prices not adjusted for inflation, all years · asks, bids and unknown outcomes are not counted · click a box to go deeper';
}

/** The legend under the map: the sales chart's when a family shows its chart (the tiles' legend described tiles that
 *  were not on screen, 2026-10-15), the level's otherwise. */
export const SALES_CHART_LEGEND = 'one dot = one confirmed sale with a date, the last five years · color = auction house · '
  + 'blue (where a family has enough sales) = the price of one standard car, the same mix of variant, miles, gearbox, model year '
  + 'and venue in every period, with its 95% band, and the headline is that car\'s change over 12 months; gray = the plain median '
  + 'of every sale, which mixes different cars · otherwise one panel per decade the cars were built, all on one price scale that '
  + 'leaves out the cheapest and dearest 1% (those sit on the edge, counted), line = the typical (median) price of sales within '
  + '60 days either side, band = their middle half · prices not adjusted for inflation · click a dot to open the car';
export function legendFor(level: MapLevel, chartShown: boolean, measured?: boolean): string {
  return chartShown ? SALES_CHART_LEGEND : measured === undefined ? mapLegend(level) : mapLegend(level, measured);
}

function useTreemapRefresh(): MapRefresh {
  const [refresh, setRefresh] = useState<MapRefresh>(NO_REFRESH);
  useEffect(() => {
    if (typeof (supabase as any)?.from !== 'function') return;
    let live = true;
    readTreemapRefresh().then((v) => { if (live) setRefresh(v); });
    return () => { live = false; };
  }, []);
  return refresh;
}

function useTreemapBrands() {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    if (typeof (supabase as any)?.rpc !== 'function' || typeof (supabase as any)?.from !== 'function') return;
    readTreemapBrands().then((result) => {
      if (!cancelled && result) setData(result);
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);
  return { data, loading };
}

function useTreemapModels(make: string | null) {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!make) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    Promise.resolve().then(() => supabase.rpc('treemap_models_by_brand', { p_make: make })).then(({ data: result, error }) => {
      if (!cancelled && result && !error) {
        setData(result as TreemapNode[]);
      }
      if (!cancelled) setLoading(false);
    }, () => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [make]);
  return { data, loading };
}

// One row of the family readers as a tile: the brand map's measures (dollars, sold, sell-through, 12 months against the
// 12 before), so a family and a model name read like a brand.
function marketNode(name: string, r: any): TreemapNode {
  return { name, count: Number(r.sold) || 0, value: Number(r.usd) || 0, usd: r.usd ?? null, sold_any: r.sold_any ?? null,
    offered: r.offered ?? null, dated: r.dated ?? null, sold_12m: r.sold_12m ?? null, sold_prior_12m: r.sold_prior_12m ?? null,
    usd_12m: r.usd_12m ?? null, usd_prior_12m: r.usd_prior_12m ?? null };
}

// A brand's factory model families (treemap_brand_families over mv_family_market, 2026-10-15): the owner asked for the
// brand map's "huge development run", and a brand's raw model names split by trim say little on their own. "Other
// models" holds the names not yet keyed to a family. failed: no families could be read, so the brand opens on its model
// names, as before families existed.
function useTreemapFamilies(make: string | null) {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!make) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    Promise.resolve().then(() => supabase.rpc('treemap_brand_families', { p_brand: make })).then(({ data: result, error }) => {
      if (cancelled) return;
      const rows = (error ? null : result) as any[] | null;
      if (rows?.length) setData(rows.map((r) => ({ ...marketNode(r.family ?? 'Other models', r), familyKey: r.family_key, models: r.models ?? null })));
      else { setData(null); setFailed(true); }
      setLoading(false);
    }, () => { if (!cancelled) { setData(null); setFailed(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [make]);
  return { data, loading, failed };
}

// A family's model names (treemap_family_models), the ones with a confirmed sale, largest dollars first; each name
// matches the years and sales readers.
function useTreemapFamilyModels(make: string | null, familyKey: string | null) {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!make || !familyKey) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    Promise.resolve().then(() => supabase.rpc('treemap_family_models', { p_brand: make, p_family_key: familyKey })).then(({ data: result, error }) => {
      if (cancelled) return;
      if (!error && result) setData((result as any[]).map((r) => ({ ...marketNode(r.model ?? 'Model not given', r), noModel: r.model == null })));
      setLoading(false);
    }, () => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [make, familyKey]);
  return { data, loading };
}

function useTreemapYears(make: string | null, model: string | null) {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!make || !model) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    Promise.resolve().then(() => supabase.rpc('treemap_years', { p_source: null, p_make: make, p_model: model })).then(({ data: result, error }) => {
      if (!cancelled && result && !error) {
        setData(result as TreemapNode[]);
      }
      if (!cancelled) setLoading(false);
    }, () => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [make, model]);
  return { data, loading };
}

// The leaf: the cell's confirmed sales (treemap_sales), each with the sold amount its parent cell counted.
function dedupVehicleNodes(nodes: TreemapNode[]): TreemapNode[] {
  const byKey = new Map<string, TreemapNode>();
  for (const n of nodes) {
    const imgKey = n.imageUrl ? n.imageUrl.trim().toLowerCase() : '';
    const miKey = n.mileage && n.mileage > 0 ? `mi:${n.mileage}` : '';
    const sig = imgKey || miKey || n.id || n.name;
    const key = `${n.value}|${sig}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, n);
      continue;
    }
    const prevScore = (prev.listingTitle ? 4 : 0) + (prev.imageUrl ? 2 : 0) + (prev.mileage ? 1 : 0);
    const nextScore = (n.listingTitle ? 4 : 0) + (n.imageUrl ? 2 : 0) + (n.mileage ? 1 : 0);
    if (nextScore > prevScore) byKey.set(key, n);
  }
  return Array.from(byKey.values());
}

function readTreemapSales(make: string, model: string, year?: number | null): Promise<TreemapNode[] | null> {
  return Promise.resolve().then(() => supabase.rpc('treemap_sales', { p_make: make, p_model: model, p_year: year ?? null })).then(
    ({ data: result, error }: { data: any[] | null; error: unknown }) => (error || !result ? null : dedupVehicleNodes(result.map((v: any) => ({
      name: [v.year, v.make, v.model].filter(Boolean).join(' '),
      count: 1,
      value: v.sold_amount || 0,
      median_price: v.sold_amount,
      imageUrl: v.primary_image_url || undefined,
      id: v.id,
      isVehicle: true,
      listingTitle: v.listing_title || undefined,
      mileage: v.mileage || undefined,
    })))),
    () => null,
  );
}

function useTreemapVehicles(make: string | null, model: string | null, year?: number | null) {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!make || !model) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    readTreemapSales(make, model, year).then((result) => {
      if (cancelled) return;
      if (result) setData(result);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [make, model, year]);
  return { data, loading };
}

export interface RepresentativeImageRow {
  id?: string | null;
  model?: string | null;
  year?: number | string | null;
  primary_image_url?: string | null;
}

export function selectFamilyRepresentativeVehicleIds(
  items: readonly TreemapNode[] | null | undefined,
  familySales: readonly Pick<Sale, 'vehicle_id' | 'usd' | 'year' | 'model'>[] | null | undefined,
  model?: string | null,
  perTileLimit = 4,
  maxTotal = 200,
): string[] {
  if (!items || items.length === 0 || !familySales || familySales.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const pushId = (id: string | null | undefined) => {
    if (!id || seen.has(id) || out.length >= maxTotal) return false;
    seen.add(id);
    out.push(id);
    return true;
  };

  const vehicleTiles = items.filter((item) => item.isVehicle && item.id);
  if (vehicleTiles.length > 0) {
    for (const tile of vehicleTiles) {
      pushId(tile.id);
      if (out.length >= maxTotal) break;
    }
    return out;
  }

  const pricedSales = familySales
    .filter((s) => s.vehicle_id && s.usd > 0)
    .sort((a, b) => b.usd - a.usd);
  if (pricedSales.length === 0) return [];

  const targetModel = model?.trim().toLowerCase() || null;
  const isYearsLevel = items.every((item) => {
    const yr = parseInt(item.name, 10);
    return Number.isFinite(yr) && String(yr) === item.name.trim() && yr >= 1886 && yr <= 2100;
  });

  if (isYearsLevel) {
    const exactSales = targetModel
      ? pricedSales.filter((s) => (s.model ?? '').trim().toLowerCase() === targetModel)
      : [];
    const prefixSales = targetModel
      ? pricedSales.filter(
          (s) =>
            (s.model ?? '').trim().toLowerCase() !== targetModel &&
            matchesSaleSubModel(s.model, model),
        )
      : pricedSales;
    const orderedPools = targetModel ? [exactSales, prefixSales] : [pricedSales];

    const sortedTiles = [...items].sort((a, b) => (b.value || b.count || 0) - (a.value || a.count || 0));
    for (const tile of sortedTiles) {
      const yr = parseInt(tile.name, 10);
      if (!Number.isFinite(yr)) continue;
      let countForTile = 0;
      for (const pool of orderedPools) {
        for (const s of pool) {
          if (s.year !== yr) continue;
          if (pushId(s.vehicle_id)) {
            countForTile += 1;
            if (countForTile >= perTileLimit || out.length >= maxTotal) break;
          }
        }
        if (countForTile >= perTileLimit || out.length >= maxTotal) break;
      }
      if (out.length >= maxTotal) break;
    }
    return out;
  }

  const sortedTiles = [...items].sort((a, b) => (b.usd || b.value || b.count || 0) - (a.usd || a.value || a.count || 0));
  for (const tile of sortedTiles) {
    const tileModel = tile.name.trim().toLowerCase();
    if (!tileModel) continue;
    let countForTile = 0;
    for (const exactPass of [true, false]) {
      for (const s of pricedSales) {
        const saleModel = (s.model ?? '').trim().toLowerCase();
        const matches = exactPass
          ? saleModel === tileModel
          : saleModel !== tileModel && matchesSaleSubModel(s.model, tile.name);
        if (!matches) continue;
        if (pushId(s.vehicle_id)) {
          countForTile += 1;
          if (countForTile >= perTileLimit || out.length >= maxTotal) break;
        }
      }
      if (countForTile >= perTileLimit || out.length >= maxTotal) break;
    }
    if (out.length >= maxTotal) break;
  }

  return out;
}

export function buildRepresentativeImageCandidates(
  rows: readonly RepresentativeImageRow[],
  model?: string | null,
  orderedIds?: readonly string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const addCandidate = (key: string, url: string) => {
    if (!key || !url) return;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, [url]);
    } else if (!existing.includes(url)) {
      existing.push(url);
    }
  };

  const targetModel = model?.trim().toLowerCase() || null;
  const orderMap = orderedIds && orderedIds.length > 0
    ? new Map(orderedIds.map((id, idx) => [id, idx]))
    : null;

  const sortedRows = [...rows].sort((a, b) => {
    if (targetModel) {
      const aExact = String(a.model || '').trim().toLowerCase() === targetModel ? 0 : 1;
      const bExact = String(b.model || '').trim().toLowerCase() === targetModel ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
    }
    if (orderMap) {
      const aIdx = a.id ? (orderMap.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      const bIdx = b.id ? (orderMap.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      if (aIdx !== bIdx) return aIdx - bIdx;
    }
    return 0;
  });

  for (const row of sortedRows) {
    const rawUrl = typeof row.primary_image_url === 'string' ? row.primary_image_url.trim() : '';
    if (!rawUrl) continue;
    const idKey = row.id ? String(row.id) : '';
    const modelKey = String(row.model || '').trim().toLowerCase();
    const familyKey = modelKey.split(/\s+/)[0] || '';
    const yearKey = row.year != null && String(row.year) !== '' ? String(row.year) : '';

    if (idKey) addCandidate(idKey, rawUrl);
    if (modelKey) addCandidate(modelKey, rawUrl);
    if (familyKey) addCandidate(familyKey, rawUrl);

    const matchesTargetModel = !targetModel || modelKey === targetModel || matchesSaleSubModel(row.model, model);
    if (yearKey && matchesTargetModel) {
      addCandidate(yearKey, rawUrl);
    }
  }

  return map;
}

function useRepresentativeImages(
  items: TreemapNode[] | null,
  make?: string | null,
  model?: string | null,
  familySales?: readonly Pick<Sale, 'vehicle_id' | 'usd' | 'year' | 'model'>[] | null,
  strictScope = false,
) {
  const [images, setImages] = useState<Map<string, string[]>>(new Map());
  const imagesScope = useRef('');
  const emptyImages = useMemo(() => new Map<string, string[]>(), []);
  const candidateIds = useMemo(
    () => selectFamilyRepresentativeVehicleIds(items, familySales, model),
    [items, familySales, model],
  );
  const candidateIdsKey = candidateIds.join(',');
  const itemsKey = useMemo(
    () => (items ? items.slice(0, 40).map((i) => i.id || i.name).join('|') : ''),
    [items],
  );

  const imageScopeKey = `${make}|${model}|${itemsKey}|${candidateIdsKey}`;
  useEffect(() => {
    if (!items || !make || items.length === 0 || (strictScope && candidateIds.length === 0)) { setImages(emptyImages); return; }
    let cancelled = false;
    let baseSelect = supabase.from('vehicles')?.select?.('id, model, year, primary_image_url');
    if (!baseSelect) return;
    if (strictScope) baseSelect = baseSelect.eq('is_public', true);

    if (candidateIds.length > 0 && typeof (baseSelect as any).in === 'function') {
      (baseSelect as any)
        .in('id', candidateIds)
        .not('primary_image_url', 'is', null)
        .is('deleted_at', null)
        .then(({ data: result, error }: { data: RepresentativeImageRow[] | null; error: unknown }) => {
          if (cancelled || !result || error) return;
          imagesScope.current = imageScopeKey;
          setImages(buildRepresentativeImageCandidates(result, model, candidateIds));
        });
      return () => { cancelled = true; };
    }

    // Fallback: the brand's priciest sold cars with a photo, read along the (make, sale_price) index of priced sales,
    // scoped in memory to the active sub-model so brand-wide outliers (e.g. GT40 on Mustang years) never cross-contaminate.
    if (typeof (baseSelect as any).eq === 'function') {
      (baseSelect as any)
        .eq('make', make)
        .gt('sale_price', 0)
        .not('primary_image_url', 'is', null)
        .is('deleted_at', null)
        .order('sale_price', { ascending: false })
        .limit(200)
        .then(({ data: result, error }: { data: RepresentativeImageRow[] | null; error: unknown }) => {
          if (cancelled || !result || error) return;
          setImages(buildRepresentativeImageCandidates(result, model));
        });
    }
    return () => { cancelled = true; };
  }, [itemsKey, make, model, candidateIdsKey, strictScope]);
  return strictScope && imagesScope.current !== imageScopeKey ? emptyImages : images;
}

// ────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ────────────────────────────────────────────────────────────

const fmtNum = (n: number) => n?.toLocaleString() ?? '--';
const fmtMoney = (n: number) => {
  if (!n) return '--';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString()}K`;
  return `$${n.toLocaleString()}`;
};

// ────────────────────────────────────────────────────────────
// COLOR SCALE — median price maps to heat-0..heat-6 tokens
// Tokens defined in unified-design-system.css; dark mode remaps automatically.
// ────────────────────────────────────────────────────────────

function priceToColor(medianPrice: number | undefined): string {
  if (!medianPrice || medianPrice <= 0) return 'var(--heat-0)';
  if (medianPrice < 10_000)  return 'var(--heat-1)';
  if (medianPrice < 25_000)  return 'var(--heat-2)';
  if (medianPrice < 50_000)  return 'var(--heat-3)';
  if (medianPrice < 100_000) return 'var(--heat-4)';
  if (medianPrice < 250_000) return 'var(--heat-5)';
  return 'var(--heat-6)';
}

/** Sales on Bring a Trailer in the last 12 months against the 12 before (treemap_brand_market and the family readers count
 *  BaT only since 20261015131500: the all-venue move mixed in venues whose intake is uneven between the two years), when
 *  there are enough to say so: at least 10 a year earlier, and BaT's dated sales at least half of the tile's sales.
 *  Null otherwise; the tile is then gray, not a guess. */
export function brandMomentum(n: Pick<TreemapNode, 'count' | 'dated' | 'sold_12m' | 'sold_prior_12m'>): number | null {
  if (n.sold_12m == null || !n.sold_prior_12m || n.sold_prior_12m < 10) return null;
  if (!n.dated || n.dated < 0.5 * n.count) return null;
  return n.sold_12m / n.sold_prior_12m - 1;
}

// The same twelve months in dollars, under the same rule (enough dated sales before).
export function brandDollarMomentum(n: Pick<TreemapNode, 'count' | 'dated' | 'sold_prior_12m' | 'usd_12m' | 'usd_prior_12m'>): number | null {
  if (n.usd_12m == null || !n.usd_prior_12m || !n.sold_prior_12m || n.sold_prior_12m < 10) return null;
  if (!n.dated || n.dated < 0.5 * n.count) return null;
  return n.usd_12m / n.usd_prior_12m - 1;
}
const signedPct = (m: number) => `${m >= 0 ? '▲' : '▼'}${Math.abs(Math.round(m * 100))}%`;

function momentumToColor(m: number | null): string {
  if (m === null) return 'var(--heat-0)';
  if (m >= 0.2) return 'color-mix(in srgb, var(--success) 42%, var(--surface))';
  if (m >= 0.05) return 'color-mix(in srgb, var(--success) 20%, var(--surface))';
  if (m > -0.05) return 'var(--surface)';
  if (m > -0.2) return 'color-mix(in srgb, var(--error) 20%, var(--surface))';
  return 'color-mix(in srgb, var(--error) 42%, var(--surface))';
}

/** The brand tile's lines, most important first; the cell shows as many as fit. Each is a measured fact of the brand's
 *  confirmed sales, or absent. Each line comes in forms from longest to shortest; a tile `maxChars` wide shows the
 *  longest form that fits and leaves out a line none of whose forms fits, so no line is cut mid-word (2026-10-15 small
 *  tiles read "$156.3M · 1,1…", "81% of offere…", "BaT 12 mo: s…"). */
export function brandLines(n: TreemapNode, maxChars = Infinity): string[] {
  // What a brand's market is, in three lines: its dollars and sales, how often what is offered sells, and how the last
  // twelve months compare with the twelve before, in sales and in dollars (owner, 2026-10-15: the price band is
  // irrelevant; sell-through and the 12-month move are the interest, said clearly).
  const forms: string[][] = [];
  if (n.usd) {
    const money = fmtMoneyShort(n.usd);
    forms.push([`${fmtMoney(n.usd)} · ${fmtNum(n.count)} sold`, `${money} · ${fmtCountShort(n.count)} sold`, money]);
  }
  if (n.offered && n.offered >= 20 && n.sold_any != null) {
    const share = Math.round((100 * n.sold_any) / n.offered);
    forms.push([`${share}% of offered sold`, `${share}% sold`]);
  }
  const m = brandMomentum(n);
  const d = brandDollarMomentum(n);
  if (m !== null) {
    forms.push([...(d !== null ? [`12 mo: sales ${signedPct(m)}, $ ${signedPct(d)}`] : []),
      `12 mo: sales ${signedPct(m)}`, `12 mo ${signedPct(m)}`]);
  }
  return forms.map(f => f.find(line => lineChars(line) <= maxChars)).filter((line): line is string => line !== undefined);
}

/** Characters a tile line takes in the cell's monospace face; the arrows fall back to a wider face, so they count two. */
export const lineChars = (line: string) => line.length + (line.match(/[▲▼]/g)?.length ?? 0);
const fmtMoneyShort = (n: number) => n >= 1_000_000_000 ? `$${(n / 1_000_000_000).toFixed(1)}B`
  : n >= 1_000_000 ? `$${Math.round(n / 1_000_000)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${Math.round(n)}`;
const fmtCountShort = (n: number) => n >= 10_000 ? `${Math.round(n / 1_000)}K` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${n}`;

/**
 * Lines for a facet tile (`SERIES`, `TRIM`, or `BODY STYLE`) inside a model family:
 * puts lot count, median price, and share-of-family percentage on the primary line so every facet tile
 * compares its cohort share, volume, and price at a glance without being pushed off by secondary lines.
 */
export function facetTileLines(node: TreemapNode, totalCount: number, maxChars = Infinity): string[] {
  const forms: string[][] = [];
  const pct = node.familySharePct ?? (totalCount > 0 ? (node.count / totalCount) * 100 : 0);
  const shareStr = pct >= 0.1 ? `${pct.toFixed(1)}%` : null;
  const effectivePrice = node.median_price ?? (node.usd && node.count > 0 ? Math.round(node.usd / node.count) : undefined);
  const tag = node.median_price ? 'med' : 'avg';

  if (effectivePrice && shareStr) {
    forms.push([
      `${fmtNum(node.count)} sold · ${fmtMoney(effectivePrice)} ${tag} · ${shareStr} of family`,
      `${fmtNum(node.count)} sold · ${fmtMoney(effectivePrice)} ${tag} · ${shareStr}`,
      `${fmtCountShort(node.count)} sold · ${fmtMoneyShort(effectivePrice)} ${tag} · ${shareStr}`,
      `${fmtCountShort(node.count)} · ${fmtMoneyShort(effectivePrice)} ${tag} · ${shareStr}`,
      `${fmtCountShort(node.count)} · ${fmtMoneyShort(effectivePrice)} · ${shareStr}`,
      `${fmtMoneyShort(effectivePrice)} ${tag} · ${shareStr}`,
      `${fmtCountShort(node.count)} · ${shareStr}`,
      shareStr,
    ]);
  } else if (effectivePrice) {
    forms.push([
      `${fmtNum(node.count)} sold · ${fmtMoney(effectivePrice)} ${tag}`,
      `${fmtCountShort(node.count)} · ${fmtMoneyShort(effectivePrice)} ${tag}`,
      `${fmtMoneyShort(effectivePrice)} ${tag}`,
    ]);
  } else if (shareStr) {
    forms.push([
      `${fmtNum(node.count)} sold · ${shareStr} of family`,
      `${fmtCountShort(node.count)} sold · ${shareStr}`,
      `${fmtCountShort(node.count)} · ${shareStr}`,
      shareStr,
    ]);
  } else if (node.count > 0) {
    forms.push([`${fmtNum(node.count)} sold`, `${fmtCountShort(node.count)}`]);
  }

  if (node.usd && node.usd > 0) {
    const money = fmtMoneyShort(node.usd);
    forms.push([`${fmtMoney(node.usd)} total`, `${money} total`, money]);
  }

  const m = brandMomentum(node);
  const d = brandDollarMomentum(node);
  if (m !== null) {
    forms.push([
      ...(d !== null ? [`12 mo: sales ${signedPct(m)}, $ ${signedPct(d)}`] : []),
      `12 mo: sales ${signedPct(m)}`,
      `12 mo ${signedPct(m)}`,
    ]);
  } else if ((node.sold_12m ?? 0) > 0 || (node.sold_prior_12m ?? 0) > 0) {
    const s12 = node.sold_12m ?? 0;
    const sp = node.sold_prior_12m ?? 0;
    forms.push([
      sp > 0
        ? `12 mo: ${fmtNum(s12)} sold (${fmtNum(sp)} prior)`
        : `12 mo: ${fmtNum(s12)} sold${node.usd_12m ? ` · ${fmtMoney(node.usd_12m)}` : ''}`,
      `12 mo: ${fmtNum(s12)} sold`,
    ]);
  }

  return forms
    .map((f) => f.find((line) => lineChars(line) <= maxChars))
    .filter((line): line is string => line !== undefined);
}

// ────────────────────────────────────────────────────────────
// TREEMAP CELL COMPONENT
// ────────────────────────────────────────────────────────────

interface CellProps {
  rect: TreemapRect;
  onClick: (e?: React.MouseEvent) => void;
  totalCount: number;
  showValue?: boolean;
  repImage?: string;
  repImages?: string[];
  facetAxis?: FamilyFacetAxis;
}

export function TreemapCell({ rect, onClick, totalCount, showValue, repImage, repImages, facetAxis }: CellProps) {
  const { node, x, y, w, h } = rect;
  const [hovered, setHovered] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [failedIdx, setFailedIdx] = useState(0);

  const pct = totalCount > 0 ? ((node.count / totalCount) * 100) : 0;
  const sharePct = node.familySharePct ?? pct;
  const isVehicle = !!node.isVehicle;
  const isFacetTile = !isVehicle && ((!!facetAxis && facetAxis !== 'raw') || !!node.facetAxis);
  const isBrandMarket = node.usd != null && !isVehicle;
  const effectivePrice = node.median_price ?? (node.usd && node.count > 0 ? Math.round(node.usd / node.count) : undefined);
  const mom = isBrandMarket ? brandMomentum(node) : null;
  const bg = isBrandMarket && mom !== null ? momentumToColor(mom) : priceToColor(effectivePrice);
  const candidateUrls = useMemo(() => {
    const list: string[] = [];
    if (isVehicle && node.imageUrl) list.push(node.imageUrl);
    if (repImages && repImages.length > 0) {
      for (const u of repImages) if (u && !list.includes(u)) list.push(u);
    }
    if (repImage && !list.includes(repImage)) list.push(repImage);
    return list;
  }, [isVehicle, node.imageUrl, repImage, repImages]);
  const candidateKey = candidateUrls.join('|');
  useEffect(() => {
    setFailedIdx(0);
    setImgLoaded(false);
  }, [candidateKey]);

  const imageUrl = candidateUrls[failedIdx];
  const hasImage = !!imageUrl;
  const isLarge = w > 120 && h > 80;

  // Vehicle cells: show image as full background
  // Aggregate cells: show faded rep image on large cells only
  const showImage = hasImage && (isVehicle || isLarge);

  // Decide what text fits
  const canShowName = w > 28 && h > 16;
  const canShowCount = w > 40 && h > 30 && !isVehicle;
  const canShowPrice = w > 42 && (isVehicle ? h > 28 : h > 42);
  const canShowPct = w > 50 && h > 56 && !isVehicle;
  const canShowMileage = isVehicle && w > 80 && h > 44 && node.mileage;

  // Font size scales with cell area
  const area = w * h;
  const nameFontSize = area > 40000 ? 13 : area > 15000 ? 11 : area > 5000 ? 10 : 9;
  const dataFontSize = area > 40000 ? 11 : area > 15000 ? 10 : 9;

  // The darkest price tints carry light text; everything else the theme's text (dark tiles were unreadable, 2026-10-15).
  const onDark = ['var(--heat-4)', 'var(--heat-5)', 'var(--heat-6)'].includes(bg) && !(isVehicle && showImage);
  const textColor = onDark ? '#ffffff' : 'var(--text)';
  const textSecondary = onDark ? 'rgba(255, 255, 255, 0.82)' : 'var(--text-secondary)';
  const lineHeightPx = dataFontSize * 1.3;
  const maxChars = Math.floor((w - 12) / (dataFontSize * 0.6));
  const maxLines = Math.max(1, Math.floor((h - nameFontSize * 1.4 - 10) / lineHeightPx));
  const marketLines = (() => {
    if (!canShowCount) return [];
    if (isFacetTile) {
      return facetTileLines(node, totalCount, maxChars).slice(0, maxLines);
    }
    if (!isBrandMarket) return [];
    const base = brandLines(node, maxChars);
    const pick = (...candidates: string[]) => candidates.find((s) => s.length <= maxChars);
    if (node.count > 1 && effectivePrice) {
      const tag = node.median_price ? 'med' : 'avg';
      const priceLine = pick(
        pct >= 0.1 ? `${fmtMoney(effectivePrice)} ${tag} · ${pct.toFixed(1)}% of family` : `${fmtMoney(effectivePrice)} ${tag}`,
        `${fmtMoney(effectivePrice)} ${tag}`,
      );
      if (priceLine) base.push(priceLine);
    } else if (pct >= 0.5) {
      const shareLine = pick(`${pct.toFixed(1)}% of family`, `${pct.toFixed(1)}%`);
      if (shareLine) base.push(shareLine);
    }
    if ((!node.offered || node.offered < 20) && node.offered && node.offered >= 2 && node.sold_any != null) {
      const rate = Math.round((100 * node.sold_any) / node.offered);
      const sellLine = pick(`${rate}% of ${fmtNum(node.offered)} offered sold`, `${rate}% sold`);
      if (sellLine) base.push(sellLine);
    }
    if (mom === null && ((node.sold_12m ?? 0) > 0 || (node.sold_prior_12m ?? 0) > 0)) {
      const s12 = node.sold_12m ?? 0;
      const sp = node.sold_prior_12m ?? 0;
      const recentLine = pick(
        sp > 0 ? `12 mo: ${fmtNum(s12)} sold (${fmtNum(sp)} prior)` : `12 mo: ${fmtNum(s12)} sold${node.usd_12m ? ` · ${fmtMoney(node.usd_12m)}` : ''}`,
        `12 mo: ${fmtNum(s12)} sold`,
      );
      if (recentLine) base.push(recentLine);
    }
    return base.slice(0, maxLines);
  })();

  return (
    <div
      role="button" tabIndex={0} aria-label={node.name}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        boxSizing: 'border-box',
        border: `2px solid ${hovered ? 'var(--border-focus)' : 'var(--border)'}`,
        background: hovered && !showImage ? 'var(--surface-hover)' : bg,
        cursor: 'pointer',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1), background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        userSelect: 'none',
      }}
    >
      {/* Background image for vehicle cells */}
      {showImage && imageUrl && (
        <img
          src={optimizeImageUrl(imageUrl, 'small') || imageUrl}
          alt=""
          width={Math.max(1, Math.round(w))}
          height={Math.max(1, Math.round(h))}
          loading="lazy"
          decoding="async"
          onLoad={() => setImgLoaded(true)}
          onError={() => {
            setImgLoaded(false);
            setFailedIdx((idx) => idx + 1);
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: isVehicle
              ? (imgLoaded ? (hovered ? 0.85 : 1) : 0)
              : (imgLoaded ? (hovered ? 0.25 : 0.18) : 0),
            transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Text content — solid dark band at bottom for vehicle cells (V-06: no gradients) */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        flex: isVehicle && showImage ? undefined : 1,
        marginTop: isVehicle && showImage ? 'auto' : undefined,
        background: isVehicle && showImage ? 'var(--surface-glass)' : undefined,
      }}>
        {canShowName && !isVehicle && (
          <div className="flex flex-col gap-[3px]">
            {(node.badgeSvg && w >= 110 && h >= 58) || (isFacetTile && canShowCount && sharePct >= 0.1) ? (
              <div className="treemap-cell-header-row">
                {node.badgeSvg && w >= 110 && h >= 58 && (
                  <div
                    aria-hidden="true"
                    data-testid="treemap-cell-badge"
                    className="inline-flex items-center"
                    style={{ height: area > 25000 ? 22 : 16, maxWidth: Math.min(130, w - 12) }}
                    dangerouslySetInnerHTML={{ __html: node.badgeSvg }}
                  />
                )}
                {isFacetTile && canShowCount && sharePct >= 0.1 && (
                  <span
                    data-testid="treemap-cell-facet-share"
                    className={`treemap-cell-facet-share${onDark ? ' treemap-cell-facet-share--dark' : ''}`}
                  >
                    {w >= 110 ? `${sharePct.toFixed(1)}% OF FAMILY` : `${sharePct.toFixed(1)}%`}
                  </span>
                )}
              </div>
            ) : null}
            <div
              style={{
                fontSize: nameFontSize,
                fontWeight: 700,
                letterSpacing: isLarge ? '-0.02em' : '0.04em',
                textTransform: 'uppercase' as const,
                color: textColor,
                lineHeight: 1.15,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: isLarge ? 'normal' : 'nowrap',
                fontFamily: 'Arial, sans-serif',
                wordBreak: isLarge ? 'break-word' : undefined,
              }}
            >
              {node.name}
            </div>
          </div>
        )}

        <div className="mt-auto">
          {/* Vehicle cell: title + price at bottom */}
          {isVehicle && canShowName && (
            <div
              style={{
                fontSize: nameFontSize,
                fontWeight: 700,
                letterSpacing: '-0.01em',
                color: textColor,
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: area > 15000 ? 'normal' : 'nowrap',
                fontFamily: 'Arial, sans-serif',
                textTransform: 'uppercase',
              }}
            >
              {node.listingTitle || node.name}
            </div>
          )}
          {marketLines.map((line, i) => (
            <div
              key={i}
              data-testid={isFacetTile && i === 0 ? 'treemap-cell-facet-primary-line' : undefined}
              style={{
                fontSize: dataFontSize,
                fontFamily: "'Courier New', monospace",
                fontWeight: i === 0 ? 700 : 400,
                color: i === 0 ? textColor : textSecondary,
                lineHeight: 1.3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {line}
            </div>
          ))}
          {canShowCount && !isBrandMarket && !isFacetTile && (
            <div
              style={{
                fontSize: dataFontSize,
                fontFamily: "'Courier New', monospace",
                color: textSecondary,
                lineHeight: 1.3,
              }}
            >
              {fmtNum(node.count)} sold
            </div>
          )}
          {canShowPrice && node.median_price && !isBrandMarket && !isFacetTile && (
            <div
              style={{
                fontSize: isVehicle ? nameFontSize : dataFontSize,
                fontFamily: "'Courier New', monospace",
                fontWeight: 700,
                color: textColor,
                lineHeight: 1.3,
              }}
            >
              {fmtMoney(node.median_price)}{!isVehicle && w > 60 && ' med'}
            </div>
          )}
          {canShowMileage && (
            <div
              style={{
                fontSize: 9,
                fontFamily: "'Courier New', monospace",
                color: textSecondary,
                lineHeight: 1.3,
              }}
            >
              {fmtNum(node.mileage!)} mi
            </div>
          )}
          {canShowPct && pct >= 0.1 && !isBrandMarket && !isFacetTile && (
            <div
              style={{
                fontSize: 8,
                fontFamily: "'Courier New', monospace",
                color: textSecondary,
                lineHeight: 1.3,
              }}
            >
              {pct.toFixed(1)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// TOOLTIP COMPONENT
// ────────────────────────────────────────────────────────────

interface TooltipData {
  node: TreemapNode;
  x: number;
  y: number;
  totalCount: number;
  level: string;
}

function TreemapTooltip({ node, x, y, totalCount, level }: TooltipData) {
  const isVehicle = level === 'vehicles' || !!node.isVehicle;

  // Keep tooltip on screen
  const adjustedX = typeof window !== 'undefined' && x > window.innerWidth - 240 ? x - 220 : x + 12;
  const adjustedY = typeof window !== 'undefined' && y > window.innerHeight - 200 ? y - 160 : y + 12;

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    left: adjustedX,
    top: adjustedY,
    background: 'var(--surface-elevated, #fff)',
    border: '2px solid var(--text)',
    padding: '12px 16px',
    pointerEvents: 'none',
    zIndex: 10000,
    minWidth: 180,
    maxWidth: 260,
    fontFamily: 'Arial, sans-serif',
  };

  if (isVehicle) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 4 }}>
          {node.listingTitle || node.name}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Courier New', monospace", color: 'var(--text)', marginBottom: 4 }}>
          {node.median_price ? fmtMoney(node.median_price) : fmtMoney(node.value)}
        </div>
        {node.mileage ? (
          <div style={{ fontSize: 10, fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)', marginBottom: 6 }}>
            {fmtNum(node.mileage)} mi
          </div>
        ) : null}
        <div style={{ fontSize: 8, textTransform: 'uppercase', color: 'var(--text-disabled)', letterSpacing: '0.04em' }}>
          CLICK TO VIEW PROFILE
        </div>
      </div>
    );
  }

  if (node.usd != null) {
    const m = brandMomentum(node);
    const d = brandDollarMomentum(node);
    const effectivePrice = node.median_price ?? (node.usd && node.count > 0 ? Math.round(node.usd / node.count) : undefined);
    const sharePct = node.familySharePct ?? (totalCount > 0 ? Number(((node.count / totalCount) * 100).toFixed(1)) : null);
    return (
      <div style={containerStyle}>
        <Text role="label" as="div">{node.name}</Text>
        <div><Text role="measure">{fmtMoney(node.usd)}</Text> <Text role="caption">from {fmtNum(node.count)} confirmed sales</Text></div>
        <div className="border-t border-[var(--border)] pt-1.5 flex flex-col gap-[3px]">
          {sharePct != null && sharePct > 0 ? <Row label="share of family" value={`${sharePct.toFixed(1)}%`} /> : null}
          {node.count >= 1 && effectivePrice ? <Row label={node.median_price ? 'median sale' : 'average sale'} value={fmtMoney(effectivePrice)} /> : null}
          {node.offered && node.sold_any != null ? <Row label={`of ${fmtNum(node.offered)} offered sold`} value={`${Math.round((100 * node.sold_any) / node.offered)}%`} /> : null}
          {node.sold_12m != null ? <Row label="sold (measured houses, 12 mo)" value={`${fmtNum(node.sold_12m)}${node.usd_12m ? ` · ${fmtMoney(node.usd_12m)}` : ''}`} /> : null}
          {node.sold_prior_12m != null ? <Row label="sold (12 mo before)" value={`${fmtNum(node.sold_prior_12m)}${node.usd_prior_12m ? ` · ${fmtMoney(node.usd_prior_12m)}` : ''}`} /> : null}
          {m !== null ? <Row label="change, 12-mo sales" value={signedPct(m)} /> : null}
          {d !== null ? <Row label="change, 12-mo dollars" value={signedPct(d)} /> : null}
          {m === null && node.sold_12m != null ? <Row label="12-month change" value="under 10 prior-year sales" /> : null}
          {node.avg_bids ? <Row label="average bids" value={String(node.avg_bids)} /> : null}
          {node.models ? <Row label="model names sold" value={fmtNum(node.models)} /> : null}
          {node.familyKey === 'other' ? <Text role="caption" as="div">names not yet keyed to a model family, and families with under 3 sales</Text> : null}
          {node.noModel ? <Text role="caption" as="div">the listing gave no model name</Text> : null}
        </div>
      </div>
    );
  }
  const pct = totalCount > 0 ? ((node.count / totalCount) * 100).toFixed(1) : '0.0';
  const sellThrough = node.auction_count && node.auction_count > 0
    ? Math.round(((node.sold_count || 0) / node.auction_count) * 100) + '%'
    : null;

  return (
    <div style={containerStyle}>
      <Text role="label" as="div">{node.name}</Text>
      <div className="mb-1.5">
        <Text role="measure">{fmtNum(node.count)}</Text> <Text role="caption">with a confirmed sale</Text>
      </div>
      <div className="border-t border-[var(--border)] pt-1.5 flex flex-col gap-[3px]">
        <Row label="of total" value={pct + '%'} />
        <Row label="sales total" value={fmtMoney(node.value)} />
        <Row label="median sale" value={node.median_price ? fmtMoney(node.median_price) : 'under 5 sales'} />
        {node.min_price && node.max_price ? <Row label="range" value={`${fmtMoney(node.min_price)} - ${fmtMoney(node.max_price)}`} /> : null}
        {sellThrough ? <Row label={`sold of ${fmtNum(node.auction_count!)} known outcomes`} value={sellThrough} /> : null}
        {node.avg_bids ? <Row label="avg bids" value={String(node.avg_bids)} /> : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline text-[10px] text-[var(--text-secondary)]">
      <span className="font-mono text-[var(--text)] font-semibold">{value}</span>
      <span className="ml-3 text-right text-[9px]">{label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// SEARCH BAR (reused from original)
// ────────────────────────────────────────────────────────────

interface SearchPreviewResult {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number | null;
  asking_price: number | null;
}

function useSearchPreview(query: string) {
  const [results, setResults] = useState<SearchPreviewResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setNoResults(false);
      return;
    }

    setLoading(true);
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        const words = q.split(/\s+/).filter(w => w.length > 0);
        let builder = supabase
          .from('vehicles')
          .select('id, year, make, model, sale_price, asking_price');

        for (const word of words) {
          builder = builder.or(`make.ilike.%${word}%,model.ilike.%${word}%,vin.ilike.%${word}%`);
        }

        const yearMatch = q.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
          builder = builder.eq('year', parseInt(yearMatch[0]));
        }

        const { data, error } = await builder.limit(5);
        if (error) throw error;
        setResults(data || []);
        setNoResults((data || []).length === 0);
      } catch {
        setResults([]);
        setNoResults(false);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  return { results, loading, noResults };
}

// ────────────────────────────────────────────────────────────
// MAIN TREEMAP HOMEPAGE
// ────────────────────────────────────────────────────────────

// The ledger as a map: public vehicle records with a confirmed sale by make, area = count, color = their median sale
// price, drilling to models, years and the sales themselves. `embedded` renders it under the app header as the first section of the
// market page (no header bar of its own, a fixed height) instead of as a page of its own.
export function TreemapHomePage({ onBrowse, embedded = false }: { onBrowse: () => void; embedded?: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  usePageTitle(embedded ? 'Market' : 'Nuke — Vehicle Intelligence');
  const { recordInterest } = useInterests();

  // Drill-down state, synced with the page URL so Back, reload, search and lower sections share one scope.
  const urlAxis = parseFacetAxisParam(searchParams.get('axis'));
  const [facetAxis, setFacetAxisState] = useState<FamilyFacetAxis>(() => urlAxis ?? 'raw');
  const facetAxisRef = useRef<FamilyFacetAxis>(facetAxis);
  facetAxisRef.current = facetAxis;
  const [drillStack, setDrillStackState] = useState<DrillLevel[]>(() => drillStackFromSearchParams(searchParams));
  const drillStackRef = useRef<DrillLevel[]>(drillStack);
  drillStackRef.current = drillStack;
  const setDrillStack = useCallback((
    updater: DrillLevel[] | ((prev: DrillLevel[]) => DrillLevel[]),
    axisOverride?: FamilyFacetAxis,
    viewOverride?: 'sales' | 'names',
  ) => {
    if (axisOverride !== undefined) {
      facetAxisRef.current = axisOverride;
      setFacetAxisState(axisOverride);
    }
    const prev = drillStackRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    drillStackRef.current = next;
    setDrillStackState(next);
    const axisForUrl = axisOverride !== undefined ? axisOverride : facetAxisRef.current;
    setSearchParams((curr) => {
      const params = applyDrillStackToSearchParams(curr, next, axisForUrl);
      if (viewOverride === 'sales' && params.get('family')) params.set('family_view', 'sales');
      else params.delete('family_view');
      return params;
    }, { preventScrollReset: true });
  }, [setSearchParams]);
  const currentLevel = drillStack[drillStack.length - 1];
  const selectedEra = searchParams.get('era');
  const setSelectedEra = useCallback((era: string | null) => {
    setSearchParams((curr) => {
      const next = new URLSearchParams(curr);
      if (era) next.set('era', era);
      else next.delete('era');
      return next;
    }, { preventScrollReset: true });
  }, [setSearchParams]);

  // Narrow-viewport flag — hides decorative chrome when the header would crush.
  // Threshold matches AppHeader's 768px collapse but tighter (640px) since the
  // treemap header has its own logo+search+browse triple, not the AppHeader's grid.
  // matchMedia is absent in jsdom and some embedded webviews; without it the page is treated as wide.
  const canMatchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [isNarrow, setIsNarrow] = useState(() => canMatchMedia && window.matchMedia('(max-width: 640px)').matches);
  const [phoneBrowseView, setPhoneBrowseView] = useState<'list' | 'map'>(() => searchParams.get('family_view') === 'sales' ? 'map' : 'list');
  const phoneList = isNarrow && phoneBrowseView === 'list';
  useEffect(() => {
    if (!canMatchMedia) return;
    const mql = window.matchMedia('(max-width: 640px)');
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [canMatchMedia]);

  // Prefetch cache: hover-triggered data loaded before click
  const prefetchCache = useRef<Map<string, TreemapNode[]>>(new Map());
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Data hooks
  const { data: rawBrandsData, loading: brandsLoading } = useTreemapBrands();
  const refresh = useTreemapRefresh();
  const [requestedHorizon, setHorizon] = useState<MoverHorizon>('1y');
  const [requestedBaseline, setBaselineHorizon] = useState<BaselineHorizon>('prior');
  const [moverReceipt, setMoverReceipt] = useState<{ data: ShareMovers; horizon: MoverHorizon; baseline: BaselineHorizon } | null>(null);
  const horizon = moverReceipt?.horizon ?? '1y';
  const baselineHorizon = moverReceipt?.baseline ?? 'prior';
  const moversData = moverReceipt?.data ?? null;
  const isCustomBase = baselineHorizon !== 'prior' && baselineHorizon !== horizon && !(horizon === 'upcoming' && baselineHorizon === '1m');
  // The map's color is each tile's BaT move against BaT overall: the whole venue as the movers read it (every family,
  // makes too small for a tile included), so the map and the movers name one baseline; the brands' own sum until it reads.
  useEffect(() => {
    let live = true;
    const custom = requestedBaseline !== 'prior' && requestedBaseline !== requestedHorizon
      && !(requestedHorizon === 'upcoming' && requestedBaseline === '1m');
    const read = custom
      ? Promise.all([readShareMovers(requestedHorizon), readShareMovers(requestedBaseline as Exclude<MoverHorizon, 'upcoming'>)])
        .then(([recent, base]) => recent && base
          ? combineShareMovers(recent, base, requestedHorizon, requestedBaseline as Exclude<MoverHorizon, 'upcoming'>) : null)
      : readShareMovers(requestedHorizon);
    read.then((data) => {
      if (live && data) setMoverReceipt({ data, horizon: requestedHorizon, baseline: requestedBaseline });
    });
    return () => { live = false; };
  }, [requestedHorizon, requestedBaseline]);
  const venue = moversData && moversData.bat.sold_prior_12m > 0
    ? { sold: moversData.bat.sold_12m, prior: moversData.bat.sold_prior_12m, move: moversData.bat.sold_12m / moversData.bat.sold_prior_12m - 1 }
    : null;
  const horizonMeta = useMemo(() => MOVER_HORIZONS.find((h) => h.key === horizon) ?? MOVER_HORIZONS[6], [horizon]);
  const gateMin = useMemo(
    () => (isCustomBase ? Math.min(gateMinForHorizon(horizon), gateMinForHorizon(baselineHorizon as MoverHorizon)) : gateMinForHorizon(horizon)),
    [horizon, baselineHorizon, isCustomBase],
  );
  const horizonWindowLabel = horizon === '1y' && !isCustomBase ? undefined : horizonMeta.windowLabel.toLowerCase();
  const brandsData = useMemo(() => {
    if (!rawBrandsData) return null;
    if ((horizon === '1y' && !isCustomBase) || !moversData?.brand_moves) return rawBrandsData;
    const bm = moversData.brand_moves;
    return rawBrandsData.map((n) => {
      const ov = bm[n.name];
      return ov
        ? { ...n, sold_12m: ov.sold_12m, sold_prior_12m: ov.sold_prior_12m, usd_12m: ov.usd_12m, usd_prior_12m: ov.usd_prior_12m }
        : { ...n, sold_12m: 0, sold_prior_12m: 0, usd_12m: 0, usd_prior_12m: 0 };
    });
  }, [rawBrandsData, horizon, isCustomBase, moversData]);
  const baseline = useMemo(() => venue ?? batBaseline(brandsData), [venue, brandsData]);
  // Where the color is measured: the refresh receipt's houses (treemap_populations().measured_houses), not a list in code.
  const houses = useMemo(() => measuredHouses(refresh.populations?.measured_houses), [refresh.populations?.measured_houses]);
  // Without hover (a phone), a tap on a market tile opens its card; the card's Open drills.
  const [coarse] = useState(() => canMatchMedia && window.matchMedia('(hover: none)').matches);
  const [sheet, setSheet] = useState<TreemapNode | null>(null);
  // What a market tile's area counts: every venue and year in the ledger (the default: the owner, 2026-10-15, "is
  // supposed to be all the markets not just one"), or Bring a Trailer's dollars over the last 12 months, the color's
  // own population. The color stays BaT's move, the one venue held in full both years, hatched where BaT holds under
  // half a tile's sales.
  const [basis, setBasis] = useState<MapBasis>('ledger');
  // A brand opens on its model families; when none can be read it opens on its model names, as before.
  const atFamilies = !!currentLevel.make && !currentLevel.family && !currentLevel.model;
  const [groupBrandPickups, setGroupBrandPickups] = useState<boolean>(true);
  const { data: rawFamiliesData, loading: familiesLoading, failed: familiesFailed } = useTreemapFamilies(currentLevel.make ?? null);
  const hasMultipleBrandPickups = useMemo(
    () => (rawFamiliesData ? rawFamiliesData.filter((f) => isPickupFamilyLabel(f.name)).length > 1 : false),
    [rawFamiliesData],
  );
  const familiesData = useMemo(() => {
    if (!rawFamiliesData) return null;
    const withMoves = ((horizon === '1y' && !isCustomBase) || !moversData?.family_moves || !currentLevel.make)
      ? rawFamiliesData
      : rawFamiliesData.map((n) => {
          if (!n.familyKey || n.familyKey === 'other') return n;
          const ov = moversData.family_moves![`${currentLevel.make}|${n.familyKey}`];
          return ov
            ? { ...n, sold_12m: ov.sold_12m, sold_prior_12m: ov.sold_prior_12m, usd_12m: ov.usd_12m, usd_prior_12m: ov.usd_prior_12m }
            : { ...n, sold_12m: 0, sold_prior_12m: 0, usd_12m: 0, usd_prior_12m: 0 };
        });
    return consolidateBrandPickupFamilies(currentLevel.make, withMoves, groupBrandPickups);
  }, [rawFamiliesData, horizon, isCustomBase, moversData, currentLevel.make, groupBrandPickups]);
  const { data: modelsData, loading: modelsLoading } = useTreemapModels(atFamilies && familiesFailed ? currentLevel.make ?? null : null);
  const { data: familyModelsData, loading: familyModelsLoading } = useTreemapFamilyModels(
    currentLevel.family ? currentLevel.make ?? null : null,
    currentLevel.family ? currentLevel.family : null,
  );
  const { data: yearsData, loading: yearsLoading } = useTreemapYears(
    currentLevel.model ? currentLevel.make ?? null : null,
    currentLevel.model ? currentLevel.model ?? null : null
  );
  // The top level as brands, or as brands with their families inside (finviz's map of the market).
  const [brandView, setBrandView] = useState<'brands' | 'nested'>('brands');
  // A family keeps its model names as clickable treemap tiles; the sales chart is shown below when embedded (or via the switch).
  const urlFamilyView = searchParams.get('family_view') === 'sales' ? 'sales' : 'names';
  const [familyView, setFamilyViewState] = useState<'sales' | 'names'>(urlFamilyView);
  const setFamilyView = useCallback((view: 'sales' | 'names') => {
    setFamilyViewState(view);
    setSearchParams(curr => {
      const next = new URLSearchParams(curr);
      if (view === 'sales' && next.get('family')) next.set('family_view', 'sales');
      else next.delete('family_view');
      return next;
    }, { preventScrollReset: true });
  }, [setSearchParams]);
  const setFacetAxis = useCallback((nextAxis: FamilyFacetAxis) => {
    facetAxisRef.current = nextAxis;
    setFacetAxisState(nextAxis);
    const prev = drillStackRef.current;
    // When switching facet axes inside a family, reset any previously drilled facet/sub-model back to the family level
    // so the newly selected facet axis tiles/pills and URL (?axis=... without stale ?facet=...) stay in sync.
    const famEntry = prev.find((d) => d.family && !d.model);
    const makeEntry = prev.find((d) => d.make && !d.family && !d.model);
    const nextStack =
      famEntry && makeEntry && prev.some((d) => d.model)
        ? [{ label: 'ALL MAKES' }, makeEntry, famEntry]
        : prev;
    drillStackRef.current = nextStack;
    setDrillStackState(nextStack);
    setSearchParams((curr) => applyDrillStackToSearchParams(curr, nextStack, nextAxis), { preventScrollReset: true });
  }, [setSearchParams]);
  useEffect(() => {
    setFamilyViewState(urlFamilyView);
    if (urlFamilyView === 'sales') setPhoneBrowseView('map');
    const truck = isGmTruckBrand(currentLevel.make) && drillStack.find((d) => d.family && !d.model)?.label === 'Truck';
    const resolvedAxis = urlAxis ?? (truck && !currentLevel.model ? 'series' : 'raw');
    facetAxisRef.current = resolvedAxis;
    setFacetAxisState(resolvedAxis);
  }, [currentLevel.make, currentLevel.family, urlAxis, urlFamilyView, drillStack.find((d) => d.family && !d.model)?.label]);

  // Family-wide sales (5-year dated window via treemap_family_sales): enables direct Family -> Years -> Vehicles navigation
  // and Era filtering without requiring a fragmented raw model string first.
  const { sales: familySalesData } = useFamilySales(
    currentLevel.family ? currentLevel.make ?? null : null,
    currentLevel.family ? currentLevel.family : null,
  );
  const activeFamilyLabel = useMemo(
    () => drillStack.find((d) => d.family && !d.model)?.label || searchParams.get('family_name') || currentLevel.model || currentLevel.label,
    [drillStack, searchParams, currentLevel.model, currentLevel.label],
  );
  const truckMode = isGmTruckBrand(currentLevel.make) && activeFamilyLabel === 'Truck' && !!currentLevel.family && !currentLevel.model;
  const truckNavigation = readTruckNavigation(searchParams);
  const truckReadKey = truckMode ? `${currentLevel.make}|${currentLevel.family}` : '';
  const [truckAttempt, setTruckAttempt] = useState(0);
  const truckCache = useRef(new Map<string, { data: TruckRead; readAt: number }>());
  const [truckState, setTruckState] = useState<{ key: string; data: TruckRead | null; isError: boolean }>({ key: '', data: null, isError: false });
  useEffect(() => {
    if (!truckReadKey) return;
    const cached = truckCache.current.get(truckReadKey);
    if (cached && Date.now() - cached.readAt < 60_000 && truckAttempt === 0) {
      setTruckState({ key: truckReadKey, data: cached.data, isError: false }); return;
    }
    let live = true;
    setTruckState({ key: truckReadKey, data: null, isError: false });
    const load = async () => {
      const members: TruckRead['members'] = [];
      let snapshot: string | null = null, asOf = '', nextPartition = 0;
      const seen = new Set<string>();
      const readPartition = async (partition: number) => {
        let cursor: string | null = null;
        for (let page = 0; page < 100; page++) {
          const { data, error }: { data: unknown; error: unknown } = await supabase.rpc('treemap_family_models', {
            p_brand: currentLevel.make!, p_family_key: currentLevel.family!, p_members: true, p_after: cursor, p_partition: partition,
          });
          if (!live) return;
          const parsed = error ? null : parseTruckMembers(data);
          const meta = data as { has_more?: unknown; snapshot?: unknown; next_cursor?: unknown } | null;
          if (!parsed || parsed.truncated || !meta || typeof meta.has_more !== 'boolean' || typeof meta.snapshot !== 'string' ||
            (snapshot !== null && meta.snapshot !== snapshot)) throw new Error('Incomplete or changing truck membership');
          snapshot = meta.snapshot; asOf = parsed.asOf;
          for (const member of parsed.members) {
            if (seen.has(member.id)) throw new Error('Repeated truck member');
            seen.add(member.id); members.push(member);
          }
          if (!meta.has_more) return;
          if (typeof meta.next_cursor !== 'string' || meta.next_cursor === cursor) throw new Error('Invalid page cursor');
          cursor = meta.next_cursor;
        }
        throw new Error('Truck membership exceeds read bound');
      };
      // Disjoint UUID ranges bound every read; four requests at a time avoid
      // serial page latency without an unbounded request fan-out.
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (nextPartition < 4 && live) await readPartition(nextPartition++);
      }));
      if (!live) return;
      const complete = { members, n: members.length, asOf, truncated: false };
      truckCache.current.set(truckReadKey, { data: complete, readAt: Date.now() });
      setTruckState({ key: truckReadKey, data: complete, isError: false });
    };
    load().catch(() => { if (live) { live = false; setTruckState({ key: truckReadKey, data: null, isError: true }); } });
    return () => { live = false; };
  }, [truckReadKey, truckAttempt]);
  const truckRead = {
    data: truckState.key === truckReadKey ? truckState.data : null,
    isError: truckState.key === truckReadKey && truckState.isError,
    isLoading: !!truckReadKey && (truckState.key !== truckReadKey || (!truckState.data && !truckState.isError)),
  };
  const truckMembers = useMemo(() => truckMode && truckRead.data
    ? filterTruckMembers(truckRead.data.members, truckNavigation.filters, currentLevel.make!) : [],
    [truckMode, truckRead.data, searchParams, currentLevel.make]);
  const truckNodes = useMemo(() => partitionTruckMembers(truckMembers, truckNavigation.axis, currentLevel.make ?? ''),
    [truckMembers, truckNavigation.axis, currentLevel.make]);
  const updateTruckNavigation = useCallback((axis?: TruckAxis | 'vehicles', selection?: { axis: TruckAxis; value: string | null }, clear = false) => {
    setSearchParams(curr => {
      const next = new URLSearchParams(curr);
      for (const key of ['model', 'year', 'axis', 'facet', 'era']) next.delete(key);
      if (clear) for (const a of TRUCK_AXES) next.delete(`truck_${a}`);
      if (axis) next.set('truck_group', axis);
      if (selection) {
        if (selection.value) next.set(`truck_${selection.axis}`, selection.value);
        else next.delete(`truck_${selection.axis}`);
      }
      return next;
    }, { preventScrollReset: true });
  }, [setSearchParams]);
  const truckMemberIds = useMemo(() => new Set(truckMembers.map(m => m.id)), [truckMembers]);
  const activeFacetOrModelLabel = useMemo(
    () =>
      facetAxis !== 'raw' && currentLevel.model
        ? drillStack.find((d) => d.model && !d.year)?.label ?? currentLevel.model
        : currentLevel.model ?? null,
    [facetAxis, currentLevel.model, drillStack],
  );
  const familyYearsNodes = useMemo<TreemapNode[] | null>(() => {
    if (!familySalesData || familySalesData.length === 0) return null;
    const byYear = new Map<number, number[]>();
    const seen = new Set<string>();
    for (const s of familySalesData) {
      if (s.year == null || !Number.isFinite(s.year) || s.usd <= 0) continue;
      if (
        activeFacetOrModelLabel &&
        !matchesSaleSubModel(s.model, activeFacetOrModelLabel, {
          brand: currentLevel.make,
          family: activeFamilyLabel,
          year: s.year,
        })
      ) {
        continue;
      }
      const sig = `${s.year}|${s.usd}|${s.source ?? ''}|${s.sale_date ?? s.vehicle_id}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      const arr = byYear.get(s.year) ?? [];
      arr.push(s.usd);
      byYear.set(s.year, arr);
    }
    const out: TreemapNode[] = [];
    for (const [yr, prices] of byYear.entries()) {
      const sorted = [...prices].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      const mid = sorted.length >> 1;
      const median = sorted.length >= 5
        ? Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
        : undefined;
      out.push({
        name: String(yr),
        count: sorted.length,
        value: sum,
        median_price: median,
        sold_count: sorted.length,
        auction_count: sorted.length,
      });
    }
    return out.sort((a, b) => b.value - a.value || parseInt(b.name, 10) - parseInt(a.name, 10));
  }, [familySalesData, activeFacetOrModelLabel, currentLevel.make, activeFamilyLabel]);
  const familyYearVehiclesNodes = useMemo<TreemapNode[] | null>(() => {
    if (!familySalesData || !currentLevel.year || !currentLevel.make) return null;
    if (currentLevel.model && facetAxis === 'raw') return null;
    const yr = currentLevel.year;
    const seen = new Set<string>();
    return familySalesData
      .filter((s) => {
        if (s.year !== yr || s.usd <= 0) return false;
        if (
          activeFacetOrModelLabel &&
          !matchesSaleSubModel(s.model, activeFacetOrModelLabel, {
            brand: currentLevel.make,
            family: activeFamilyLabel,
            year: s.year,
          })
        ) {
          return false;
        }
        const sig = `${s.year}|${s.usd}|${s.source ?? ''}|${s.sale_date ?? s.vehicle_id}`;
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      })
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 200)
      .map((s) => ({
        name: [s.year, currentLevel.make, s.model ? s.model.split(' · ')[0].trim() : null].filter(Boolean).join(' '),
        count: 1,
        value: s.usd,
        median_price: s.usd,
        id: s.vehicle_id,
        isVehicle: true,
      }));
  }, [familySalesData, currentLevel.year, currentLevel.model, currentLevel.make, facetAxis, activeFacetOrModelLabel, activeFamilyLabel]);
  const effectiveYearsData =
    facetAxis !== 'raw' && familyYearsNodes && familyYearsNodes.length > 0
      ? familyYearsNodes
      : (currentLevel.model && yearsData && yearsData.length > 0)
        ? yearsData
        : (familyYearsNodes ?? yearsData);
  // Filter family sub-model tiles by active Era when familySalesData is loaded
  const eraFilteredFamilyModels = useMemo<TreemapNode[] | null>(() => {
    if (!familyModelsData) return null;
    if (!selectedEra || !familySalesData || familySalesData.length === 0) return familyModelsData;
    const nowMs = Date.now();
    const dayMs = 86_400_000;
    const cutoff12m = nowMs - 365 * dayMs;
    const cutoff24m = nowMs - 730 * dayMs;
    const measuredHouses = new Set(['Bring a Trailer', 'Mecum', 'Bonhams']);
    const existingByKey = new Map<string, TreemapNode>();
    for (const node of familyModelsData) {
      existingByKey.set(node.name.trim().toLowerCase(), node);
    }
    const byModel = new Map<string, {
      displayName: string;
      count: number;
      usd: number;
      prices: number[];
      dated: number;
      sold12m: number;
      soldPrior12m: number;
      usd12m: number;
      usdPrior12m: number;
    }>();
    for (const s of familySalesData) {
      if (!matchesEraRange(s.year, selectedEra) || s.usd <= 0 || !s.model) continue;
      const trimmed = s.model.split(' · ')[0].trim();
      const key = trimmed.toLowerCase();
      const prev = byModel.get(key) ?? {
        displayName: existingByKey.get(key)?.name ?? trimmed,
        count: 0,
        usd: 0,
        prices: [],
        dated: 0,
        sold12m: 0,
        soldPrior12m: 0,
        usd12m: 0,
        usdPrior12m: 0,
      };
      prev.count += 1;
      prev.usd += s.usd;
      prev.prices.push(s.usd);
      if (s.source && measuredHouses.has(s.source)) {
        prev.dated += 1;
        const t = Date.parse(s.sale_date);
        if (Number.isFinite(t)) {
          if (t > cutoff12m && t <= nowMs) {
            prev.sold12m += 1;
            prev.usd12m += s.usd;
          } else if (t > cutoff24m && t <= cutoff12m) {
            prev.soldPrior12m += 1;
            prev.usdPrior12m += s.usd;
          }
        }
      }
      byModel.set(key, prev);
    }
    if (byModel.size === 0) return familyModelsData;
    const out: TreemapNode[] = [];
    for (const [key, stat] of byModel.entries()) {
      const sorted = [...stat.prices].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      const median = sorted.length > 0
        ? Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
        : undefined;
      const baseNode = existingByKey.get(key);
      out.push({
        ...(baseNode ?? { name: stat.displayName }),
        name: baseNode?.name ?? stat.displayName,
        count: stat.count,
        value: stat.usd,
        usd: stat.usd,
        median_price: median,
        dated: stat.dated,
        sold_12m: stat.sold12m,
        sold_prior_12m: stat.soldPrior12m,
        usd_12m: stat.usd12m,
        usd_prior_12m: stat.usdPrior12m,
        offered: baseNode && stat.count === baseNode.count ? baseNode.offered : undefined,
        sold_any: baseNode && stat.count === baseNode.count ? baseNode.sold_any : undefined,
      });
    }
    out.sort((a, b) => b.value - a.value || b.count - a.count || a.name.localeCompare(b.name));
    return out.length > 0 ? out.slice(0, 200) : familyModelsData;
  }, [familyModelsData, selectedEra, familySalesData]);
  // Vehicle-level data: fetched when we have make+model and either a year or coming from years level
  const vehicleMake = currentLevel.year ? currentLevel.make ?? null : null;
  const vehicleModel = currentLevel.year ? currentLevel.model ?? null : null;
  const vehicleYear = currentLevel.year ?? null;
  const { data: vehiclesData, loading: vehiclesLoading } = useTreemapVehicles(vehicleMake, vehicleModel, vehicleYear);

  // Sync URL scope changes (Back/Forward, search, lower sections) and canonical brand/family labels into drillStack.
  const urlScopeKey = [...SCOPE_PARAM_KEYS, 'axis', 'facet'].map((k) => searchParams.get(k) ?? '').join('\x1f');
  useEffect(() => {
    setDrillStackState((prev) => {
      const fromUrl = drillStackFromSearchParams(searchParams, brandsData, familiesData);
      const same = prev.length === fromUrl.length && prev.every((a, i) => {
        const b = fromUrl[i];
        return a.label === b.label && a.make === b.make && a.family === b.family && a.names === b.names && a.model === b.model && a.year === b.year;
      });
      return same ? prev : fromUrl;
    });
  }, [urlScopeKey, brandsData, familiesData, searchParams]);

  // Re-key family sub-models along the active facet axis ('raw' | 'series' | 'trim' | 'body')
  const facetedFamilyModels = useMemo<TreemapNode[] | null>(() => {
    const base = eraFilteredFamilyModels ?? familyModelsData;
    if (!base || base.length === 0) {
      if (facetAxis !== 'raw' && activeFacetOrModelLabel && currentLevel.make && currentLevel.family) {
        return [
          {
            name: activeFacetOrModelLabel,
            count: 1,
            value: 1,
            badgeSvg: resolveTileBadgeSvg(currentLevel.make, activeFamilyLabel, activeFacetOrModelLabel),
          },
        ];
      }
      return null;
    }
    if (facetAxis === 'raw') {
      return base.map((n) => ({
        ...n,
        badgeSvg: n.badgeSvg ?? resolveTileBadgeSvg(currentLevel.make, activeFamilyLabel, n.name),
      }));
    }
    const built =
      buildFacetNodes(
        facetAxis,
        currentLevel.make,
        activeFamilyLabel,
        base,
        isGmTruckBrand(currentLevel.make) && activeFamilyLabel === 'Truck' && facetAxis === 'series' ? null : familySalesData,
        selectedEra ? (yr) => matchesEraRange(yr, selectedEra) : undefined,
      ) ?? [];
    if (
      activeFacetOrModelLabel &&
      !built.some((n) => n.name.toLowerCase() === activeFacetOrModelLabel.toLowerCase())
    ) {
      return [
        {
          name: activeFacetOrModelLabel,
          count: 1,
          value: 1,
          badgeSvg: resolveTileBadgeSvg(currentLevel.make, activeFamilyLabel, activeFacetOrModelLabel),
        },
        ...built,
      ];
    }
    return built;
  }, [eraFilteredFamilyModels, familyModelsData, facetAxis, currentLevel.make, currentLevel.family, activeFamilyLabel, activeFacetOrModelLabel, familySalesData, selectedEra]);

  // Vetted, period-accurate marque emblems, fender plates, and scripts for the active scope
  const activeIdentityMarks = useMemo(
    () =>
      resolveVettedIdentityMarks({
        make: currentLevel.make,
        familyLabel: activeFamilyLabel,
        model: currentLevel.model,
        year: currentLevel.year,
        eraId: selectedEra,
      }),
    [currentLevel.make, activeFamilyLabel, currentLevel.model, currentLevel.year, selectedEra],
  );

  // Determine active data and level type
  const levelType: MapLevel =
    currentLevel.year ? 'vehicles' :
    currentLevel.model ? 'years' :
    currentLevel.family ? 'models' :
    currentLevel.make ? 'families' : 'brands';

  const activeData = useMemo(() => {
    if (truckMode) return truckRead.data ? truckNodes : null;
    if (levelType === 'vehicles' && facetAxis !== 'raw' && familyYearVehiclesNodes && familyYearVehiclesNodes.length > 0) {
      return familyYearVehiclesNodes;
    }
    if (levelType === 'years' && facetAxis !== 'raw' && familyYearsNodes && familyYearsNodes.length > 0) {
      if (!selectedEra) return familyYearsNodes;
      const filtered = familyYearsNodes.filter((n) => matchesEraRange(parseInt(n.name, 10), selectedEra));
      return filtered.length > 0 ? filtered : familyYearsNodes;
    }
    // Check prefetch cache before hook data — eliminates loading flash on drill-in
    if (levelType === 'vehicles' && currentLevel.make && currentLevel.model && currentLevel.year) {
      const cached = prefetchCache.current.get(`${currentLevel.make}/${currentLevel.model}/${currentLevel.year}`);
      if (cached) return cached;
    }
    if (levelType === 'years' && currentLevel.make && currentLevel.model) {
      const cached = prefetchCache.current.get(`${currentLevel.make}/${currentLevel.model}`);
      if (cached) {
        if (!selectedEra) return cached;
        const filtered = cached.filter((n) => matchesEraRange(parseInt(n.name, 10), selectedEra));
        return filtered.length > 0 ? filtered : cached;
      }
    }
    if (levelType === 'vehicles' && vehiclesData) return vehiclesData;
    if (levelType === 'vehicles' && familyYearVehiclesNodes) return familyYearVehiclesNodes;
    if (levelType === 'years' && (yearsData || familyYearsNodes)) {
      const effectiveYears = (yearsData && yearsData.length > 0) ? yearsData : (familyYearsNodes ?? yearsData);
      if (!effectiveYears) return null;
      if (!selectedEra) return effectiveYears;
      const filtered = effectiveYears.filter((n) => matchesEraRange(parseInt(n.name, 10), selectedEra));
      return filtered.length > 0 ? filtered : effectiveYears;
    }
    if (levelType === 'models' && (facetedFamilyModels ?? eraFilteredFamilyModels)) return facetedFamilyModels ?? eraFilteredFamilyModels;
    if (levelType === 'families' && familiesData) return familiesData;
    if (levelType === 'families' && familiesFailed && modelsData) return modelsData;
    if (brandsData) return brandsData;
    return null;
    // drillStack triggers recompute when navigating so ref cache is checked
  }, [truckMode, truckRead.data, truckNodes, levelType, brandsData, familiesData, familiesFailed, modelsData, facetedFamilyModels, eraFilteredFamilyModels, yearsData, vehiclesData, familyYearVehiclesNodes, currentLevel, drillStack, selectedEra]);

  const isLoading = truckMode ? truckRead.isLoading : levelType === 'brands' ? brandsLoading
    : levelType === 'families' ? familiesLoading || (familiesFailed && modelsLoading)
    : levelType === 'models' ? familyModelsLoading
    : levelType === 'years' ? yearsLoading
    : vehiclesLoading;

  // ── Prefetch: fire supabase queries on 200ms hover debounce ──
  const prefetchYears = useCallback((make: string, model: string) => {
    const key = `${make}/${model}`;
    if (prefetchCache.current.has(key)) return;
    supabase.rpc('treemap_years', { p_source: null, p_make: make, p_model: model }).then(({ data: result, error }) => {
      if (result && !error) prefetchCache.current.set(key, result as TreemapNode[]);
    });
  }, []);

  const prefetchVehicles = useCallback((make: string, model: string, year: number) => {
    const key = `${make}/${model}/${year}`;
    if (prefetchCache.current.has(key)) return;
    readTreemapSales(make, model, year).then((result) => {
      if (result) prefetchCache.current.set(key, result);
    });
  }, []);

  const handleCellMouseEnter = useCallback((node: TreemapNode) => {
    if (truckMode) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      if (currentLevel.make && !node.noModel && (levelType === 'models' || (levelType === 'families' && !node.familyKey))) {
        prefetchYears(currentLevel.make, node.name);
      } else if (levelType === 'years' && currentLevel.make && currentLevel.model) {
        const year = parseInt(node.name, 10);
        if (Number.isFinite(year)) prefetchVehicles(currentLevel.make, currentLevel.model, year);
      }
    }, 200);
  }, [truckMode, levelType, currentLevel, prefetchYears, prefetchVehicles]);

  const handleCellMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  // Representative images for aggregate cells (models/years levels); none while a family shows its sales chart, which
  // has no tiles to put them on (the read ran under the chart on every family drill).
  const truckImageMembers = useMemo(() => truckMembers.map(m => ({ vehicle_id: m.id, usd: m.usd, year: m.year, model: m.model })), [truckMembers]);
  const repImages = useRepresentativeImages(
    truckMode ? truckNodes : levelType === 'models' ? (familyView === 'names' ? (facetedFamilyModels ?? eraFilteredFamilyModels ?? familyModelsData) : null) : levelType === 'years' ? effectiveYearsData
      : levelType === 'vehicles' && !currentLevel.model ? familyYearVehiclesNodes
      : levelType === 'families' && familiesFailed ? modelsData : null,
    currentLevel.make,
    currentLevel.model,
    truckMode ? truckImageMembers : familySalesData,
    truckMode,
  );

  // Container sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setDims({ w: Math.floor(r.width), h: Math.floor(r.height) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute treemap layout
  // A market level: brands or families where every tile carries dollars (#1342); there the size switch applies.
  const marketLevel = (levelType === 'brands' || levelType === 'families') && !!activeData?.length
    && activeData.filter((n) => n.count > 0).every((n) => n.usd != null && n.usd > 0);
  const rects = useMemo(() => {
    if (!activeData || dims.w < 10 || dims.h < 10) return [];
    const PAD = 2; // border space
    const items = activeData
      .filter(n => n.count > 0)
      .map(node => ({ node, area: marketLevel && basis === 'bat12' ? (node.usd_12m ?? 0) : node.usd && node.usd > 0 ? node.usd : node.count }))
      .filter(item => item.area > 0);
    return squarify(items, PAD, PAD, dims.w - PAD * 2, dims.h - PAD * 2);
  }, [activeData, dims, marketLevel, basis]);
  const bat12Totals = useMemo(() => (activeData ?? []).reduce((t, n) => ({ sold: t.sold + (n.sold_12m ?? 0), usd: t.usd + (n.usd_12m ?? 0) }), { sold: 0, usd: 0 }), [activeData]);
  const captionBridge = useMemo(() => {
    if (isCustomBase || horizon === 'upcoming') return '';
    const node = levelType === 'families' ? brandsData?.find((n) => n.name === currentLevel.make)
      : levelType === 'models' ? familiesData?.find((n) => n.familyKey === currentLevel.family) : null;
    return horizon === '1y' ? windowBridge(node) : windowBridge(node, horizonMeta.recentUnit, horizonMeta.priorUnit);
  }, [isCustomBase, horizon, horizonMeta, levelType, brandsData, familiesData, currentLevel.make, currentLevel.family]);

  const totalCount = useMemo(
    () => (activeData || []).reduce((s, n) => s + n.count, 0),
    [activeData]
  );

  // Tooltip
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const tooltipId = useId();
  const currentCrumb = useRef<HTMLButtonElement>(null);
  const mapExit = useRef<HTMLHeadingElement>(null);
  const focusAfterDrill = useRef(false);
  // A drill or a view switch replaces the tiles under the pointer, and the tile a tooltip came from can no longer clear it:
  // over the sales chart the 911 tile's tooltip stayed on screen (2026-10-15).
  useEffect(() => {
    setTooltip(null); setSheet(null);
    if (focusAfterDrill.current) {
      focusAfterDrill.current = false;
      currentCrumb.current?.focus();
    }
  }, [drillStack, brandView, familyView, searchParams]);

  // Drill down — continuous zoom: makes → models → years → vehicles → profile
  const [clickOrigin, setClickOrigin] = useState<{ x: number; y: number } | null>(null);
  const drillInto = useCallback((node: TreemapNode, e?: React.MouseEvent) => {
    if (e) {
      const container = containerRef.current;
      if (container) {
        const cr = container.getBoundingClientRect();
        setClickOrigin({ x: e.clientX - cr.left, y: e.clientY - cr.top });
      }
    }
    if (truckMode) {
      focusAfterDrill.current = true;
      if (node.isVehicle && node.id) navigate(`/vehicle/${node.id}`);
      else if (truckNavigation.axis !== 'vehicles') {
        const remaining = TRUCK_AXES.filter(a => a !== truckNavigation.axis && !truckNavigation.filters[a] && a !== 'raw');
        updateTruckNavigation(remaining[0] ?? 'vehicles', { axis: truckNavigation.axis, value: node.name });
      }
      return;
    }
    if (levelType === 'brands') {
      recordInterest('make', node.name);
      setDrillStack(prev => [...prev, { label: node.name, make: node.name }]);
    } else if (levelType === 'families' && node.familyKey) {
      setDrillStack(prev => [...prev, { label: node.name, make: currentLevel.make, family: node.familyKey, names: node.models ?? undefined }]);
    } else if (levelType === 'families' || levelType === 'models') {
      // A family's model name, or the brand's own when families could not be read; a sale without a name stops here.
      if (node.noModel) return;
      const effectiveAxis = node.facetAxis ?? facetAxisRef.current;
      const targetModel = effectiveAxis !== 'raw' ? node.name : (node.facetRepresentativeModel ?? node.name);
      recordInterest('model', targetModel);
      setDrillStack(
        prev => [...prev, { label: node.name, make: currentLevel.make, family: currentLevel.family, model: targetModel }],
        effectiveAxis,
      );
    } else if (levelType === 'years') {
      const year = parseInt(node.name, 10);
      if (Number.isFinite(year)) {
        setDrillStack(prev => [...prev, { label: String(year), make: currentLevel.make, family: currentLevel.family, model: currentLevel.model, year }]);
      }
    } else if (levelType === 'vehicles' && node.id) {
      navigate(`/vehicle/${node.id}`);
    }
  }, [truckMode, truckNavigation.axis, searchParams, updateTruckNavigation, levelType, currentLevel, navigate, recordInterest]);

  // Navigate back
  const goBack = useCallback((toIndex: number) => {
    prefetchCache.current.clear();
    setDrillStack(prev => prev.slice(0, toIndex + 1));
  }, []);

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const { results: searchResults, noResults } = useSearchPreview(searchInput);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) {
      navigate('/search');
      return;
    }
    void resolveMarketScopeQuery(q).then((resolved) => {
      if (resolved) {
        const nextUrl = buildMarketScopeUrl(resolved, searchParams.toString());
        setSearchParams(new URLSearchParams(nextUrl.replace(/^\/\?/, '')), { preventScrollReset: true });
        setSearchInput('');
        setSearchFocused(false);
      } else {
        navigate(`/search?q=${encodeURIComponent(q)}`);
      }
    });
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showDropdown = searchFocused && searchInput.trim().length >= 2 && (searchResults.length > 0 || noResults);

  const formatPrice = (v: { sale_price?: number | null; asking_price?: number | null }) => {
    const p = v.sale_price || v.asking_price;
    if (!p) return null;
    if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(1)}M`;
    if (p >= 1_000) return `$${Math.round(p / 1_000)}K`;
    return `$${p.toLocaleString()}`;
  };

  // Transition animation state — zoom in/out
  const [transitioning, setTransitioning] = useState(false);
  const [zoomDir, setZoomDir] = useState<'in' | 'out'>('in');
  const prevLevelRef = useRef(levelType);
  const prevStackLen = useRef(drillStack.length);
  useEffect(() => {
    if (prevLevelRef.current !== levelType) {
      setZoomDir(drillStack.length > prevStackLen.current ? 'in' : 'out');
      setTransitioning(true);
      const t = setTimeout(() => setTransitioning(false), 180);
      prevLevelRef.current = levelType;
      prevStackLen.current = drillStack.length;
      return () => clearTimeout(t);
    }
  }, [levelType, drillStack.length]);

  const browseKind = truckMode ? (truckNavigation.axis === 'vehicles' ? 'vehicle' : TRUCK_AXIS_LABELS[truckNavigation.axis].toLowerCase()) : levelType === 'brands' ? 'make' : levelType === 'families' ? 'family'
    : levelType === 'models' ? (facetAxis === 'series' ? 'series' : facetAxis === 'trim' ? 'trim' : facetAxis === 'body' ? 'body style' : 'model')
    : levelType === 'years' ? 'year' : 'vehicle';
  const browseOptions = (isLoading ? [] : activeData ?? []).filter(node => node.count > 0);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        // Embedded, the map keeps its own height and what explains it (movers, legend) flows below it in the page.
        height: embedded ? 'auto' : '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'Arial, sans-serif',
        overflow: embedded ? 'visible' : 'hidden',
      }}
    >
      {/* ─── HEADER BAR (the page's own; the app header stands in for it when embedded) ─── */}
      {!embedded && <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          height: 48,
          borderBottom: '2px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        {/* Logo / Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div
            style={{
              width: 7,
              height: 7,
              background: 'var(--success)',
              animation: 'livePulse 2s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
            onClick={() => setDrillStack([{ label: 'ALL MAKES' }])}
          >
            NUKE
          </span>
          {!isNarrow && (
            <span style={{ fontSize: 9, color: 'var(--text-disabled)', letterSpacing: '0.06em', fontWeight: 600 }}>
              PROVENANCE ENGINE
            </span>
          )}
        </div>

        {/* Search bar */}
        <div ref={searchContainerRef} style={{ position: 'relative', flex: 1, maxWidth: 480 }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', border: '2px solid var(--border)' }}>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              placeholder={isNarrow ? 'Search vehicles...' : 'Search: 1967 Porsche 911, VIN, make, model...'}
              aria-label="Search vehicles"
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: 11,
                fontFamily: 'Arial, sans-serif',
                border: 'none',
                background: 'var(--bg)',
                color: 'var(--text)',
                outline: 'none',
                minWidth: 0,
              }}
            />
            <button
              type="submit"
              style={{
                padding: '8px 16px',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontFamily: 'Arial, sans-serif',
                border: 'none',
                borderLeft: '2px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              SEARCH
            </button>
          </form>
          {showDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface-elevated, #fff)', border: '2px solid var(--border)', borderTop: 'none', zIndex: 10000 }}>
              {searchResults.map((v) => (
                <button
                  key={v.id}
                  onClick={() => { setSearchFocused(false); navigate(`/vehicle/${v.id}`); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', padding: '8px 12px', border: 'none',
                    borderBottom: '1px solid var(--surface)', background: 'transparent',
                    color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
                    fontSize: 11, fontFamily: 'Arial, sans-serif',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span>{[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown Vehicle'}</span>
                  {formatPrice(v) && (
                    <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)', fontSize: 10 }}>
                      {formatPrice(v)}
                    </span>
                  )}
                </button>
              ))}
              {noResults && (
                <div style={{ padding: '8px 12px', color: 'var(--text-disabled)', fontSize: 11 }}>
                  No vehicles found for "{searchInput.trim()}"
                </div>
              )}
            </div>
          )}
        </div>

        {/* Browse button */}
        <button
          onClick={onBrowse}
          style={{
            padding: '8px 16px',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            border: '2px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          FEED
        </button>
      </div>}

      {/* ─── BREADCRUMB / NAVIGATION BAR ─── (one row on a desktop; on a phone the caption and the view switch wrap
          to a second row instead of being clipped) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '2px 16px',
          minHeight: 32,
          borderBottom: '2px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
          gap: 4,
          overflow: 'hidden',
        }}
      >
        {drillStack.map((level, i) => {
          const isLast = i === drillStack.length - 1;
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <span style={{ fontSize: 9, color: 'var(--text-disabled)', margin: '0 2px' }}>/</span>
              )}
              <button
                ref={isLast ? currentCrumb : undefined}
                className="home-map-crumb"
                aria-current={isLast ? 'location' : undefined}
                onClick={() => !isLast && goBack(i)}
                style={{
                  fontSize: 9,
                  fontWeight: isLast ? 700 : 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: isLast ? 'var(--text)' : 'var(--text-secondary)',
                  background: 'transparent',
                  border: 'none',
                  cursor: isLast ? 'default' : 'pointer',
                  padding: '4px 6px',
                  fontFamily: 'Arial, sans-serif',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (!isLast) e.currentTarget.style.color = 'var(--text)';
                }}
                onMouseLeave={(e) => {
                  if (!isLast) e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                {level.label}
              </button>
            </React.Fragment>
          );
        })}

        {/* Level indicator + feed shortcut; wraps under itself on a phone rather than pushing the caption off screen */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end', rowGap: 6, minWidth: 0 }}>
          {truckMode ? <Text role="caption">{truckRead.isError ? 'Truck membership could not be read' : truckRead.isLoading ? 'Reading Truck membership…' : `${truckMembers.length.toLocaleString()} priced sale records · all years`}</Text> : activeData && marketLevel && basis === 'bat12' ? (
            <Text role="caption" title={ledgerViewsStamp(refresh.refreshedAt)}>
              {isNarrow ? `${bat12Totals.sold.toLocaleString('en-US')} BaT sold, 12 mo`
                : `${bat12Totals.sold.toLocaleString('en-US')} Bring a Trailer sales, last 12 months · ${fmtMoneyMap(bat12Totals.usd)}${ledgerViewsClock(refresh.refreshedAt)}`}
            </Text>
          ) : activeData && (
            <Text role="caption" title={ledgerViewsStamp(refresh.refreshedAt)}>
              {isNarrow ? (isLoading ? 'Reading sales…' : mapCaptionShort(levelType, totalCount, refresh))
                : mapCaption(levelType, totalCount, refresh, Date.now(), levelType === 'families' ? captionBridge + familyCoverage(activeData)
                  : levelType === 'models' ? captionBridge + familyNamesShown(
                    facetAxis === 'series' && isGmTruckBrand(currentLevel.make) && activeFamilyLabel === 'Truck'
                      ? familyModelsData?.length ?? 0 : activeData?.length ?? 0,
                    selectedEra
                      ? (eraFilteredFamilyModels?.length ?? activeData?.length)
                      : Math.max(currentLevel.names ?? 0, familyModelsData?.length ?? 0) || undefined,
                  ) : '')}
            </Text>
          )}
          {currentLevel.year && currentLevel.make && currentLevel.model && (
            <Link
              to={`/cohort/${encodeURIComponent(currentLevel.make.toLowerCase())}/${encodeURIComponent(currentLevel.model.toLowerCase())}/${currentLevel.year}`}
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                fontFamily: 'Arial, sans-serif',
                border: '2px solid var(--text)',
                background: 'var(--text)',
                color: 'var(--bg)',
                cursor: 'pointer',
                padding: '4px 12px',
                whiteSpace: 'nowrap',
                textDecoration: 'none',
              }}
            >
              COHORT TERMINAL →
            </Link>
          )}
          {currentLevel.make && (
            <button
              onClick={() => {
                const params = new URLSearchParams();
                params.set('tab', 'feed');
                params.set('make', currentLevel.make!);
                const familyLabel = drillStack.find((d) => d.family && !d.model)?.label || searchParams.get('family_name');
                if (currentLevel.family) params.set('family', currentLevel.family);
                if (familyLabel) params.set('family_name', familyLabel);
                if (currentLevel.model) params.set('model', currentLevel.model);
                else if (familyLabel) params.set('model', familyLabel);
                if (selectedEra) params.set('era', selectedEra);
                if (currentLevel.year) {
                  params.set('year_min', String(currentLevel.year));
                  params.set('year_max', String(currentLevel.year));
                }
                navigate(`/?${params.toString()}`);
              }}
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                fontFamily: 'Arial, sans-serif',
                border: '2px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '4px 12px',
                whiteSpace: 'nowrap',
              }}
            >
              ENTER FEED
            </button>
          )}
          {!isNarrow && levelType === 'brands' && <MapViewSwitch label="Map view" value={brandView} onChange={setBrandView}
            options={[{ value: 'brands', label: 'Brands' }, { value: 'nested', label: 'Families inside' }]} />}
          {!isNarrow && !truckMode && levelType === 'models' && currentLevel.family && <FamilyViewSwitch value={familyView} onChange={setFamilyView} />}
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-disabled)' }}>
            {truckMode ? (truckNavigation.axis === 'vehicles' ? 'VEHICLES' : TRUCK_AXIS_LABELS[truckNavigation.axis].toUpperCase()) : levelType === 'brands' ? 'MAKES' : levelType === 'families' ? (familiesData ? 'FAMILIES' : 'MODELS') : levelType === 'models' ? 'MODELS' : levelType === 'years' ? 'YEARS' : 'VEHICLES'}
          </span>
        </div>
      </div>

      {isNarrow && <section className="home-phone-browse" aria-label="Browse vehicles">
        <div className="home-phone-browse-actions">
          {drillStack.length > 1 && <button type="button" onClick={() => { focusAfterDrill.current = true; goBack(drillStack.length - 2); }}>
            <Text role="label">← Back to {drillStack[drillStack.length - 2].label}</Text>
          </button>}
          <div role="group" aria-label="Browse display" className="home-phone-display">
            {(['list', 'map'] as const).map(view => <button type="button" key={view} aria-pressed={phoneBrowseView === view} onClick={() => { setPhoneBrowseView(view); if (view === 'list') setFamilyView('names'); }}>
              <Text role="label">{view === 'list' ? 'List' : 'Map'}</Text>
            </button>)}
          </div>
        </div>
        <label className="home-phone-browse-picker"><Text role="label">Choose a {browseKind}</Text>
          <select className="k-body" aria-label={`Choose a ${browseKind}`} value="" disabled={isLoading || !browseOptions.length} onChange={event => {
            const node = browseOptions.find(option => (option.id ?? option.name) === event.target.value);
            if (node) { focusAfterDrill.current = true; drillInto(node); }
          }}>
            <option value="">Choose a {browseKind}…</option>
            {browseOptions.map(node => <option key={node.id ?? node.name} value={node.id ?? node.name} disabled={!!node.noModel && !node.familyKey}>{node.listingTitle ?? node.name}</option>)}
          </select>
        </label>
      </section>}

      <details className="home-map-refine" open={!isNarrow}>
        <summary><Text role="label">Refine &amp; map options</Text></summary>
        {isNarrow && levelType === 'brands' && <MapViewSwitch label="Map layout" value={brandView} onChange={value => { setBrandView(value); setPhoneBrowseView('map'); }} options={[{ value: 'brands', label: 'Makes' }, { value: 'nested', label: 'Families inside' }]} />}
        {isNarrow && !truckMode && levelType === 'models' && currentLevel.family && <FamilyViewSwitch value={familyView} onChange={value => { setFamilyView(value); if (value === 'sales') setPhoneBrowseView('map'); }} />}

      {/* ─── BRAND FAMILY PILLS: 1-click navigation across a brand's factory model families at any depth ─── */}
      {(() => {
        if (!currentLevel.make || !familiesData) return null;
        const namedFamilies = familiesData.filter((f) => f.familyKey && f.familyKey !== 'other');
        if (namedFamilies.length < 2) return null;
        return (
          <div className="home-family-submodels" role="navigation" aria-label="Brand families" data-testid="brand-family-pills">
            <span className="home-family-submodels-label">FAMILIES</span>
            {hasMultipleBrandPickups && !isGmTruckBrand(currentLevel.make) && (
              <button
                type="button"
                data-testid="toggle-brand-pickup-umbrella"
                className={`home-family-submodel-pill home-family-submodel-pill--dashed${groupBrandPickups ? ' home-family-submodel-pill--active' : ''}`}
                aria-pressed={groupBrandPickups}
                title={groupBrandPickups
                  ? 'All pickup series (C10, K10, C20, 3100, F-100, F-150, F-250, Sierra, etc.) are unified into one Pickup tile. Click to split into separate series tiles.'
                  : 'Click to group all pickup series into one unified Pickup tile.'}
                onClick={() => setGroupBrandPickups((prev) => !prev)}
              >
                {groupBrandPickups ? 'TRUCKS UNIFIED' : 'SPLIT TRUCKS'}
              </button>
            )}
            <button
              type="button"
              className={`home-family-submodel-pill${!currentLevel.family ? ' home-family-submodel-pill--active' : ''}`}
              aria-pressed={!currentLevel.family}
              onClick={() => {
                setDrillStack([{ label: 'ALL MAKES' }, { label: currentLevel.make!, make: currentLevel.make }]);
              }}
            >
              ALL <span className="home-family-submodel-count">{namedFamilies.length}</span>
            </button>
            {namedFamilies.slice(0, 14).map((fam) => {
              const active =
                currentLevel.family === fam.familyKey ||
                (!!currentLevel.family && fam.name.toLowerCase() === currentLevel.family.toLowerCase()) ||
                (!!activeFamilyLabel && fam.name.toLowerCase() === activeFamilyLabel.toLowerCase());
              return (
                <button
                  key={fam.familyKey}
                  type="button"
                  className={`home-family-submodel-pill${active ? ' home-family-submodel-pill--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    if (active && !currentLevel.model && !currentLevel.year) {
                      setDrillStack([{ label: 'ALL MAKES' }, { label: currentLevel.make!, make: currentLevel.make }]);
                    } else {
                      recordInterest('make', currentLevel.make!);
                      setDrillStack([
                        { label: 'ALL MAKES' },
                        { label: currentLevel.make!, make: currentLevel.make },
                        { label: fam.name, make: currentLevel.make, family: fam.familyKey, names: fam.models ?? undefined },
                      ]);
                    }
                  }}
                >
                  {fam.name} <span className="home-family-submodel-count">{fam.count.toLocaleString('en-US')}</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* ─── VETTED ERA EMBLEM & FENDER BADGE STRIP: period-accurate marque emblems, RPO fender plates & body scripts ─── */}
      {!truckMode && activeIdentityMarks.length > 0 && currentLevel.make && (currentLevel.family || currentLevel.model) && (
        <div
          className="home-family-submodels home-era-marks-bar"
          role="region"
          aria-label="Vetted factory era emblems and fender badges"
          data-testid="vetted-identity-marks-bar"
        >
          <span className="home-family-submodels-label">ERA MARKS</span>
          {activeIdentityMarks.slice(0, 6).map((mark) => {
            const targetModel = mark.trimPackage ?? mark.seriesCode ?? mark.bodyStyle ?? null;
            const markAxis: FamilyFacetAxis =
              mark.trimPackage ? 'trim' : mark.seriesCode ? 'series' : mark.bodyStyle ? 'body' : facetAxis;
            const isMarkActive = Boolean(
              targetModel &&
              currentLevel.model &&
              currentLevel.model.toLowerCase().includes(targetModel.toLowerCase()),
            );
            return (
              <button
                key={mark.id}
                type="button"
                className={`home-family-submodel-pill home-era-mark-pill${isMarkActive ? ' home-family-submodel-pill--active' : ''}`}
                title={`${mark.displayLabel} (${mark.yearStart}–${mark.yearEnd}) · ${mark.subLabel}${mark.rpoCode ? ` · RPO ${mark.rpoCode}` : ''}\n${mark.provenanceNote}`}
                onClick={() => {
                  if (!targetModel || !currentLevel.make || !currentLevel.family) return;
                  const famEntry = drillStack.find((d) => d.family && !d.model) ?? {
                    label: activeFamilyLabel,
                    make: currentLevel.make,
                    family: currentLevel.family,
                  };
                  const canonicalFacet =
                    normalizeFacetSelection(markAxis, targetModel, currentLevel.make, activeFamilyLabel) ?? targetModel;
                  setDrillStack(
                    [
                      { label: 'ALL MAKES' },
                      { label: currentLevel.make, make: currentLevel.make },
                      famEntry,
                      { label: canonicalFacet, make: currentLevel.make, family: currentLevel.family, model: canonicalFacet },
                    ],
                    markAxis,
                  );
                }}
              >
                <span
                  aria-hidden="true"
                  className="home-era-mark-svg"
                  dangerouslySetInnerHTML={{ __html: mark.svgMarkup }}
                />
                <span>{mark.displayLabel}</span>
                <span className="home-family-submodel-count">
                  '{String(mark.yearStart).slice(-2)}–'{String(mark.yearEnd).slice(-2)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── FAMILY SUB-MODEL & FACET AXIS PILLS: re-key by SERIES / TRIM / BODY STYLE / RAW SUB-MODELS ─── */}
      {(() => {
        const rawPool = eraFilteredFamilyModels ?? familyModelsData;
        const subModelPool = facetedFamilyModels ?? rawPool;
        if (
          truckMode || !currentLevel.family ||
          !currentLevel.make ||
          !subModelPool ||
          subModelPool.length === 0 ||
          (subModelPool.length <= 1 && facetAxis === 'raw' && !activeFacetOrModelLabel)
        ) {
          return null;
        }
        const visibleSubModels = (() => {
          const top = subModelPool.slice(0, 12);
          if (!activeFacetOrModelLabel) return top;
          if (top.some((s) => s.name.toLowerCase() === activeFacetOrModelLabel.toLowerCase())) return top;
          const matched = subModelPool.find((s) => s.name.toLowerCase() === activeFacetOrModelLabel.toLowerCase());
          return matched ? [...top.slice(0, 11), matched] : top;
        })();
        const axisOptions: { id: FamilyFacetAxis; label: string }[] = [
          { id: 'raw', label: 'SUB-MODELS' },
          { id: 'series', label: 'SERIES' },
          { id: 'trim', label: 'TRIM' },
          { id: 'body', label: 'BODY STYLE' },
        ];
        return (
          <div className="home-family-submodels" role="group" aria-label="Family sub-models" data-testid="family-submodel-pills">
            <div className="home-facet-axis-tablist" role="tablist" aria-label="Re-key family by facet axis">
              {axisOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={facetAxis === opt.id}
                  data-testid={`facet-axis-${opt.id}`}
                  className={`home-facet-axis-tab${facetAxis === opt.id ? ' home-facet-axis-tab--active' : ''}`}
                  onClick={() => setFacetAxis(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`home-family-submodel-pill${!currentLevel.model ? ' home-family-submodel-pill--active' : ''}`}
              aria-pressed={!currentLevel.model}
              onClick={() => {
                const famEntry = drillStack.find((d) => d.family && !d.model) ?? {
                  label: searchParams.get('family_name') || currentLevel.label,
                  make: currentLevel.make,
                  family: currentLevel.family,
                };
                setDrillStack([{ label: 'ALL MAKES' }, { label: currentLevel.make!, make: currentLevel.make }, famEntry]);
              }}
            >
              ALL <span className="home-family-submodel-count">{subModelPool.length}</span>
            </button>
            {visibleSubModels.map((sub) => {
              const effectiveSubAxis = sub.facetAxis ?? facetAxis;
              const targetModel = effectiveSubAxis !== 'raw' ? sub.name : (sub.facetRepresentativeModel ?? sub.name);
              const active =
                effectiveSubAxis !== 'raw'
                  ? activeFacetOrModelLabel != null && sub.name.toLowerCase() === activeFacetOrModelLabel.toLowerCase()
                  : currentLevel.model === sub.name || currentLevel.model === targetModel;
              return (
                <button
                  key={sub.name}
                  type="button"
                  data-facet-pill={sub.name}
                  className={`home-family-submodel-pill${active ? ' home-family-submodel-pill--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    const famEntry = drillStack.find((d) => d.family && !d.model) ?? {
                      label: searchParams.get('family_name') || currentLevel.label,
                      make: currentLevel.make,
                      family: currentLevel.family,
                    };
                    if (active && !currentLevel.year) {
                      setDrillStack(
                        [{ label: 'ALL MAKES' }, { label: currentLevel.make!, make: currentLevel.make }, famEntry],
                        effectiveSubAxis,
                      );
                    } else {
                      recordInterest('model', `${currentLevel.make!} ${targetModel}`);
                      setDrillStack(
                        [
                          { label: 'ALL MAKES' },
                          { label: currentLevel.make!, make: currentLevel.make },
                          famEntry,
                          { label: sub.name, make: currentLevel.make, family: currentLevel.family, model: targetModel },
                        ],
                        effectiveSubAxis,
                      );
                    }
                  }}
                >
                  {sub.name} <span className="home-family-submodel-count">{sub.count.toLocaleString('en-US')}</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* ─── GENERATION / ERA QUICK-SWITCH BAR: 1-click generation filtering right above the treemap ─── */}
      {(() => {
        if (truckMode || !currentLevel.make || (!currentLevel.family && !currentLevel.model)) return null;
        const familyLabel = drillStack.find((d) => d.family && !d.model)?.label || searchParams.get('family_name') || currentLevel.model || currentLevel.label;
        const definedEras = getDefinedFamilyEras(currentLevel.make, familyLabel);
        const yearList = effectiveYearsData ? effectiveYearsData.flatMap((n) => {
          const y = parseInt(n.name, 10);
          return Number.isFinite(y) ? Array(Math.max(1, n.count)).fill(y) : [];
        }) : [];
        const cohorts = yearList.length > 0 ? getFamilyEraCohorts(currentLevel.make, familyLabel, yearList) : definedEras;
        if (cohorts.length < 2) return null;
        return (
          <div className="home-family-submodels" role="navigation" aria-label="Generation eras">
            <span className="home-family-submodels-label">ERAS</span>
            <button
              type="button"
              className={`home-family-submodel-pill${!selectedEra ? ' home-family-submodel-pill--active' : ''}`}
              aria-pressed={!selectedEra}
              onClick={() => setSelectedEra(null)}
            >
              ALL ERAS
            </button>
            {cohorts.map((cohort) => {
              const active = selectedEra === cohort.id;
              const cohortCount = 'count' in cohort && typeof cohort.count === 'number' ? cohort.count : 0;
              return (
                <button
                  key={cohort.id}
                  type="button"
                  className={`home-family-submodel-pill${active ? ' home-family-submodel-pill--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setSelectedEra(active ? null : cohort.id)}
                >
                  {cohort.label}{cohortCount > 0 && <> <span className="home-family-submodel-count">{cohortCount.toLocaleString('en-US')}</span></>}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* ─── MODEL-YEAR QUICK-SWITCH BAR: 1-click year hopping across a family, sub-model or year ─── */}
      {!truckMode && (levelType === 'models' || levelType === 'years' || levelType === 'vehicles') && currentLevel.make && (currentLevel.family || currentLevel.model) && effectiveYearsData && effectiveYearsData.length > 1 && (() => {
        const eraFiltered = selectedEra
          ? effectiveYearsData.filter((n) => matchesEraRange(parseInt(n.name, 10), selectedEra))
          : effectiveYearsData;
        const pool = (eraFiltered.length > 0 ? eraFiltered : effectiveYearsData)
          .slice()
          .sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));
        if (pool.length < 2) return null;
        return (
          <div className="home-family-submodels" role="navigation" aria-label="Model years" data-testid="family-year-pills">
            <span className="home-family-submodels-label">YEARS</span>
            <button
              type="button"
              className={`home-family-submodel-pill${!currentLevel.year ? ' home-family-submodel-pill--active' : ''}`}
              aria-pressed={!currentLevel.year}
              onClick={() => {
                const withoutYear = drillStack.filter((d) => !d.year);
                setDrillStack(withoutYear);
              }}
            >
              ALL YEARS <span className="home-family-submodel-count">{pool.length}</span>
            </button>
            {pool.map((yrNode) => {
              const yr = parseInt(yrNode.name, 10);
              const active = currentLevel.year === yr;
              return (
                <button
                  key={yrNode.name}
                  type="button"
                  className={`home-family-submodel-pill${active ? ' home-family-submodel-pill--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => {
                    const base = drillStack.filter((d) => !d.year);
                    if (active) {
                      setDrillStack(base);
                    } else if (Number.isFinite(yr)) {
                      setDrillStack([
                        ...base,
                        { label: String(yr), make: currentLevel.make, family: currentLevel.family, model: currentLevel.model, year: yr },
                      ]);
                    }
                  }}
                >
                  {yrNode.name} <span className="home-family-submodel-count">{yrNode.count.toLocaleString('en-US')}</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      </details>

      {/* ─── CALLOUTS: the clearest gain and loss against BaT and the largest tile, each a way into its tile ─── */}
      {!phoneList && marketLevel && !(levelType === 'brands' && brandView === 'nested') && activeData && (
        <MapCallouts items={callouts(activeData, baseline, gateMin)} windowLabel={horizonWindowLabel} onPick={(name) => {
          const node = activeData.find((n) => n.name === name);
          if (node) { if (coarse) setSheet(node); else drillInto(node); }
        }} />
      )}

      {truckMode && <TruckFacetToolbar axis={truckNavigation.axis} filters={truckNavigation.filters}
        pending={!truckRead.data} count={truckMembers.length} total={truckRead.data?.n ?? 0} usd={truckMembers.reduce((sum, m) => sum + m.usd, 0)}
        onGroup={axis => updateTruckNavigation(axis)} onRemove={axis => updateTruckNavigation(undefined, { axis, value: null })}
        onClear={() => updateTruckNavigation(undefined, undefined, true)} />}
      {truckMode && truckRead.isError && <div role="alert">Complete truck membership could not be read. <button type="button" onClick={() => setTruckAttempt(n => n + 1)}>Retry</button></div>}
      {/* ─── TREEMAP VIEWPORT ─── */}
      <a className="market-map-skip" href="#market-map-exit" onClick={(e) => {
        e.preventDefault();
        mapExit.current?.focus({ preventScroll: true });
        mapExit.current?.scrollIntoView({ block: 'center' });
      }}>Skip map tiles</a>
      <div
        ref={containerRef}
        style={{
          flex: embedded ? 'none' : 1,
          height: phoneList ? 'auto' : embedded ? 'clamp(440px, 64vh, 820px)' : undefined,
          position: 'relative',
          overflow: phoneList ? 'auto' : 'hidden',
          background: 'var(--bg)',
          minHeight: phoneList ? 120 : 0,
        }}
        onMouseLeave={() => setTooltip(null)}
      >
        {isLoading && !activeData && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: 'var(--text-disabled)', fontFamily: "'Courier New', monospace",
            letterSpacing: '0.08em',
          }}>
            LOADING...
          </div>
        )}

        {/* Loading overlay for transitions */}
        {isLoading && activeData && (
          <div style={{
            position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--bg) 60%, transparent)',
            zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: 'var(--text-disabled)', fontFamily: "'Courier New', monospace",
          }}>
            LOADING...
          </div>
        )}

        {phoneList ? <div className="home-phone-browse-list" role="group" aria-label={`Browse ${browseKind} choices`}>
          {browseOptions.slice(0, 12).map(node => <button type="button" key={node.id ?? node.name} disabled={isLoading || (!!node.noModel && !node.familyKey)}
            aria-label={`${node.isVehicle ? 'Open' : 'Browse'} ${node.listingTitle ?? node.name}`}
            onClick={() => { focusAfterDrill.current = true; drillInto(node); }}>
            {levelType === 'brands' ? <MakeIdentity make={node.name} /> : <Text role="body">{node.listingTitle ?? node.name}</Text>}
            <span className="home-phone-browse-count">{!node.isVehicle && <Text role="measure" dense>{node.count.toLocaleString('en-US')} sales</Text>}<span aria-hidden="true">→</span></span>
          </button>)}
          {browseOptions.length > 12 && <Text role="caption" as="p">12 of {browseOptions.length.toLocaleString('en-US')} shown · choose any {browseKind} above</Text>}
        </div> : <div
          style={{
            opacity: transitioning ? 0 : 1,
            transform: transitioning
              ? (zoomDir === 'in' ? 'scale(1.06)' : 'scale(0.94)')
              : 'scale(1)',
            transformOrigin: clickOrigin
              ? `${clickOrigin.x}px ${clickOrigin.y}px`
              : 'center center',
            transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            width: '100%',
            height: '100%',
            position: 'relative',
          }}
        >
          {levelType === 'brands' && brandView === 'nested' && dims.w > 0 ? (
            <BrandFamilyMap width={dims.w} height={dims.h} baseline={baseline} basis={basis}
              familyMoves={horizon === '1y' && !isCustomBase ? undefined : moversData?.family_moves}
              gateMin={gateMin}
              houses={houses}
              windowLabel={horizonWindowLabel}
              horizonShortLabel={horizon === '1y' && !isCustomBase ? '12 mo' : horizonMeta.label}
              onPickBrand={(brand, focusAfterPick) => { focusAfterDrill.current = !!focusAfterPick; recordInterest('make', brand); setDrillStack([{ label: 'ALL MAKES' }, { label: brand, make: brand }]); }}
              onPickFamily={(brand, key, family, focusAfterPick) => { focusAfterDrill.current = !!focusAfterPick; recordInterest('make', brand); setDrillStack([{ label: 'ALL MAKES' }, { label: brand, make: brand }, { label: family, make: brand, family: key }]); }} />
          ) : !truckMode && levelType === 'models' && currentLevel.family && currentLevel.make && familyView === 'sales' && dims.w > 0 ? (
            <FamilySalesChart brand={currentLevel.make} familyKey={currentLevel.family} family={currentLevel.label}
              width={dims.w} height={dims.h} onOpen={(id) => navigate(`/vehicle/${id}`)}
              selectedEra={selectedEra} onSelectEra={setSelectedEra}
              facetAxis={facetAxis}
              familyModels={familyModelsData}
              onSelectFacet={truckMode ? undefined : (nextFacet) => {
                const famEntry = drillStack.find((d) => d.family && !d.model) ?? {
                  label: searchParams.get('family_name') || currentLevel.label,
                  make: currentLevel.make,
                  family: currentLevel.family,
                };
                if (!nextFacet) {
                  setDrillStack([{ label: 'ALL MAKES' }, { label: currentLevel.make!, make: currentLevel.make }, famEntry]);
                } else {
                  setDrillStack([
                    { label: 'ALL MAKES' },
                    { label: currentLevel.make!, make: currentLevel.make },
                    famEntry,
                    { label: nextFacet, make: currentLevel.make, family: currentLevel.family, model: nextFacet },
                  ]);
                }
              }} />
          ) : rects.map((rect, i) => {
            if ((levelType === 'brands' || levelType === 'families') && rect.node.usd != null && !rect.node.isVehicle) {
              const node = rect.node;
              return (
                <div key={node.name + '-' + i}
                  onFocus={(e) => {
                    const bounds = e.target.getBoundingClientRect();
                    setTooltip({ node, x: bounds.left, y: bounds.bottom, totalCount, level: levelType });
                    handleCellMouseEnter(node);
                  }}
                  onBlur={() => { setTooltip(null); handleCellMouseLeave(); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setTooltip(null); } }}
                  onMouseMove={(e) => { if (!coarse) setTooltip({ node, x: e.clientX, y: e.clientY, totalCount, level: levelType }); }}
                  onMouseEnter={() => handleCellMouseEnter(node)}
                  onMouseLeave={() => { setTooltip(null); handleCellMouseLeave(); }}>
                  <MarketTile node={node} move={relativeMove(node, baseline, basis === 'ledger', gateMin, houses)} basis={basis} x={rect.x} y={rect.y} w={rect.w} h={rect.h}
                    describedBy={tooltip?.node === node ? tooltipId : undefined}
                    onClick={(ev) => {
                      if (coarse) { setTooltip(null); setSheet(node); return; }
                      focusAfterDrill.current = ev.detail === 0 && (!node.noModel || !!node.familyKey);
                      drillInto(node, 'clientX' in ev && ev.detail > 0 ? ev : undefined);
                    }} />
                </div>
              );
            }
            const repImgCandidates = !rect.node.isVehicle
              ? repImages.get(rect.node.name.toLowerCase()) || repImages.get(rect.node.name) || repImages.get(rect.node.name.toLowerCase().split(/\s+/)[0])
              : rect.node.imageUrl ? undefined
              : rect.node.id ? repImages.get(rect.node.id) : undefined;
            return (
              <div
                key={(rect.node.id || rect.node.name) + '-' + i}
                onMouseMove={(e) => {
                  setTooltip({
                    node: rect.node,
                    x: e.clientX,
                    y: e.clientY,
                    totalCount,
                    level: levelType,
                  });
                }}
                onMouseEnter={() => handleCellMouseEnter(rect.node)}
                onMouseLeave={() => { setTooltip(null); handleCellMouseLeave(); }}
              >
                <TreemapCell
                  rect={rect}
                  onClick={(ev?: any) => drillInto(rect.node, ev)}
                  totalCount={totalCount}
                  repImage={repImgCandidates?.[0]}
                  repImages={repImgCandidates}
                  facetAxis={levelType === 'models' ? facetAxis : undefined}
                />
              </div>
            );
          })}
        </div>}

        {/* Empty state */}
        {!isLoading && activeData && activeData.length === 0 && (
          <div className="home-empty-state">
            <div className="home-empty-state-label">
              NO DATA
            </div>
            <button
              onClick={() => goBack(drillStack.length - 2)}
              className="home-empty-state-back"
            >
              GO BACK
            </button>
          </div>
        )}
      </div>

      <h2 ref={mapExit} id="market-map-exit" tabIndex={-1} className="market-map-exit">Market comparisons and legend</h2>

      {/* ─── TOOLTIP ─── */}
      {tooltip && (tooltip.level === 'brands' || tooltip.level === 'families') && tooltip.node.usd != null && !tooltip.node.isVehicle
        ? <MarketCard id={tooltipId} node={tooltip.node} move={relativeMove(tooltip.node, baseline, basis === 'ledger', gateMin, houses)} base={baseline} x={tooltip.x} y={tooltip.y} windowLabel={horizonWindowLabel} gateMin={gateMin} />
        : tooltip && <TreemapTooltip {...tooltip} />}
      {sheet && <MarketSheet node={sheet} move={relativeMove(sheet, baseline, basis === 'ledger', gateMin, houses)} base={baseline} windowLabel={horizonWindowLabel} gateMin={gateMin}
        onOpen={() => { const n = sheet; focusAfterDrill.current = !n.noModel || !!n.familyKey; setSheet(null); drillInto(n); }} onClose={() => setSheet(null)} />}

      {embedded && (!truckMode || truckRead.data) && (levelType === 'models' || levelType === 'years' || levelType === 'vehicles') && currentLevel.family && currentLevel.make && !(levelType === 'models' && familyView === 'sales') && dims.w > 0 && <details className="home-family-history" open={!isNarrow}>
        <summary><Text role="label">Sales history and prices</Text></summary>
      {/* ─── FAMILY SALES CHART: when embedded on the Market page, keep the family's sales & like-for-like price index + era filter bar visible across models, years & vehicles inside the family ─── */}

        <div
          data-testid="embedded-family-sales-chart"
          className="home-embedded-family-chart"
        >
          <FamilySalesChart
            brand={currentLevel.make}
            familyKey={currentLevel.family}
            family={drillStack.find((d) => d.family && !d.model)?.label || searchParams.get('family_name') || currentLevel.label}
            width={dims.w}
            height={420}
            onOpen={(id) => navigate(`/vehicle/${id}`)}
            memberIds={truckMode ? truckMemberIds : undefined}
            selectedEra={truckMode ? null : selectedEra}
            onSelectEra={truckMode ? undefined : setSelectedEra}
            selectedModel={truckMode ? null :
              facetAxis !== 'raw' && currentLevel.model
                ? drillStack.find((d) => d.model && !d.year)?.label ?? currentLevel.model
                : currentLevel.model ?? null
            }
            selectedYear={truckMode ? null : currentLevel.year ?? null}
            facetAxis={truckMode ? null : facetAxis}
            familyModels={truckMode ? null : familyModelsData}
            onSelectFacet={truckMode ? undefined : (nextFacet) => {
              const famEntry = drillStack.find((d) => d.family && !d.model) ?? {
                label: searchParams.get('family_name') || currentLevel.label,
                make: currentLevel.make,
                family: currentLevel.family,
              };
              if (!nextFacet) {
                setDrillStack([{ label: 'ALL MAKES' }, { label: currentLevel.make!, make: currentLevel.make }, famEntry]);
              } else {
                setDrillStack([
                  { label: 'ALL MAKES' },
                  { label: currentLevel.make!, make: currentLevel.make },
                  famEntry,
                  { label: nextFacet, make: currentLevel.make, family: currentLevel.family, model: nextFacet },
                ]);
              }
            }}
          />
        </div>

      </details>}

      {/* ─── WHAT MOVED: the families whose BaT market moved most, a pick drills the map to the family ─── */}
      {levelType === 'brands' && <details className="home-family-comparisons" open={!isNarrow}>
        <summary><Text role="label">Compare sales activity</Text></summary>
        <FamilyMovers
        horizon={requestedHorizon}
        onHorizonChange={setHorizon}
        baselineHorizon={requestedBaseline}
        onBaselineHorizonChange={setBaselineHorizon}
        onPick={(m) => {
          recordInterest('make', m.brand);
          setDrillStack([{ label: 'ALL MAKES' }, { label: m.brand, make: m.brand }, { label: m.family, make: m.brand, family: m.family_key }], undefined,
            horizon === 'upcoming' ? 'names' : 'sales');
          // Open the family sales history for investigation. It retains its own
          // labelled multi-venue scope; upcoming supply keeps the family browse.
          if (horizon !== 'upcoming') {
            setFamilyViewState('sales');
            setPhoneBrowseView('map');
          }
        }} />
      </details>}

      {/* ─── FOOTER ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 28,
          padding: '4px 16px',
          borderTop: '2px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
          gap: 12,
        }}
      >
        {phoneList ? <Text role="caption">Confirmed sales · {currentLevel.make ? drillStack.slice(1).map(level => level.label).join(' / ') : 'All makes'}</Text> : truckMode ? <Text role="caption">Box size = recorded sale dollars, all years · color = average recorded sale price · unknown attributes remain in the map · configuration groups use current records, not sale-time configuration</Text> : (levelType === 'brands' || levelType === 'families')
          && !!activeData?.length && activeData.filter((node) => node.count > 0).every((node) => node.usd != null && node.usd > 0)
          ? <MapLegend base={baseline} basis={basis} clock={ledgerViewsClock(refresh.refreshedAt)} windowLabel={horizonWindowLabel} houses={houses} />
          : <Text role="caption">
          {/* One area and color basis per level (#1342): market measures only when every tile on the map carries dollars. */}
          {legendFor(levelType, levelType === 'models' && !!currentLevel.family && !!currentLevel.make && familyView === 'sales',
            !!activeData?.length && activeData.filter((node) => node.count > 0).every((node) => node.usd != null && node.usd > 0))}
        </Text>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onBrowse}
            style={{
              padding: '4px 20px',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontFamily: 'Arial, sans-serif',
              border: '2px solid var(--text)',
              background: 'var(--text)',
              color: 'var(--bg)',
              cursor: 'pointer',
            }}
          >
            {embedded ? 'SOURCES ↓' : 'BROWSE ALL'}
          </button>
          {!embedded && <a
            href="https://nuke.ag"
            style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-disabled)', textDecoration: 'none' }}
          >
            nuke.ag
          </a>}
        </div>
      </div>

      {/* ─── GLOBAL STYLES ─── */}
      <style>{`
        .home-map-refine, .home-family-history, .home-family-comparisons { display: contents; }
        .home-map-refine > summary, .home-family-history > summary, .home-family-comparisons > summary { display: none; }
        .home-phone-browse { display: grid; gap: 8px; padding: 12px; border-bottom: 2px solid var(--border); }
        .home-phone-browse-actions, .home-phone-display { display: flex; gap: 4px; align-items: center; justify-content: space-between; }
        .home-phone-display { margin-left: auto; }
        .home-phone-browse button, .home-phone-browse select, .home-phone-browse-list > button { min-height: 44px !important; border: 2px solid var(--border); background: var(--bg); color: var(--text); padding: 8px 12px; cursor: pointer; }
        .home-phone-display button[aria-pressed="true"] { background: var(--text); color: var(--bg); }
        .home-phone-browse-picker { display: grid; gap: 6px; }
        .home-phone-browse-picker select { min-width: 0; width: 100%; }
        .home-phone-browse-list { display: grid; gap: 2px; padding: 8px 12px; }
        .home-phone-browse-list > button { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; text-align: left; }
        .home-phone-browse-list > button:disabled { cursor: default; color: var(--text-disabled); }
        .home-phone-browse-count { display: inline-flex; align-items: center; gap: 12px; flex-shrink: 0; }
        .home-phone-browse button, .home-phone-browse-list > button, .home-map-refine > summary, .home-family-history > summary, .home-family-comparisons > summary { position: relative; }
        .home-phone-browse button:focus-visible::after, .home-phone-browse-list > button:focus-visible::after, .home-map-refine > summary:focus-visible::after, .home-family-history > summary:focus-visible::after, .home-family-comparisons > summary:focus-visible::after { content: ''; position: absolute; inset: 2px; border: 2px solid var(--text); pointer-events: none; }
        .home-phone-display button[aria-pressed="true"]:focus-visible::after { border-color: var(--bg); }
        .home-phone-browse select:focus-visible { border-color: var(--text); }
        @media (max-width: 640px) {
          .home-map-refine, .home-family-history, .home-family-comparisons { display: block; border-bottom: 2px solid var(--border); }
          .home-map-refine > summary, .home-family-history > summary, .home-family-comparisons > summary { display: list-item; min-height: 44px; padding: 15px 12px; cursor: pointer; }
          .home-map-crumb { min-height: 44px; }
        }
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .home-embedded-family-chart {
          position: relative;
          height: 420px;
          border-top: 2px solid var(--border);
          background: var(--bg);
          overflow: hidden;
        }
        .home-family-submodels {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 16px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
          overflow-x: auto;
          flex-shrink: 0;
        }
        .home-family-submodels-label {
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--text-disabled);
          font-family: Arial, sans-serif;
          white-space: nowrap;
          margin-right: 2px;
        }
        .home-family-submodel-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 600;
          font-family: Arial, sans-serif;
          color: var(--text-secondary);
          background: transparent;
          border: 1px solid var(--border);
          cursor: pointer;
          white-space: nowrap;
        }
        .home-family-submodel-pill:hover {
          color: var(--text);
          border-color: var(--text-secondary);
        }
        .home-family-submodel-pill--active {
          color: var(--bg);
          background: var(--text);
          border-color: var(--text);
        }
        .home-family-submodel-pill--active:hover {
          color: var(--bg);
          border-color: var(--text);
        }
        .home-family-submodel-count {
          font-size: 9px;
          font-family: 'Courier New', monospace;
          opacity: 0.72;
        }
        .home-family-submodel-pill--dashed {
          border-style: dashed;
          margin-right: 4px;
        }
        .home-era-marks-bar {
          gap: 8px;
          padding-top: 4px;
          padding-bottom: 4px;
        }
        .home-era-mark-pill {
          gap: 6px;
          padding: 2px 8px 2px 4px;
        }
        .home-era-mark-svg {
          display: inline-flex;
          align-items: center;
          height: 18px;
          min-width: 42px;
        }
        .home-facet-axis-tablist {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          margin-right: 4px;
        }
        .home-facet-axis-tab {
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 0.10em;
          padding: 2px 5px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          font-family: Arial, sans-serif;
        }
        .home-facet-axis-tab--active {
          background: var(--text);
          color: var(--bg);
        }
        .treemap-cell-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          flex-wrap: wrap;
        }
        .treemap-cell-facet-share {
          display: inline-flex;
          align-items: center;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.05em;
          font-family: 'Courier New', monospace;
          padding: 1px 4px;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          background: var(--bg);
          white-space: nowrap;
        }
        .treemap-cell-facet-share--dark {
          color: var(--bg);
          background: var(--text);
          border-color: var(--text);
        }
        .home-empty-state {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          gap: 8px;
        }
        .home-empty-state-label {
          font-size: 11px;
          color: var(--text-disabled);
          font-family: 'Courier New', monospace;
        }
        .home-empty-state-back {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          border: 2px solid var(--border);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 6px 16px;
          font-family: Arial, sans-serif;
        }
      `}</style>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// TABS (garage, feed, map) — kept from original
// ────────────────────────────────────────────────────────────

const FeedPage = lazy(() => import('../feed/components/FeedPage'));
const MarketPulse = lazy(() => import('./market/MarketInventory'));
const SourcesBoard = lazy(() => import('./market/SourcesBoard'));
const GarageTab = lazy(() => import('../components/garage/GarageTab'));

type TabId = 'market' | 'garage' | 'feed';

const TABS: { id: TabId; label: string }[] = [
  { id: 'market', label: 'Market' },
  { id: 'feed', label: 'Feed' },
  { id: 'garage', label: 'Garage' },
];

function TabSkeleton() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'Arial, sans-serif' }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ height: 80, background: 'var(--surface)', border: '2px solid var(--border)' }} />
      ))}
    </div>
  );
}

export default function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  // The URL is the shared source of truth for header links, mobile links and
  // browser back/forward. A saved tab must not replace the market on arrival.
  const requestedTab = searchParams.get('tab');
  const activeTab: TabId = TABS.find(tab => tab.id === requestedTab)?.id || 'market';

  const garage = useVehiclesDashboard(user?.id);
  // The refresh receipt, for the Sources board's sales-by-house hover (one read per page lifetime, shared with the map).
  const [sourcesRefresh, setSourcesRefresh] = useState<MapRefresh>(NO_REFRESH);
  useEffect(() => { let live = true; readTreemapRefresh().then((v) => { if (live) setSourcesRefresh(v); }); return () => { live = false; }; }, []);

  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!authLoading && user && !localStorage.getItem('nuke_onboarding_seen')) {
      setShowOnboarding(true);
    }
  }, [authLoading, user]);

  const handleOnboardingClose = () => {
    setShowOnboarding(false);
    localStorage.setItem('nuke_onboarding_seen', '1');
  };

  // Preserve the existing explicit treemap entry and its filtered feed drill.
  if (!authLoading && searchParams.get('force_treemap') === '1') {
    return <TreemapHomePage onBrowse={() => {
      const next = new URLSearchParams(searchParams);
      next.delete('force_treemap');
      next.set('tab', 'feed');
      setSearchParams(next);
    }} />;
  }

  if (authLoading) return <TabSkeleton />;

  return (
    <div>
      {showOnboarding && (
        <OnboardingSlideshow isOpen={showOnboarding} onClose={handleOnboardingClose} />
      )}
      <nav className="home-mobile-nav" aria-label="Browse">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            to={`/?tab=${tab.id}`}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={`header-nav-link${activeTab === tab.id ? ' active' : ''}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <Suspense fallback={<TabSkeleton />}>
        {activeTab === 'market' && <>
          <TreemapHomePage embedded onBrowse={() => (document.querySelector('.market-sources') ?? document.querySelector('.market-explorer'))
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          {/* Every source with the same row, ranked by the lots we hold (owner, 2026-10-15: "treat all sources the same") */}
          <SourcesBoard scope={{
            make: searchParams.get('make'),
            family: searchParams.get('family'),
            familyName: searchParams.get('family_name'),
            model: searchParams.get('model') ?? searchParams.get('facet'),
          }} houseMix={sourcesRefresh.populations?.by_house ? { rows: sourcesRefresh.populations.by_house, clock: ledgerViewsClock(sourcesRefresh.refreshedAt) } : null} />
          <MarketPulse onUnavailable={user ? <FeedPage /> : <IntakePage variant="homepage" />} />
        </>}
        {activeTab === 'garage' && <GarageTab dashboard={garage} />}
        {activeTab === 'feed' && <FeedPage />}
      </Suspense>
    </div>
  );
}
