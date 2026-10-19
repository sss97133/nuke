import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export const LISTING_SOURCES = ['craigslist', 'facebook_marketplace', 'ksl', 'bat', 'cars_and_bids', 'mecum', 'barrett_jackson',
  'barnfinds', 'bonhams', 'rm-sothebys', 'gooding', 'pcarmarket'] as const;
export const CLASSIFIED_SOURCES = ['craigslist', 'facebook_marketplace', 'ksl'];
const PLATFORM_ALIASES: Record<string, string[]> = { bat: ['bat', 'bring_a_trailer'], barrett_jackson: ['barrett_jackson', 'barrettjackson'], 'rm-sothebys': ['rm-sothebys', 'rmsothebys'] };
const SOURCE_NAMES: Record<string, string> = { craigslist: 'Craigslist', facebook_marketplace: 'Facebook Marketplace', ksl: 'KSL',
  bat: 'Bring a Trailer', bring_a_trailer: 'Bring a Trailer', cars_and_bids: 'Cars & Bids', mecum: 'Mecum',
  barrett_jackson: 'Barrett-Jackson', barrettjackson: 'Barrett-Jackson',
  barnfinds: 'Barn Finds', bonhams: 'Bonhams', 'rm-sothebys': 'RM Sotheby\'s', rmsothebys: 'RM Sotheby\'s', gooding: 'Gooding & Co', pcarmarket: 'PCarMarket' };
export const sourceName = (platform: string) => SOURCE_NAMES[platform] ?? platform;
const PAGE_SIZE = 50;
type Cursor = { at: string | null; id: string };
export type CapturedListing = {
  id: string; vehicle_id: string | null; source_platform: string; source_listing_id: string | null;
  source_url: string | null; current_price: number | null; event_status: string | null;
  created_at: string | null; updated_at: string | null;
  source_observed_at: string | null;
  vehicle: { id: string; year: number | null; make: string | null; model: string | null; primary_image_url?: string | null } | null;
};
function sourceClock(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return null;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59) return null;
  return value;
}
const SOURCE_HOSTS: Record<string, string> = {
  craigslist: 'craigslist.org', facebook_marketplace: 'facebook.com', ksl: 'ksl.com',
  bat: 'bringatrailer.com', bring_a_trailer: 'bringatrailer.com', cars_and_bids: 'carsandbids.com', mecum: 'mecum.com',
  barrettjackson: 'barrett-jackson.com', barrett_jackson: 'barrett-jackson.com',
};
// Listing paths from ingest/index.ts and the existing platform readers. A host
// alone cannot qualify an unresolved row (account/login/redirect paths are not listings).
const SOURCE_PATHS: Record<string, RegExp> = {
  craigslist: /^(?:\/view\/d\/[\w-]+\/[a-zA-Z0-9]+|\/\w+\/d\/[\w-]+\/\d+\.html)\/?$/,
  facebook_marketplace: /^\/marketplace\/item\/\d+\/?$/,
  ksl: /^\/listing\/\d+\/?$/,
  bat: /^\/listing\/[\w-]+\/?$/, bring_a_trailer: /^\/listing\/[\w-]+\/?$/,
  cars_and_bids: /^\/auctions\/[\w-]+(?:\/[\w-]+)?\/?$/,
  mecum: /^\/lots\/\d+\/[\w-]+\/?$/,
  barrettjackson: /^\/[\w-]+\/docket\/vehicle\/[\w-]+\/?$/,
  barrett_jackson: /^\/[\w-]+\/docket\/vehicle\/[\w-]+\/?$/,
};
export function sourceLink(platform: string, value: string | null): string | null {
  try {
    const url = new URL(value ?? ''), host = SOURCE_HOSTS[platform];
    if (!host || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash ||
      !(url.hostname === host || url.hostname.endsWith('.' + host))) return null;
    if (!SOURCE_PATHS[platform]?.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

// Listing grain survives null asset identity. Never read private capture tables or
// reinterpret an inaccessible linked parent as an originally unresolved listing.
export async function readCapturedListings(source = 'classifieds', cursor?: Cursor, signal?: AbortSignal) {
  if (source && source !== 'classifieds' && !LISTING_SOURCES.includes(source as typeof LISTING_SOURCES[number])) throw new Error('Unknown source');
  if (cursor && ((cursor.at !== null && !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.at)) || !/^[a-f0-9-]{36}$/i.test(cursor.id))) throw new Error('Invalid cursor');
  const started = performance.now();
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const eventQuery = () => supabase.from('vehicle_events')
    .select('id,vehicle_id,source_platform,source_listing_id,source_url,current_price,event_status,created_at,updated_at,source_observed_at:metadata->>source_observed_at')
    .in('source_platform', source === 'classifieds' ? CLASSIFIED_SOURCES : source ? PLATFORM_ALIASES[source] ?? [source] : LISTING_SOURCES.flatMap(value => PLATFORM_ALIASES[value] ?? [value]))
    .abortSignal(requestSignal);
  const data: Omit<CapturedListing, 'vehicle'>[] = [];
  // Read dated rows in the existing created_at DESC index order. Excluding nulls
  // makes NULLS FIRST equivalent here; append the undated tail only when needed.
  if (cursor?.at !== null) {
    let dated = eventQuery().not('created_at', 'is', null)
      .order('created_at', { ascending: false, nullsFirst: true }).order('id', { ascending: false }).limit(PAGE_SIZE + 1);
    if (cursor) dated = dated.lte('created_at', cursor.at)
      .or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const { data: rows, error } = await dated;
    if (error) throw error;
    data.push(...(rows ?? []) as Omit<CapturedListing, 'vehicle'>[]);
  }
  if (data.length <= PAGE_SIZE) {
    let undated = eventQuery().is('created_at', null).order('id', { ascending: false }).limit(PAGE_SIZE + 1 - data.length);
    if (cursor?.at === null) undated = undated.lt('id', cursor.id);
    const { data: rows, error } = await undated;
    if (error) throw error;
    data.push(...(rows ?? []) as Omit<CapturedListing, 'vehicle'>[]);
  }
  const eventsRead = performance.now();
  const rows = data.slice(0, PAGE_SIZE);
  const ids = [...new Set(rows.map(row => row.vehicle_id).filter((id): id is string => !!id))];
  const parents = new Map<string, CapturedListing['vehicle']>();
  if (ids.length) {
    const { data: vehicles, error: parentError } = await supabase.from('vehicles')
      .select('id,year,make,model,primary_image_url').in('id', ids).eq('is_public', true).is('deleted_at', null)
      .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item').limit(PAGE_SIZE).abortSignal(requestSignal);
    if (parentError) throw parentError;
    for (const vehicle of vehicles ?? []) parents.set(vehicle.id, vehicle);
  }
  const last = rows.at(-1);
  return {
    timings: { eventsMs: Math.round(eventsRead - started), parentsMs: Math.round(performance.now() - eventsRead) },
    items: rows.filter(row => row.vehicle_id ? parents.has(row.vehicle_id) : !!sourceLink(row.source_platform, row.source_url))
      .map(row => ({ ...row, source_observed_at: sourceClock(row.source_observed_at), vehicle: row.vehicle_id ? parents.get(row.vehicle_id)! : null })),
    next: data.length > PAGE_SIZE && last ? { at: last.created_at, id: last.id } : undefined,
  };
}

export function useCapturedListings(source: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['market-captured-listings', source], queryFn: ({ pageParam, signal }) => readCapturedListings(source, pageParam, signal),
    initialPageParam: undefined as Cursor | undefined, getNextPageParam: page => page.next,
    staleTime: 60_000, retry: 1, enabled,
  });
}
