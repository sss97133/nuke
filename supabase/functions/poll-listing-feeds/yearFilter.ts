/**
 * Feed-level year slice. A feed whose listing URLs carry the year in their slug (Cars & Bids: /auctions/<id>/2004-bmw-m3)
 * can say which years are worth paid fetching (search_criteria.slug_year_min / slug_year_max). The rest are not queued; they
 * stay as discovered-not-fetched source_targets rows with the year, so supply is still measured for free.
 */
export function slugYear(url: string): number | null {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    const m = last.match(/^(\d{4})-[a-z0-9]/i);
    const y = m ? Number(m[1]) : null;
    return y !== null && y > 1885 && y < 2100 ? y : null;
  } catch {
    return null;
  }
}

export function splitByYear(urls: string[], min: number, max: number): { keep: string[]; rest: Array<{ url: string; year: number | null }> } {
  const keep: string[] = [];
  const rest: Array<{ url: string; year: number | null }> = [];
  for (const url of urls) {
    const year = slugYear(url);
    if (year !== null && year >= min && year <= max) keep.push(url);
    else rest.push({ url, year });
  }
  return { keep, rest };
}
