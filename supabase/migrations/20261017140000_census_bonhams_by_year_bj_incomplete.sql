-- Bonhams by_year, Barrett-Jackson marked population-incomplete, Gooding's by_year made explicit (owner-lead 2026-10-15).
--  * Bonhams: lots by sale year from the house's own search index (extract-bonhams-typesense, mode search, one count per UTC year of
--    hammerTime.timestamp, filter department.code MOT-CAR), read at 0 credits. All 34,101 car-department lots carry a hammerTime. The index
--    holds sales from 2003 on. MOT-CAR also contains mascots, handbooks and helmets (lane-bonhams' finding), so this is the department's lots.
--  * Barrett-Jackson: the sitemap lists 35,790 distinct URLs but we hold 39,696 BJ event URLs, so it is not the whole archive and "94% held"
--    was wrong. The whole-source row is now population UNKNOWN (universe_total NULL, confidence 0.4, the reason in census_notes), so
--    source_target_coverage reports no percent. A complete count needs per-auction docket totals; whether to fetch barrett-jackson.com pages for
--    them is the owner's call (robots.txt), so none were fetched. Its by_year is also marked unknown: it counted only sitemap-listed lots.
--  * Reading by_year: take the LATEST row per source whose by_year IS NOT NULL. A JSON null value (jsonb_typeof = 'null') means unknown, an
--    empty object {} (the column default of older rows) also means unknown, never zero lots. Gooding gets a JSON null for the same reason.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
INSERT INTO public.source_census
  (source_id, universe_total, universe_historical, census_method, census_confidence, census_url, census_notes, by_year, raw_response, census_at)
SELECT s.id, v.total, v.hist, v.method, v.conf, v.url, v.notes, v.by_year::jsonb, v.raw::jsonb, now() + v.off * interval '1 second'
FROM (VALUES
 ('bonhams', 34101, 34101, 'search_index', 0.80::numeric, 'https://api01.bonhams.com (Typesense lots collection, department.code MOT-CAR)',
  'by_year = lots by sale year of the house''s own listing. Search-index counts per UTC year of hammerTime.timestamp, read 2026-10-15 through extract-bonhams-typesense (mode search, 0 Firecrawl credits); all 34,101 car-department lots carry a hammerTime, none are undated. The index holds sales from 2003 on; older Bonhams sales are not in it. The department also holds non-car items (mascots, handbooks, helmets).',
  '{"2003":2490,"2004":2964,"2005":962,"2006":870,"2007":970,"2008":1179,"2009":1446,"2010":1361,"2011":1399,"2012":1214,"2013":1397,"2014":1535,"2015":1379,"2016":1344,"2017":1444,"2018":1649,"2019":2176,"2020":1397,"2021":1481,"2022":1240,"2023":1422,"2024":1160,"2025":899,"2026":712,"2027":11}', NULL, 0),
 ('barrett-jackson', NULL::int, NULL::int, 'sitemap_incomplete', 0.40::numeric, 'https://www.barrett-jackson.com/sitemap-vehicles.xml',
  'Population UNKNOWN. The sitemaps list 35,790 distinct vehicle URLs, but we hold 39,696 Barrett-Jackson event URLs, so the sitemap is not the whole archive (older sales are not listed). A complete count needs per-auction docket totals, which means fetching barrett-jackson.com pages: not done, the robots.txt question is the owner''s. 35,790 is a lower bound. by_year of the 2026-10-15 23:59 row counted only sitemap-listed lots and is withdrawn (JSON null).',
  'null', '{"sitemap_listed_distinct": 35790, "held_event_urls": 39696, "lower_bound": 35790}', 1),
 ('gooding', 9593, 9593, 'sitemap', 0.85::numeric, 'https://www.goodingco.com/sitemap.xml',
  'by_year unknown: the Gooding sitemap lists lot URLs with lastmod only, which is not a sale date. JSON null so no older empty-object row reads as zero lots.',
  'null', NULL, 2)
) AS v(slug, total, hist, method, conf, url, notes, by_year, raw, off)
JOIN public.observation_sources s ON s.slug = v.slug
ON CONFLICT (source_id, census_at) DO NOTHING;
COMMIT;
