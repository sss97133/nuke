import { supabase } from './supabase';

const PAGE_SIZE = 500;

interface FetchVehicleImagesOptions {
  includeMismatchFilter?: boolean;
}

// In-flight dedupe keyed on query shape. The identical full-set vehicle_images
// query (select ... order by position) was observed firing 2-4x per page load
// (StrictMode double-mount + gallery/profile both resolving images). Concurrent
// callers share one promise; entries clear on settle — coalescing, not caching.
const inflightFetches = new Map<string, Promise<any[]>>();

/**
 * Fetch all matching vehicle images even when a vehicle exceeds the REST row cap.
 * Identical concurrent calls (same vehicle + select + options) share one request.
 */
export async function fetchVehicleImages<T = any>(
  vehicleId: string,
  selectClause: string,
  options: FetchVehicleImagesOptions = {},
): Promise<T[]> {
  if (!vehicleId) return [];

  const key = `${vehicleId}|${selectClause}|${options.includeMismatchFilter ? 1 : 0}`;
  const existing = inflightFetches.get(key);
  if (existing) return existing as Promise<T[]>;

  const pending = fetchVehicleImagesUncached<T>(vehicleId, selectClause, options)
    .finally(() => inflightFetches.delete(key));
  inflightFetches.set(key, pending as Promise<any[]>);
  return pending;
}

async function fetchVehicleImagesUncached<T = any>(
  vehicleId: string,
  selectClause: string,
  options: FetchVehicleImagesOptions = {},
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    // Chained .or() with not.in.("a","b") was producing PostgREST 500s.
    // Server-side filters that work cleanly stay; the OR-chain filters move client-side.
    const query = supabase
      .from('vehicle_images')
      .select(selectClause)
      .eq('vehicle_id', vehicleId)
      .not('is_document', 'is', true)
      .not('is_duplicate', 'is', true)
      .not('image_url', 'is', null)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) throw error;

    const rawBatch = (data || []) as any[];
    const filtered = rawBatch.filter((r: any) => {
      if (options.includeMismatchFilter) {
        const mvms = r?.image_vehicle_match_status;
        if (mvms === 'mismatch' || mvms === 'unrelated') return false;
      }
      const vgs = r?.vision_gate_status;
      if (vgs != null && vgs !== 'approved') return false;
      return true;
    }) as T[];
    rows.push(...filtered);

    // Pagination break MUST use raw page size — filtering can drop rows but the
    // next page may still have unfiltered ones.
    if (rawBatch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}
