-- Cars & Bids census row from lane-online-auctions (2026-10-15): the sitemap (read through 1 Firecrawl credit; the site and its
-- sitemap return 403 to a direct fetch) lists 11,279 distinct auction ids with lastmod from 2025-10-14 to 2026-10-14. That is a
-- 12-month WINDOW, not the population: about 18.7k C&B event URLs are held and 16,196 of their ids lie outside the window, so the
-- all-time population is well above 11,279 and unknown. The row is therefore scoped (universe_historical NULL), and
-- source_target_coverage and the Firecrawl allocation keep treating the whole-source population as unknown.
-- Against the window: 2,418 of the 11,279 ids match a vehicle_event case-insensitively (1,140 case-sensitively, because an old
-- writer lowercased 17,486 event ids); 8,861 are missing and all sit in source_targets, 1964-1991 first. The sitemap lastmod is the
-- page's last-modified, not the auction end time, so it is not an end-time clock.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
INSERT INTO public.source_census
  (source_id, universe_total, universe_historical, census_method, census_confidence, census_url, census_notes, raw_response, census_at)
SELECT s.id, 11279, NULL, 'sitemap', 0.95, 'cab-sitemap/auctions.xml (via Firecrawl, 1 credit)',
       'Scoped: auctions the C&B sitemap lists with lastmod 2025-10-14 to 2026-10-14, complete for what the sitemap lists. Not the population: ids older than the window exist (16,196 held event ids lie outside it). lastmod is not an end time. Read 2026-10-15 by lane-online-auctions; ids in ~/nuke-logs/lane-online/cab_sitemap_20261015.tsv.',
       '{"scope": "sitemap window, 12 months", "window": ["2025-10-14", "2026-10-14"], "held_case_insensitive": 2418, "held_case_sensitive": 1140, "missing": 8861, "missing_in_source_targets": 8861}'::jsonb,
       '2026-10-15 19:30:00+00'::timestamptz
FROM public.observation_sources s WHERE s.slug = 'cars_and_bids'
ON CONFLICT (source_id, census_at) DO NOTHING;
COMMIT;
