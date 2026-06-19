import { supabase } from './supabase';

const PAGE_SIZE = 500;
const DEFAULT_TIMEOUT_MS = 12000;

interface FetchVehicleImagesOptions {
  includeMismatchFilter?: boolean;
  /**
   * Stop paginating once this many rows are collected. The hero/lead resolver only
   * needs the first page (ordered is_primary first), so it passes a small cap rather
   * than fetching every image on a 3,000+ photo vehicle.
   */
  maxRows?: number;
  /**
   * Overall deadline for the whole paginated fetch. If the pool is saturated and a
   * page hangs, we return whatever was collected so far instead of leaving the caller
   * (hero + gallery) stuck on an infinite "Loading…" spinner. Default 12s.
   */
  timeoutMs?: number;
}

/**
 * Fetch all matching vehicle images even when a vehicle exceeds the REST row cap.
 *
 * Bounded by a deadline: no single hung page (pool saturation) can hang the caller
 * forever — it returns partial results and the UI resolves to an honest state.
 */
export async function fetchVehicleImages<T = any>(
  vehicleId: string,
  selectClause: string,
  options: FetchVehicleImagesOptions = {},
): Promise<T[]> {
  if (!vehicleId) return [];

  const { includeMismatchFilter, maxRows, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const rows: T[] = [];
  let from = 0;
  const deadline = Date.now() + Math.max(1000, timeoutMs);

  // The gate/supersession filters below need these columns. Append them if the
  // caller's select clause omits them (otherwise the client-side filter at the
  // bottom is dead code — vision_gate_status reads undefined and never matches).
  let select = selectClause;
  if (!/\bvision_gate_status\b/.test(select)) select += ', vision_gate_status';
  if (!/\bis_superseded\b/.test(select)) select += ', is_superseded';

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break; // overall deadline hit — return what we have
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

    // Race the page against the remaining budget so one hung request (saturated pool)
    // can't block past the deadline. The timeout resolves a sentinel that breaks the loop.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ __timeout: true }>((resolve) => {
      timer = setTimeout(() => resolve({ __timeout: true }), remainingMs);
    });
    const result: any = await Promise.race([query, timeoutPromise]);
    if (timer) clearTimeout(timer);
    if (result?.__timeout) break; // page exceeded the deadline — return partial

    const { data, error } = result;
    if (error) throw error;

    const rawBatch = (data || []) as any[];
    const filtered = rawBatch.filter((r: any) => {
      if (includeMismatchFilter) {
        const mvms = r?.image_vehicle_match_status;
        if (mvms === 'mismatch' || mvms === 'unrelated') return false;
      }
      const vgs = r?.vision_gate_status;
      if (vgs === 'rejected_personal' || vgs === 'rejected_misattributed' || vgs === 'rejected') return false;
      return true;
    }) as T[];
    rows.push(...filtered);

    // Caller only wants the first N (e.g. hero/lead resolution) — stop early.
    if (maxRows && rows.length >= maxRows) {
      rows.length = maxRows;
      break;
    }

    // Pagination break MUST use raw page size — filtering can drop rows but the
    // next page may still have unfiltered ones.
    if (rawBatch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}
