// Run `fn` over `items` with at most `limit` in flight, and wait for all of them.
//
// extract-rmsothebys wrote its lots one after another. Replaying a first pass over MO26 against prod's mean statement times
// (pg_stat_statements, 2026-10-14: vehicle insert 150 ms, vehicle_images insert 450 ms, ILIKE miss 120 ms) took 127 s for
// 192 lots, against an edge function limit of 150 s on the plan this project may be on, and single statements have run for
// 5 to 37 s. A few lots at a time keeps the first pass well inside the limit. The lots are independent: each has its own
// listing URL, vehicle and episode.
//
// `fn` is expected to handle its own errors (a failed lot is reported by the caller); an error that escapes ends that
// worker's loop and is thrown after the others finish, so a bug is loud and no lot is silently skipped.
export async function forEachConcurrent<T>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  const errors: unknown[] = [];
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        await fn(items[index], index);
      } catch (e) {
        errors.push(e);
        return;
      }
    }
  }));
  if (errors.length > 0) throw errors[0];
}

/** A request's concurrency: an integer from 1 to `max`, else `fallback`. */
export function readConcurrency(value: unknown, fallback: number, max = 8): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}
