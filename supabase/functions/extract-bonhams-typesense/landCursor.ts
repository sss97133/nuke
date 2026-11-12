/** Where the land walk stands: the last page landed in the current pass. */
export interface WalkCursor {
  pass: number;
  last_page: number;
}

/** The page the next run reads, from the stored cursor (null = no cursor yet: page 1 of pass 0). */
export function startFrom(cursor: WalkCursor | null): { pass: number; page: number } {
  if (!cursor || !Number.isFinite(cursor.last_page) || cursor.last_page < 1) return { pass: cursor?.pass ?? 0, page: 1 };
  return { pass: Number.isFinite(cursor.pass) ? cursor.pass : 0, page: cursor.last_page + 1 };
}

/**
 * The cursor after a run that landed pages [page, page + pagesRead - 1] of `pass`, or null when it must not move:
 * nothing landed (the run retries the same page), or the run is behind what is stored (a newer pass, or a later page of
 * the same pass, stays). The cursor only goes forward, as the furthest stamped page of the newest pass did.
 */
export function advance(stored: WalkCursor | null, pass: number, page: number, pagesRead: number, landedAny: boolean): WalkCursor | null {
  if (!landedAny || pagesRead < 1) return null;
  const next: WalkCursor = { pass, last_page: page + pagesRead - 1 };
  if (stored && (stored.pass > next.pass || (stored.pass === next.pass && stored.last_page >= next.last_page))) return null;
  return next;
}

/** Did any lander call create or update a lot? (Each call answers { created, updated, ... } or { error }.) */
export function landedAnything(results: Record<string, unknown>[]): boolean {
  return results.some((r) => (Number(r?.created) || 0) + (Number(r?.updated) || 0) > 0);
}
