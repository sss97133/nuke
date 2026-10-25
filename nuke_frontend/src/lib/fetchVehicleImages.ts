import { supabase } from './supabase';
import { vehicleImageGallerySource, vehicleImageColumnsForViewer } from './vehicleImageColumns';
import { createViewerScopedInflight } from './viewerScopedInflight';

// PostgREST's row cap on this project (probed 2026-10-14: limit=1500 returns 1000 rows). Every page re-runs the whole
// filter and sort over all of the vehicle's images and projects them before the page is cut, so the work of a gallery
// load is (pages x the vehicle's images): the K5's 3,716 images cost eight page queries at 500 and four at 1000.
const PAGE_SIZE = 1000;
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
  /**
   * Told how many rows were loaded against how many the database admits (page 0 carries the exact
   * count), once the fetch settles. A caller that shows a count can then say "n of N" when a cap or
   * the deadline left rows behind, instead of presenting what loaded as the whole. Not part of the
   * in-flight dedupe key, so a coalesced concurrent caller is not told.
   */
  onLoadCoverage?: (coverage: { loaded: number; total: number }) => void;
}

// In-flight dedupe keyed on query shape. The identical full-set vehicle_images
// query (select ... order by position) was observed firing 2-4x per page load
// (StrictMode double-mount + gallery/profile both resolving images). Concurrent
// callers share one promise; entries clear on settle — coalescing, not caching.
const coalesceImages = createViewerScopedInflight<any[]>();

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
  return coalesceImages(supabase, key, assertCurrent =>
    fetchVehicleImagesUncached<T>(vehicleId, selectClause, options, assertCurrent));
}

async function fetchVehicleImagesUncached<T = any>(
  vehicleId: string,
  selectClause: string,
  options: FetchVehicleImagesOptions = {},
  assertCurrent: () => void = () => {},
): Promise<T[]> {
  const { maxRows, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  // A caller that wants only the first N rows (the hero resolver) asks for no more than that.
  let pageSize = maxRows ? Math.min(PAGE_SIZE, maxRows) : PAGE_SIZE;

  // The shared database predicate admits pending public listing photos only
  // with approved publication provenance tied to this vehicle's auction event.
  // It preserves the gate for private intake and excludes rejected/unsafe rows;
  // display eligibility does not claim that vision analysis has completed.
  const source = await vehicleImageGallerySource();
  const columns = await vehicleImageColumnsForViewer(selectClause);
  const fetchPage = (from: number, withCount: boolean) => {
    assertCurrent();
    const query = supabase
      .from(source)
      .select(columns, withCount ? { count: 'exact' } : undefined)
      .eq('vehicle_id', vehicleId)
      .eq('vehicle_image_gallery_eligible', true)
      .not('is_document', 'is', true)
      .not('is_duplicate', 'is', true)
      // Superseded rows are prior versions of reattributed images — never display them.
      .not('is_superseded', 'is', true)
      .not('image_url', 'is', null)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    return options.includeMismatchFilter
      ? query.or('image_vehicle_match_status.is.null,image_vehicle_match_status.not.in.("mismatch","unrelated")')
      : query;
  };

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
  // The row cap is server configuration. If it gave fewer rows than asked while more exist, page by what it gives
  // instead of mistaking the short page for the last one.
  if (rows.length > 0 && rows.length < pageSize && total > rows.length) pageSize = rows.length;
  const settle = (collected: T[]) => {
    assertCurrent();
    options.onLoadCoverage?.({ loaded: collected.length, total: Math.max(total, collected.length) });
    return collected;
  };

  // Caller only wants the first N (e.g. hero/lead resolution) — stop early.
  if (maxRows && rows.length >= maxRows) {
    rows.length = maxRows;
    return settle(rows);
  }
  if (rows.length < pageSize || total <= rows.length) return settle(rows);

  const cap = maxRows ? Math.min(total, maxRows) : total;
  const offsets: number[] = [];
  for (let from = pageSize; from < cap; from += pageSize) offsets.push(from);

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
  return settle(rows);
}
