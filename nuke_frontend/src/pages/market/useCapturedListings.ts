import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export const LISTING_SOURCES = ['craigslist', 'facebook_marketplace', 'ksl', 'bat', 'cars_and_bids', 'mecum', 'barrettjackson'] as const;
export const CLASSIFIED_SOURCES = ['craigslist', 'facebook_marketplace', 'ksl'];
const PAGE_SIZE = 50;
type Cursor = { at: string | null; id: string };
export type CapturedListing = {
  id: string; vehicle_id: string | null; source_platform: string; source_listing_id: string | null;
  source_url: string | null; current_price: number | null; event_status: string | null;
  created_at: string | null; updated_at: string | null;
  vehicle: { id: string; year: number | null; make: string | null; model: string | null; primary_image_url?: string | null } | null;
};
const SOURCE_HOSTS: Record<string, string> = {
  craigslist: 'craigslist.org', facebook_marketplace: 'facebook.com', ksl: 'ksl.com',
  bat: 'bringatrailer.com', cars_and_bids: 'carsandbids.com', mecum: 'mecum.com', barrettjackson: 'barrett-jackson.com',
};
export function sourceLink(platform: string, value: string | null): string | null {
  try {
    const url = new URL(value ?? ''), host = SOURCE_HOSTS[platform];
    if (!host || !['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      !(url.hostname === host || url.hostname.endsWith('.' + host))) return null;
    if (platform === 'facebook_marketplace' && !/^\/marketplace\/item\/\d+\/?$/.test(url.pathname)) return null;
    if (platform === 'craigslist' && !(/^\/view\/d\/.+\/[a-zA-Z0-9]+$/.test(url.pathname) || /\/\d+\.html$/.test(url.pathname))) return null;
    if (url.pathname === '/') return null;
    return url.href;
  } catch { return null; }
}

// Listing grain survives null asset identity. Never read private capture tables or
// reinterpret an inaccessible linked parent as an originally unresolved listing.
export async function readCapturedListings(source = 'classifieds', cursor?: Cursor, signal?: AbortSignal) {
  if (source && source !== 'classifieds' && !LISTING_SOURCES.includes(source as typeof LISTING_SOURCES[number])) throw new Error('Unknown source');
  const started = performance.now();
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  let query = supabase.from('vehicle_events')
    .select('id,vehicle_id,source_platform,source_listing_id,source_url,current_price,event_status,created_at,updated_at')
    .in('source_platform', source === 'classifieds' ? CLASSIFIED_SOURCES : source ? [source] : [...LISTING_SOURCES])
    .order('created_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(PAGE_SIZE + 1).abortSignal(requestSignal);
  if (cursor) {
    if (cursor.at !== null && !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.at) || !/^[a-f0-9-]{36}$/i.test(cursor.id)) throw new Error('Invalid cursor');
    query = cursor.at === null ? query.is('created_at', null).lt('id', cursor.id)
      : query.or(`created_at.lt.${cursor.at},created_at.is.null,and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const eventsRead = performance.now();
  const rows = (data ?? []).slice(0, PAGE_SIZE) as Omit<CapturedListing, 'vehicle'>[];
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
      .map(row => ({ ...row, vehicle: row.vehicle_id ? parents.get(row.vehicle_id)! : null })),
    next: data && data.length > PAGE_SIZE && last ? { at: last.created_at, id: last.id } : undefined,
  };
}

export function useCapturedListings(source: string) {
  return useInfiniteQuery({
    queryKey: ['market-captured-listings', source], queryFn: ({ pageParam, signal }) => readCapturedListings(source, pageParam, signal),
    initialPageParam: undefined as Cursor | undefined, getNextPageParam: page => page.next,
    staleTime: 60_000, retry: 1,
  });
}
