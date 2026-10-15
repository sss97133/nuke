-- by_year on source_census: lots by SALE year per house (owner-lead 2026-10-15), for the "any house can earn the move views" gate:
-- a house joins the map color, movers and price-move views when we hold at least 90% of its lots in each of the two 12-month windows
-- compared, which needs per-year house totals. Keys are the SALE year (the house's own run or end date, UTC), values are lot counts.
-- Append-only: one new census row per measurement. A house whose enumeration carries no date gets by_year NULL (unknown), never the
-- all-years total spread across years. census_notes of each row: "by_year = lots by sale year of the house's own listing", plus the source.
--   mecum            Algolia index pull (index.ndjson, 312,381 lots, pulled 2026-10-14 21:15 PT), run_date per lot, Road Art excluded:
--                    232,885 lots dated; a SCOPED row (universe_historical NULL), because the sitemap population (268,979) keeps its
--                    Road Art lots and source_target_coverage keeps reading that whole-source row.
--   barrett-jackson  sitemap-vehicles.xml + sitemap-vehicles2.xml, year from the auction slug (palm-beach-2022). Also CORRECTS the population:
--                    the earlier row (42,075) added the two files' distinct counts, but 6,285 URLs sit in both; the distinct total is 35,790.
--                    We hold more BJ URLs (39,696) than the sitemap lists, so the sitemap is not the whole archive.
--   broad-arrow      sitemap vehicle URLs, year from the two digits of the sale code (jc23_053 = 2023).
--   gooding          sitemap lists lot URLs with lastmod only: no sale date, by_year NULL.
--   bat              local BaT archive catalog (sales, end_ts), refreshed to 2026-10-15; the archive starts mid-2014 and its early years are thin
--                    against the BaT events we hold from 2006, so read years before 2016 as incomplete.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';

INSERT INTO public.source_census
  (source_id, universe_total, universe_historical, census_method, census_confidence, census_url, census_notes, by_year, census_at)
SELECT s.id, v.total, v.hist, v.method, v.conf, v.url, v.notes, v.by_year::jsonb, now() + v.off * interval '1 second'
FROM (VALUES
 ('mecum', 232885, NULL::int, 'algolia_index_pull', 0.90::numeric, 'https://U6CFCQ7V52-dsn.algolia.net/1/indexes/wp_posts_lot/query',
  'by_year = lots by sale year of the house''s own listing. Mecum Algolia index pulled 2026-10-14 21:15 PT (312,381 lots; 79,494 Road Art excluded; 2 lots without a run_date not counted); year = UTC year of run_date. Includes motorcycles, tractors and other non-car lots (lot_type other than Road Art). Scoped row: the whole-source population stays the sitemap row.',
  '{"2012":11520,"2013":13927,"2014":14412,"2015":14213,"2016":14283,"2017":16207,"2018":16595,"2019":16889,"2020":12558,"2021":14421,"2022":19081,"2023":19584,"2024":17322,"2025":16969,"2026":14136,"2027":768}', 0),
 ('barrett-jackson', 35790, 35790, 'sitemap', 0.60::numeric, 'https://www.barrett-jackson.com/sitemap-vehicles.xml',
  'by_year = lots by sale year of the house''s own listing. Distinct URLs across sitemap-vehicles.xml and sitemap-vehicles2.xml, read 2026-10-15 00:30Z: 35,790 (earlier row 42,075 summed per-file distincts and double-counted 6,285). 35,509 carry an auction slug year, 281 do not and are not in by_year. We hold 39,696 BJ URLs, more than this sitemap lists.',
  '{"1999":354,"2000":25,"2001":58,"2002":724,"2003":409,"2004":634,"2005":466,"2006":871,"2007":1135,"2008":1302,"2009":1247,"2010":1671,"2011":1801,"2012":1973,"2013":1631,"2014":1828,"2015":2010,"2016":1752,"2017":2551,"2018":1888,"2019":2633,"2020":1116,"2021":1583,"2022":1972,"2023":1770,"2024":2094,"2025":11}', 1),
 ('broad-arrow', 2943, 2943, 'sitemap', 0.60::numeric, 'https://www.broadarrowauctions.com/sitemaps/bagauction/sitemap.xml.gz',
  'by_year = lots by sale year of the house''s own listing. Sitemap vehicle URLs read 2026-10-15 00:30Z; year = the two digits after the sale code''s two letters (jc23_053 = 2023): 2,782 dated, 161 with another code shape not in by_year.',
  '{"2022":412,"2023":344,"2024":458,"2025":779,"2026":789}', 2),
 ('gooding', 9593, 9593, 'sitemap', 0.85::numeric, 'https://www.goodingco.com/sitemap.xml',
  'by_year unknown: the Gooding sitemap lists lot URLs with lastmod only, which is not a sale date. NULL, not an even spread of 9,593 over years.',
  NULL, 3),
 ('bat', 268183, 268183, 'enumerated', 0.90::numeric, 'scripts/data/bat-archive.duckdb sales (BaT listings-filter pages)',
  'by_year = lots by sale year of the house''s own listing. Local BaT archive catalog, 268,183 lots with end_ts through 2026-10-15 13:58 PT; year = UTC year of end_ts. The archive starts 2014-07-30 and its early years are thin against the BaT events we hold from 2006: years before 2016 are incomplete.',
  '{"2014":134,"2015":694,"2016":2101,"2017":4590,"2018":7674,"2019":11305,"2020":14556,"2021":21344,"2022":32138,"2023":37330,"2024":43767,"2025":49419,"2026":43131}', 4)
) AS v(slug, total, hist, method, conf, url, notes, by_year, off)
JOIN public.observation_sources s ON s.slug = v.slug
ON CONFLICT (source_id, census_at) DO NOTHING;
COMMIT;
