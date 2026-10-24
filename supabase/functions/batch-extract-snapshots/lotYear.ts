// Model year from the lot URL, for platforms whose lot slug starts with the car's model year.
//
// Gooding has no regex parser here, so a Gooding snapshot was read by the model, which took the auction year printed on the
// page ("2022 Pebble Beach Auctions") as the model year: 178 Gooding vehicles were created with the sale year (e.g. the
// 1992 Porsche 964 at goodingco.com/lot/1992-porsche-964-carrera-2 stored as 2022), and dedup later folded them into the
// right car (watchdog 2026-10-23). Gooding's own lot slug is "<modelYear>-<make>-<model>" (page-data modelYear agrees),
// so the slug year is the citation and a parsed year that disagrees with it is replaced.

const SLUG_YEAR_HOSTS: Record<string, RegExp> = {
  gooding: /goodingco\.com\/lot\/((?:18|19|20)\d{2})-/i,
};

export function lotSlugYear(platform: string, url: string | null | undefined): number | null {
  const re = SLUG_YEAR_HOSTS[platform];
  const m = re && url ? url.match(re) : null;
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return y >= 1885 && y <= new Date().getFullYear() + 1 ? y : null;
}

/** Sets parsed.year to the lot slug year when the platform cites one; says whether it changed a parsed year. */
export function applyLotSlugYear(parsed: Record<string, unknown>, platform: string, url: string | null | undefined): boolean {
  const y = lotSlugYear(platform, url);
  if (y === null) return false;
  const had = parsed.year;
  parsed.year = y;
  return had != null && Number(had) !== y;
}
