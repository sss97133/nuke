-- Hagerty Marketplace population from its public sitemap (owner-lead 2026-10-15; free, read directly, robots allows it).
-- marketplace/server-sitemap.xml read 2026-10-16 01:2xZ: 7,636 URLs, of which 6,511 /marketplace/auction/ and 982 /marketplace/classified/ listings
-- (7,493), the rest are make pages and collections. No lastmod, so no sale date and no by_year (NULL, not a spread). Model year from the slug:
-- 3,419 listings are 1964-1991 (2,945 auction + 474 classified), 45.6% of the 7,491 with a year. The sitemap lists listings Hagerty serves
-- now, not an archive, so confidence is 0.50. Seller type is not in the sitemap (private share unmeasured). We hold 85 hagerty events.
-- new_per_day needs two reads: the URL list is saved (nuke-logs/hagerty-census/sitemap_20261016.txt) and tomorrow's read gives the difference.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
INSERT INTO public.source_census
  (source_id, universe_total, universe_historical, census_method, census_confidence, census_url, census_notes, by_year, census_at)
SELECT s.id, 7493, 7493, 'sitemap', 0.50::numeric, 'https://www.hagerty.com/marketplace/server-sitemap.xml',
  'Listing URLs in Hagerty Marketplace server-sitemap.xml, read 2026-10-16: 6,511 auction + 982 classified = 7,493 (7,636 URLs less make pages and collections). Lists what Hagerty serves now, not an archive. No lastmod: no sale date, by_year unknown. Model year from slug: 3,419 are 1964-1991 (45.6% of 7,491 with a year). Seller type not in the sitemap.',
  NULL, now()
FROM public.observation_sources s WHERE s.slug = 'hagerty'
ON CONFLICT (source_id, census_at) DO NOTHING;
COMMIT;
