import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';
import { useVehiclesDashboard } from '../hooks/useVehiclesDashboard';
import { OnboardingSlideshow } from '../components/onboarding/OnboardingSlideshow';
import { useInterests } from '../hooks/useInterests';
import { optimizeImageUrl } from '../lib/imageOptimizer';
import { squarify } from '../lib/squarify';
import IntakePage from './intake/IntakePage';
import { Text } from '../kit';
import FamilyMovers from './market/FamilyMovers';
import BrandFamilyMap, { MapViewSwitch } from './market/BrandFamilyMap';
import FamilySalesChart, { FamilyViewSwitch } from './market/FamilySalesChart';

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

interface TreemapNode {
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
}

interface TreemapRect {
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
export interface MapPopulations { measure?: string; public_records?: number; mapped_sales?: number }
export interface MapRefresh { refreshedAt: string | null; populations: MapPopulations | null }
const NO_REFRESH: MapRefresh = { refreshedAt: null, populations: null };
let refreshRead: Promise<MapRefresh> | null = null;
function readTreemapRefresh(): Promise<MapRefresh> {
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
  return `${count}${receipt ? ` of ${fmt(p!.public_records!)} public records` : ''}${clause}${ledgerViewsClock(refresh.refreshedAt, now)}`;
}

/** The caption on a phone, where the full sentence does not fit: the count alone, the population still on the title. */
export function mapCaptionShort(level: MapLevel, levelCount: number, refresh: MapRefresh): string {
  const p = refresh.populations;
  const n = level === 'brands' && p?.measure === 'confirmed_sale_v1' && Number.isFinite(p.mapped_sales) ? p.mapped_sales! : levelCount;
  return `${n.toLocaleString('en-US')} ${level === 'vehicles' ? 'shown' : 'sold'}`;
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
  if (level === 'vehicles') return 'area = confirmed sale price · click to open the record';
  if (measured) return `area = dollars from confirmed sales · of offered sold = share of cars offered at auction that sold · BaT 12 mo = sales and dollars on Bring a Trailer in the last 12 months against the 12 before, the venue held in full both years; color follows those sales (gray: BaT holds under half the sales, or too few a year earlier) · nominal${level === 'families' ? ' · other models = names not yet keyed to a family, and families with under 3 sales' : ''} · click to go down`;
  return 'area = vehicles with a confirmed sale · color = their median sale price (gray: under 5 sales) · nominal, all years · asks, bids and unknown outcomes are not counted · click to go down';
}

/** The legend under the map: the sales chart's when a family shows its chart (the tiles' legend described tiles that
 *  were not on screen, 2026-10-15), the level's otherwise. */
export const SALES_CHART_LEGEND = 'one dot = one confirmed sale with a date, the last five years · price on a log scale · '
  + 'color = venue · line = the median of the sales within 60 days either side, every 14 days · BaT median = Bring a '
  + 'Trailer\'s last 12 months against the 12 before · nominal · click a dot to open its record';
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
    supabase.rpc('treemap_models_by_brand', { p_make: make }).then(({ data: result, error }) => {
      if (!cancelled && result && !error) {
        setData(result as TreemapNode[]);
      }
      if (!cancelled) setLoading(false);
    });
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
    Promise.resolve(supabase.rpc('treemap_brand_families', { p_brand: make })).then(({ data: result, error }) => {
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
    Promise.resolve(supabase.rpc('treemap_family_models', { p_brand: make, p_family_key: familyKey })).then(({ data: result, error }) => {
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
    supabase.rpc('treemap_years', { p_source: null, p_make: make, p_model: model }).then(({ data: result, error }) => {
      if (!cancelled && result && !error) {
        setData(result as TreemapNode[]);
      }
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [make, model]);
  return { data, loading };
}

// The leaf: the cell's confirmed sales (treemap_sales), each with the sold amount its parent cell counted.
function readTreemapSales(make: string, model: string, year?: number | null): Promise<TreemapNode[] | null> {
  return Promise.resolve(supabase.rpc('treemap_sales', { p_make: make, p_model: model, p_year: year ?? null })).then(
    ({ data: result, error }: { data: any[] | null; error: unknown }) => (error || !result ? null : result.map((v: any) => ({
      name: [v.year, v.make, v.model].filter(Boolean).join(' '),
      count: 1,
      value: v.sold_amount || 0,
      median_price: v.sold_amount,
      imageUrl: v.primary_image_url || undefined,
      id: v.id,
      isVehicle: true,
      listingTitle: v.listing_title || undefined,
      mileage: v.mileage || undefined,
    }))),
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

function useRepresentativeImages(items: TreemapNode[] | null, make?: string | null) {
  const [images, setImages] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!items || !make || items.length === 0) { setImages(new Map()); return; }
    let cancelled = false;
    // The brand's priciest sold cars with a photo, read along the (make, sale_price) index of priced sales. The earlier
    // shape (make ILIKE, sale_price OR sold_price) walked every vehicle by price and timed out on every brand drill
    // (HTTP 500 for Ford and Porsche, 2026-10-15), so no tile ever had its image; this one reads 200 rows of the brand.
    supabase
      .from('vehicles')
      .select('model, year, primary_image_url')
      .eq('make', make)
      .gt('sale_price', 0)
      .not('primary_image_url', 'is', null)
      .is('deleted_at', null)
      .order('sale_price', { ascending: false })
      .limit(200)
      .then(({ data: result, error }) => {
        if (cancelled || !result || error) return;
        const map = new Map<string, string>();
        for (const row of result as any[]) {
          // Key by model name, by its first word (a family tile is "911", its sales "911 Carrera") and by year.
          const modelKey = String(row.model || '').toLowerCase();
          const familyKey = modelKey.split(/\s+/)[0];
          const yearKey = String(row.year || '');
          if (!row.primary_image_url) continue;
          for (const key of [modelKey, familyKey, yearKey]) if (key && !map.has(key)) map.set(key, row.primary_image_url);
        }
        setImages(map);
      });
    return () => { cancelled = true; };
  }, [items?.length, make]);
  return images;
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
    forms.push([...(d !== null ? [`BaT 12 mo: sales ${signedPct(m)}, $ ${signedPct(d)}`] : []),
      `BaT 12 mo: sales ${signedPct(m)}`, `12 mo ${signedPct(m)}`]);
  }
  return forms.map(f => f.find(line => lineChars(line) <= maxChars)).filter((line): line is string => line !== undefined);
}

/** Characters a tile line takes in the cell's monospace face; the arrows fall back to a wider face, so they count two. */
export const lineChars = (line: string) => line.length + (line.match(/[▲▼]/g)?.length ?? 0);
const fmtMoneyShort = (n: number) => n >= 1_000_000_000 ? `$${(n / 1_000_000_000).toFixed(1)}B`
  : n >= 1_000_000 ? `$${Math.round(n / 1_000_000)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${Math.round(n)}`;
const fmtCountShort = (n: number) => n >= 10_000 ? `${Math.round(n / 1_000)}K` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${n}`;

// ────────────────────────────────────────────────────────────
// TREEMAP CELL COMPONENT
// ────────────────────────────────────────────────────────────

interface CellProps {
  rect: TreemapRect;
  onClick: (e?: React.MouseEvent) => void;
  totalCount: number;
  showValue?: boolean;
  repImage?: string;
}

function TreemapCell({ rect, onClick, totalCount, showValue, repImage }: CellProps) {
  const { node, x, y, w, h } = rect;
  const [hovered, setHovered] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const pct = totalCount > 0 ? ((node.count / totalCount) * 100) : 0;
  const isBrandMarket = node.usd != null && !node.isVehicle;
  const bg = isBrandMarket ? momentumToColor(brandMomentum(node)) : priceToColor(node.median_price);
  const isVehicle = !!node.isVehicle;
  const hasImage = isVehicle ? !!node.imageUrl : !!repImage;
  const imageUrl = isVehicle ? node.imageUrl : repImage;
  const isLarge = w > 120 && h > 80;

  // Vehicle cells: show image as full background
  // Aggregate cells: show faded rep image on large cells only
  const showImage = hasImage && (isVehicle || isLarge);

  // Decide what text fits
  const canShowName = w > 28 && h > 16;
  const canShowCount = w > 40 && h > 30 && !isVehicle;
  const canShowPrice = w > 60 && (isVehicle ? h > 28 : h > 44);
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
  const marketLines = isBrandMarket && canShowCount
    ? brandLines(node, Math.floor((w - 12) / (dataFontSize * 0.6))).slice(0, Math.max(1, Math.floor((h - nameFontSize * 1.4 - 10) / lineHeightPx)))
    : [];

  return (
    <div
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
        )}

        <div style={{ marginTop: 'auto' }}>
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
          {canShowCount && !isBrandMarket && (
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
          {canShowPrice && node.median_price && !isBrandMarket && (
            <div
              style={{
                fontSize: isVehicle ? nameFontSize : dataFontSize,
                fontFamily: "'Courier New', monospace",
                fontWeight: 700,
                color: textColor,
                lineHeight: 1.3,
              }}
            >
              {fmtMoney(node.median_price)}{!isVehicle && ' med'}
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
          {canShowPct && pct >= 0.1 && !isBrandMarket && (
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
    return (
      <div style={containerStyle}>
        <Text role="label" as="div">{node.name}</Text>
        <div><Text role="measure">{fmtMoney(node.usd)}</Text> <Text role="caption">from {fmtNum(node.count)} confirmed sales</Text></div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {node.offered && node.sold_any != null ? <Row label={`of ${fmtNum(node.offered)} offered sold`} value={`${Math.round((100 * node.sold_any) / node.offered)}%`} /> : null}
          {node.sold_12m != null ? <Row label="sold on BaT, last 12 months" value={`${fmtNum(node.sold_12m)}${node.usd_12m ? ` · ${fmtMoney(node.usd_12m)}` : ''}`} /> : null}
          {node.sold_prior_12m != null ? <Row label="sold on BaT, the 12 before" value={`${fmtNum(node.sold_prior_12m)}${node.usd_prior_12m ? ` · ${fmtMoney(node.usd_prior_12m)}` : ''}`} /> : null}
          {m !== null ? <Row label="change, BaT sales" value={signedPct(m)} /> : null}
          {d !== null ? <Row label="change, BaT dollars" value={signedPct(d)} /> : null}
          {m === null && node.sold_12m != null ? <Row label="BaT 12-month change" value="too few BaT sales" /> : null}
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
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        {node.name}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Courier New', monospace", color: 'var(--text)', marginBottom: 6 }}>
        {fmtNum(node.count)} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-secondary)' }}>with a confirmed sale</span>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 10, color: 'var(--text-secondary)' }}>
      <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--text)', fontWeight: 600 }}>{value}</span>
      <span style={{ marginLeft: 12, textAlign: 'right', fontSize: 9 }}>{label}</span>
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
  usePageTitle(embedded ? 'Market' : 'Nuke — Vehicle Intelligence');
  const { recordInterest } = useInterests();

  // Drill-down state
  const [drillStack, setDrillStack] = useState<DrillLevel[]>([{ label: 'ALL MAKES' }]);
  const currentLevel = drillStack[drillStack.length - 1];

  // Narrow-viewport flag — hides decorative chrome when the header would crush.
  // Threshold matches AppHeader's 768px collapse but tighter (640px) since the
  // treemap header has its own logo+search+browse triple, not the AppHeader's grid.
  // matchMedia is absent in jsdom and some embedded webviews; without it the page is treated as wide.
  const canMatchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [isNarrow, setIsNarrow] = useState(() => canMatchMedia && window.matchMedia('(max-width: 640px)').matches);
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
  const { data: brandsData, loading: brandsLoading } = useTreemapBrands();
  const refresh = useTreemapRefresh();
  // A brand opens on its model families; when none can be read it opens on its model names, as before.
  const atFamilies = !!currentLevel.make && !currentLevel.family && !currentLevel.model;
  const { data: familiesData, loading: familiesLoading, failed: familiesFailed } = useTreemapFamilies(atFamilies ? currentLevel.make ?? null : null);
  const { data: modelsData, loading: modelsLoading } = useTreemapModels(atFamilies && familiesFailed ? currentLevel.make ?? null : null);
  const { data: familyModelsData, loading: familyModelsLoading } = useTreemapFamilyModels(
    currentLevel.family && !currentLevel.model ? currentLevel.make ?? null : null,
    currentLevel.family && !currentLevel.model ? currentLevel.family : null,
  );
  const { data: yearsData, loading: yearsLoading } = useTreemapYears(
    currentLevel.model && !currentLevel.year ? currentLevel.make ?? null : null,
    currentLevel.model && !currentLevel.year ? currentLevel.model ?? null : null
  );
  // Vehicle-level data: fetched when we have make+model and either a year or coming from years level
  const vehicleMake = currentLevel.year ? currentLevel.make ?? null : null;
  const vehicleModel = currentLevel.year ? currentLevel.model ?? null : null;
  const vehicleYear = currentLevel.year ?? null;
  const { data: vehiclesData, loading: vehiclesLoading } = useTreemapVehicles(vehicleMake, vehicleModel, vehicleYear);

  // The top level as brands, or as brands with their families inside (finviz's map of the market).
  const [brandView, setBrandView] = useState<'brands' | 'nested'>('brands');
  // A family opens on its sales chart; its model names as tiles are one switch away.
  const [familyView, setFamilyView] = useState<'sales' | 'names'>('sales');
  useEffect(() => { setFamilyView('sales'); }, [currentLevel.make, currentLevel.family]);

  // Determine active data and level type
  const levelType: MapLevel =
    currentLevel.year ? 'vehicles' :
    currentLevel.model ? 'years' :
    currentLevel.family ? 'models' :
    currentLevel.make ? 'families' : 'brands';

  const activeData = useMemo(() => {
    // Check prefetch cache before hook data — eliminates loading flash on drill-in
    if (levelType === 'vehicles' && currentLevel.make && currentLevel.model && currentLevel.year) {
      const cached = prefetchCache.current.get(`${currentLevel.make}/${currentLevel.model}/${currentLevel.year}`);
      if (cached) return cached;
    }
    if (levelType === 'years' && currentLevel.make && currentLevel.model) {
      const cached = prefetchCache.current.get(`${currentLevel.make}/${currentLevel.model}`);
      if (cached) return cached;
    }
    if (levelType === 'vehicles' && vehiclesData) return vehiclesData;
    if (levelType === 'years' && yearsData) return yearsData;
    if (levelType === 'models' && familyModelsData) return familyModelsData;
    if (levelType === 'families' && familiesData) return familiesData;
    if (levelType === 'families' && familiesFailed && modelsData) return modelsData;
    if (brandsData) return brandsData;
    return null;
    // drillStack triggers recompute when navigating so ref cache is checked
  }, [levelType, brandsData, familiesData, familiesFailed, modelsData, familyModelsData, yearsData, vehiclesData, currentLevel, drillStack]);

  const isLoading = brandsLoading || familiesLoading || modelsLoading || familyModelsLoading || yearsLoading || vehiclesLoading;

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
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      if (currentLevel.make && !node.noModel && (levelType === 'models' || (levelType === 'families' && !node.familyKey))) {
        prefetchYears(currentLevel.make, node.name);
      } else if (levelType === 'years' && currentLevel.make && currentLevel.model) {
        const year = parseInt(node.name, 10);
        if (Number.isFinite(year)) prefetchVehicles(currentLevel.make, currentLevel.model, year);
      }
    }, 200);
  }, [levelType, currentLevel, prefetchYears, prefetchVehicles]);

  const handleCellMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  // Representative images for aggregate cells (models/years levels); none while a family shows its sales chart, which
  // has no tiles to put them on (the read ran under the chart on every family drill).
  const repImages = useRepresentativeImages(
    levelType === 'models' ? (familyView === 'names' ? familyModelsData : null) : levelType === 'years' ? yearsData
      : levelType === 'families' && familiesFailed ? modelsData : null,
    currentLevel.make
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
  const rects = useMemo(() => {
    if (!activeData || dims.w < 10 || dims.h < 10) return [];
    const PAD = 2; // border space
    const items = activeData
      .filter(n => n.count > 0)
      .map(node => ({ node, area: node.usd && node.usd > 0 ? node.usd : node.count }));
    return squarify(items, PAD, PAD, dims.w - PAD * 2, dims.h - PAD * 2);
  }, [activeData, dims]);

  const totalCount = useMemo(
    () => (activeData || []).reduce((s, n) => s + n.count, 0),
    [activeData]
  );

  // Tooltip
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  // A drill or a view switch replaces the tiles under the pointer, and the tile a tooltip came from can no longer clear it:
  // over the sales chart the 911 tile's tooltip stayed on screen (2026-10-15).
  useEffect(() => { setTooltip(null); }, [drillStack, brandView, familyView]);

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
    if (levelType === 'brands') {
      recordInterest('make', node.name);
      setDrillStack(prev => [...prev, { label: node.name, make: node.name }]);
    } else if (levelType === 'families' && node.familyKey) {
      setDrillStack(prev => [...prev, { label: node.name, make: currentLevel.make, family: node.familyKey, names: node.models ?? undefined }]);
    } else if (levelType === 'families' || levelType === 'models') {
      // A family's model name, or the brand's own when families could not be read; a sale without a name stops here.
      if (node.noModel) return;
      recordInterest('model', node.name);
      setDrillStack(prev => [...prev, { label: node.name, make: currentLevel.make, family: currentLevel.family, model: node.name }]);
    } else if (levelType === 'years') {
      const year = parseInt(node.name, 10);
      if (Number.isFinite(year)) {
        setDrillStack(prev => [...prev, { label: String(year), make: currentLevel.make, family: currentLevel.family, model: currentLevel.model, year }]);
      }
    } else if (levelType === 'vehicles' && node.id) {
      navigate(`/vehicle/${node.id}`);
    }
  }, [levelType, currentLevel, navigate, recordInterest]);

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
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    else navigate('/search');
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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: embedded ? '72vh' : '100vh',
        minHeight: embedded ? 440 : undefined,
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'Arial, sans-serif',
        overflow: 'hidden',
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
          {activeData && (
            <Text role="caption" title={ledgerViewsStamp(refresh.refreshedAt)}>
              {isNarrow ? mapCaptionShort(levelType, totalCount, refresh)
                : mapCaption(levelType, totalCount, refresh, Date.now(), levelType === 'families' ? familyCoverage(activeData)
                  : levelType === 'models' ? familyNamesShown(activeData?.length ?? 0, currentLevel.names) : '')}
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
                if (currentLevel.model) params.set('model', currentLevel.model);
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
          {levelType === 'brands' && <MapViewSwitch label="Map view" value={brandView} onChange={setBrandView}
            options={[{ value: 'brands', label: 'Brands' }, { value: 'nested', label: 'Families inside' }]} />}
          {levelType === 'models' && currentLevel.family && <FamilyViewSwitch value={familyView} onChange={setFamilyView} />}
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-disabled)' }}>
            {levelType === 'brands' ? 'MAKES' : levelType === 'families' ? (familiesData ? 'FAMILIES' : 'MODELS') : levelType === 'models' ? 'MODELS' : levelType === 'years' ? 'YEARS' : 'VEHICLES'}
          </span>
        </div>
      </div>

      {/* ─── TREEMAP VIEWPORT ─── */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--bg)',
          minHeight: 0,
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

        <div
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
            <BrandFamilyMap width={dims.w} height={dims.h}
              onPickBrand={(brand) => { recordInterest('make', brand); setDrillStack([{ label: 'ALL MAKES' }, { label: brand, make: brand }]); }}
              onPickFamily={(brand, key, family) => { recordInterest('make', brand); setDrillStack([{ label: 'ALL MAKES' }, { label: brand, make: brand }, { label: family, make: brand, family: key }]); }} />
          ) : levelType === 'models' && currentLevel.family && currentLevel.make && familyView === 'sales' && dims.w > 0 ? (
            <FamilySalesChart brand={currentLevel.make} familyKey={currentLevel.family} family={currentLevel.label}
              width={dims.w} height={dims.h} onOpen={(id) => navigate(`/vehicle/${id}`)} />
          ) : rects.map((rect, i) => {
            const repImg = !rect.node.isVehicle
              ? repImages.get(rect.node.name.toLowerCase()) || repImages.get(rect.node.name)
              : undefined;
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
                  repImage={repImg}
                />
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {!isLoading && activeData && activeData.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-disabled)', fontFamily: "'Courier New', monospace" }}>
              NO DATA
            </div>
            <button
              onClick={() => goBack(drillStack.length - 2)}
              style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', border: '2px solid var(--border)',
                background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
                padding: '6px 16px', fontFamily: 'Arial, sans-serif',
              }}
            >
              GO BACK
            </button>
          </div>
        )}
      </div>

      {/* ─── TOOLTIP ─── */}
      {tooltip && <TreemapTooltip {...tooltip} />}

      {/* ─── WHAT MOVED: the families whose BaT market moved most, a pick drills the map to the family ─── */}
      {levelType === 'brands' && <FamilyMovers onPick={(m) => {
        recordInterest('make', m.brand);
        setDrillStack([{ label: 'ALL MAKES' }, { label: m.brand, make: m.brand }, { label: m.family, make: m.brand, family: m.family_key }]);
      }} />}

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
        <Text role="caption">
          {/* One area and color basis per level (#1342): market measures only when every tile on the map carries dollars. */}
          {legendFor(levelType, levelType === 'models' && !!currentLevel.family && !!currentLevel.make && familyView === 'sales',
            !!activeData?.length && activeData.filter((node) => node.count > 0).every((node) => node.usd != null && node.usd > 0))}
        </Text>
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
            {embedded ? 'BAT LIVE BOARD ↓' : 'BROWSE ALL'}
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
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
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
          <TreemapHomePage embedded onBrowse={() => document.querySelector('.market-explorer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          <MarketPulse onUnavailable={user ? <FeedPage /> : <IntakePage variant="homepage" />} />
        </>}
        {activeTab === 'garage' && <GarageTab dashboard={garage} />}
        {activeTab === 'feed' && <FeedPage />}
      </Suspense>
    </div>
  );
}
