import { supabase } from './supabase';

const PAGE_SIZE = 500;

interface FetchVehicleImagesOptions {
  includeMismatchFilter?: boolean;
}

/**
 * Fetch all matching vehicle images even when a vehicle exceeds the REST row cap.
 */
export async function fetchVehicleImages<T = any>(
  vehicleId: string,
  selectClause: string,
  options: FetchVehicleImagesOptions = {},
): Promise<T[]> {
  if (!vehicleId) return [];

  const rows: T[] = [];
  let from = 0;

  // The gate/supersession filters below need these columns. Append them if the
  // caller's select clause omits them (otherwise the client-side filter at the
  // bottom is dead code — vision_gate_status reads undefined and never matches).
  let select = selectClause;
  if (!/\bvision_gate_status\b/.test(select)) select += ', vision_gate_status';
  if (!/\bis_superseded\b/.test(select)) select += ', is_superseded';

  while (true) {
    // Chained .or() with not.in.("a","b") was producing PostgREST 500s.
    // Server-side filters that work cleanly stay; the OR-chain filters move client-side.
    const query = supabase
      .from('vehicle_images')
      .select(select)
      .eq('vehicle_id', vehicleId)
      .not('is_document', 'is', true)
      .not('is_duplicate', 'is', true)
      // Superseded rows are prior versions of reattributed images — never display them.
      .not('is_superseded', 'is', true)
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
      if (vgs === 'rejected_personal' || vgs === 'rejected_misattributed' || vgs === 'rejected') return false;
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
