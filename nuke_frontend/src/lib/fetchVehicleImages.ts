import { supabase } from './supabase';

const PAGE_SIZE = 500;
const DEFAULT_TIMEOUT_MS = 12000;
// Cap the fan-out so a 50k-image vehicle doesn't fire 100 concurrent requests.
const MAX_PARALLEL_PAGES = 6;

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

// In-flight dedupe keyed on query shape. The identical full-set vehicle_images
// query (select ... order by position) was observed firing 2-4x per page load
// (StrictMode double-mount + gallery/profile both resolving images). Concurrent
// callers share one promise; entries clear on settle — coalescing, not caching.
const inflightFetches = new Map<string, Promise<any[]>>();

/**
 * Fetch all matching vehicle images even when a vehicle exceeds the REST row cap.
 * Identical concurrent calls (same vehicle + select + options) share one request.
 *
 * Page 0 carries an exact count, then the remaining pages fan out in parallel
 * (measured 2026-06-11 on a 2,686-row vehicle: 6 serial round-trips -> 1 + one
 * parallel wave).
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

  const key = `${vehicleId}|${selectClause}|${options.includeMismatchFilter ? 1 : 0}|${options.maxRows ?? 0}|${options.timeoutMs ?? 0}`;
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
  const { maxRows, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const deadline = Date.now() + Math.max(1000, timeoutMs);

  // Gate + mismatch filters run server-side as ONE or=(and(or(),or())) group.
  // Two chained .or() calls emit duplicate or= params (PostgREST 500s on those);
  // a single combined group is accepted (probed against prod 2026-06-11).
  // Server-side filtering also stops rejected rows from being downloaded just
  // to be discarded (20% of rows for heavy vehicles), and applies the vision
  // gate even when the caller's select omits vision_gate_status — the old
  // client-side filter silently no-opped in that case.
  //
  // The gallery uses a WHITELIST (vision_gate_status null or approved): the full
  // gallery is the conservative surface and shows only confirmed-good images.
  // Peripheral discovery surfaces (DiscoveryFeed, VehicleThumbnail, ProImageViewer)
  // use a BLACKLIST that only hides the explicit rejects — see those components.
  // Note: 'rejected' is NOT a vision_gate_status enum value (the enum is pending,
  // approved, rejected_personal, rejected_misattributed, review_needed); a PostgREST
  // not.in() containing it 400s with "invalid input value for enum", so it must
  // never appear in a filter literal.
  const gateFilter = options.includeMismatchFilter
    ? 'and(or(vision_gate_status.is.null,vision_gate_status.eq.approved),or(image_vehicle_match_status.is.null,image_vehicle_match_status.not.in.("mismatch","unrelated")))'
    : 'vision_gate_status.is.null,vision_gate_status.eq.approved';

  const fetchPage = (from: number, withCount: boolean) =>
    supabase
      .from('vehicle_images')
      .select(selectClause, withCount ? { count: 'exact' } : undefined)
      .eq('vehicle_id', vehicleId)
      .not('is_document', 'is', true)
      .not('is_duplicate', 'is', true)
      // Superseded rows are prior versions of reattributed images — never display them.
      .not('is_superseded', 'is', true)
      .not('image_url', 'is', null)
      .or(gateFilter)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

  // Race each page against the remaining overall budget so one hung request
  // (saturated pool) can't block past the deadline — callers get partial results.
  const fetchPageBounded = async (
    from: number,
    withCount: boolean,
  ): Promise<{ data: T[] | null; count?: number | null; timedOut: boolean }> => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { data: null, timedOut: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ __timeout: true }>((resolve) => {
      timer = setTimeout(() => resolve({ __timeout: true }), remainingMs);
    });
    const result: any = await Promise.race([fetchPage(from, withCount), timeoutPromise]);
    if (timer) clearTimeout(timer);
    if (result?.__timeout) return { data: null, timedOut: true };
    if (result.error) throw result.error;
    return { data: (result.data || []) as T[], count: result.count, timedOut: false };
  };

  const first = await fetchPageBounded(0, true);
  if (first.timedOut) return [];
  const rows: T[] = [...(first.data || [])];
  const total = typeof first.count === 'number' ? first.count : rows.length;

  // Caller only wants the first N (e.g. hero/lead resolution) — stop early.
  if (maxRows && rows.length >= maxRows) {
    rows.length = maxRows;
    return rows;
  }
  if (rows.length < PAGE_SIZE || total <= rows.length) return rows;

  const cap = maxRows ? Math.min(total, maxRows) : total;
  const offsets: number[] = [];
  for (let from = PAGE_SIZE; from < cap; from += PAGE_SIZE) offsets.push(from);

  for (let i = 0; i < offsets.length; i += MAX_PARALLEL_PAGES) {
    const wave = offsets.slice(i, i + MAX_PARALLEL_PAGES);
    const pages = await Promise.all(wave.map((from) => fetchPageBounded(from, false)));
    let timedOut = false;
    for (const page of pages) {
      if (page.timedOut) {
        timedOut = true;
        continue;
      }
      rows.push(...(page.data || []));
    }
    if (timedOut) break; // overall deadline hit — return what we have
    if (maxRows && rows.length >= maxRows) break;
  }

  if (maxRows && rows.length > maxRows) rows.length = maxRows;
  return rows;
}
