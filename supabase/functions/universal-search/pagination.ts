/** Pagination belongs to the selected vehicle reader, not mixed display results. */
export type VehicleSource = 'ranked' | 'direct' | 'ilike' | 'year';
export const MAX_SEARCH_OFFSET = 10000;

export function candidatePage<T>(rows: T[], offset: number, limit: number) {
  if (!Array.isArray(rows)) throw new Error('Invalid vehicle reader response');
  const consumed = Math.min(rows.length, limit);
  const hasMore = rows.length > limit;
  const paginationLimited = hasMore && offset + consumed > MAX_SEARCH_OFFSET;
  return { rows: rows.slice(0, consumed), consumed, has_more: hasMore,
    pagination_limited: paginationLimited,
    next_offset: hasMore && !paginationLimited ? offset + consumed : null };
}

// Category/own-vehicle/deep/fuzzy results must never displace a vehicle whose
// candidate offset has already been consumed. Input order is the display order.
export function preservePrimaryPage<T extends { id: string }>(results: T[], primaryIds: Set<string>, limit: number): T[] {
  const seen = new Set<string>();
  const unique = results.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id); return true;
  });
  let supplementalSlots = Math.max(0, limit - unique.filter(r => primaryIds.has(r.id)).length);
  return unique.filter(r => primaryIds.has(r.id) || supplementalSlots-- > 0);
}
