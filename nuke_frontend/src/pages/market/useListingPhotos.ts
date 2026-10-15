import { useQueries } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// Every photo a listing's capture landed, for the classifieds cards. The board's reader carries one image per row; the
// rest are the vehicle's vehicle_images rows, read once per page of rows (one request for 60 listings: 616 photos,
// 85 KB, 0.55 s cold and 0.17 s warm as a logged-out reader on 2026-10-15). On that date the three newest Craigslist
// cards held every photo their listing pages showed (21 of 21, 7 of 7, 3 of 3) and showed one.
// Capture order is not kept (position is 0 on every row), so the board's image leads and the rest follow in a stable order.
export type ListingPhoto = { vehicle_id: string; image_url: string | null };

export async function readListingPhotos(vehicleIds: string[], signal?: AbortSignal): Promise<ListingPhoto[]> {
  if (!vehicleIds.length) return [];
  let request = supabase.from('vehicle_images').select('vehicle_id,image_url').in('vehicle_id', vehicleIds)
    .order('vehicle_id').order('position', { ascending: true, nullsFirst: false }).order('id').limit(3000);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []) as ListingPhoto[];
}

// The board's image first, then every other photo of the vehicle once; only web addresses a browser may load.
export function photoList(lead: string | null | undefined, rows: readonly ListingPhoto[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [lead, ...(rows ?? []).map(r => r.image_url)]) {
    let href: string | null = null;
    try { const url = new URL(value ?? ''); href = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch { href = null; }
    if (href && !seen.has(href)) { seen.add(href); out.push(href); }
  }
  return out;
}

// One read per page of board rows, so loading more never reads the earlier pages again. The pages fold into one map
// by vehicle; the fold is stable, so the map changes only when a read lands.
function byVehicle(results: { data?: ListingPhoto[] }[]): Map<string, ListingPhoto[]> {
  const map = new Map<string, ListingPhoto[]>();
  for (const result of results) for (const row of result.data ?? []) {
    const list = map.get(row.vehicle_id);
    if (list) list.push(row); else map.set(row.vehicle_id, [row]);
  }
  return map;
}
export function useListingPhotos(pages: readonly (readonly string[])[]): Map<string, ListingPhoto[]> {
  return useQueries({
    queries: pages.map(ids => ({
      queryKey: ['listing-photos', ids],
      queryFn: ({ signal }: { signal: AbortSignal }) => readListingPhotos([...ids], signal),
      enabled: ids.length > 0,
      staleTime: 10 * 60_000,
    })),
    combine: byVehicle,
  });
}
