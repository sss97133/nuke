// Collect every lot of an RM Sotheby's auction from its paged lot search, each lot once.
//
// POST /api/search/SearchLots?page=<n>&pageSize=<m> pages from 1, not 0. Measured 2026-10-14 on MO26 (199 lots):
//   page=0 and page=1 both return lots 1..pageSize (the pager says currentPage 1 for each)
//   page=2 returns lots pageSize+1..2*pageSize  (skip = (page - 1) * pageSize)
//   page past the end returns an empty list
//   pageSize above 200 is ignored and falls back to 40 (the pager says so)
// The extractor started at page 0, so it read the first page twice, and on a one-page auction it read every lot twice:
// 398 / 154 / 130 "lots" for MO26 / MC26 / LF26, which RM lists as 199 / 77 / 65. The response also carries
// pager.totalItems and pager.totalPages, which the old loop never read (it looked for a top-level totalCount).
//
// This starts at page 1, stops at the pager's last page (or at an empty page, or at the reported total), drops a lot it
// has already seen by RM's lot id, and reports how many it dropped and the total RM reported, so a run can say so.

export interface LotPage<T> {
  items: T[];
  /** pager.totalItems, or null when the response did not state one. */
  totalItems: number | null;
  /** pager.totalPages, or null when the response did not state one. */
  totalPages: number | null;
}

export interface CollectedLots<T> {
  items: T[];
  /** The total RM reported, or null when no page stated one. */
  reported_total: number | null;
  pages_fetched: number;
  /** Lots a later page repeated. Zero when the paging is right; anything else is worth a look. */
  duplicates_dropped: number;
}

/** A lot's identity for de-duplication: RM's lot id, else its link. */
function lotKey(item: { id?: unknown; link?: unknown }): string | null {
  const id = String(item.id ?? '').trim();
  if (id) return `id:${id}`;
  const link = String(item.link ?? '').trim();
  return link ? `link:${link}` : null;
}

export async function collectLots<T extends { id?: unknown; link?: unknown }>(
  fetchPage: (page: number) => Promise<LotPage<T>>,
  opts: { maxPages?: number } = {},
): Promise<CollectedLots<T>> {
  const maxPages = opts.maxPages ?? 25;
  const seen = new Set<string>();
  const items: T[] = [];
  let reportedTotal: number | null = null;
  let duplicates = 0;
  let pages = 0;

  for (let page = 1; page <= maxPages; page++) {
    const got = await fetchPage(page);
    pages++;
    if (got.totalItems !== null) reportedTotal = got.totalItems;

    let added = 0;
    for (const item of got.items) {
      const key = lotKey(item);
      if (key !== null && seen.has(key)) {
        duplicates++;
        continue;
      }
      if (key !== null) seen.add(key);
      items.push(item);
      added++;
    }

    if (got.items.length === 0) break; // past the end
    if (added === 0) break; // a page of only repeats: the server is not paging, stop rather than loop
    if (got.totalPages !== null && page >= got.totalPages) break;
    if (reportedTotal !== null && items.length >= reportedTotal) break;
  }

  return { items, reported_total: reportedTotal, pages_fetched: pages, duplicates_dropped: duplicates };
}
