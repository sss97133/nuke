-- Intake coverage meter, part 2: report landed lots against each source's population, with the census method
-- and confidence beside it. source_targets is a list of what an earlier sitemap/API pull found (2026-02-11), not
-- the population: it misses about 93k BaT lots we hold. source_census gets one new row per source (the table keeps
-- history; the view reads the latest); a source whose lots cannot be enumerated gets method 'unknown' and a null
-- total, so landed_of_population is null, not a guess.
-- mv_source_target_landed is rebuilt (created earlier today, only the view reads it) to add landed_lots: distinct
-- event URL keys per platform, http(s) URLs only (conceptcarz:// event rows carry no listing URL).
BEGIN;
SET LOCAL statement_timeout = '600s';
SET LOCAL lock_timeout = '10s';

INSERT INTO public.source_census
  (source_id, universe_total, universe_historical, census_method, census_confidence, census_url, census_notes, census_at)
SELECT s.id, v.total, v.total, v.method, v.conf, v.url, v.notes, v.at::timestamptz
FROM (VALUES
 ('bat', 264746, 'enumerated', 0.90, 'scripts/data/bat-archive.duckdb sales (BaT listings-filter pages)',
  'Distinct lots in the local BaT archive catalog (model-year, feed and category slices), built 2026-09-27. BaT reported 255,602 lots on 2026-09-24 before the category slices reached lots with no model year. Counts lots through 2026-09-27; later lots are not in it.',
  '2026-09-27 23:06:00+00'),
 ('mecum', 268979, 'enumerated', 0.85, 'https://www.mecum.com/sitemap-index.xml',
  'Distinct lot ids in all 269 lot-sitemapN.xml files (268,991 URLs) of the Mecum sitemap index, fetched 2026-10-15, one request per 2 s. Includes lots of every category Mecum sells, not only cars.',
  '2026-10-15 01:00:00+00'),
 ('barrett-jackson', 42075, 'enumerated', 0.75, 'https://www.barrett-jackson.com/sitemap-vehicles.xml',
  'Distinct URLs in sitemap-vehicles.xml and sitemap-vehicles2.xml (56,700 listed, 42,075 distinct), fetched 2026-10-15. Automobilia sitemap excluded. We hold slightly more distinct BJ URLs than this, so the sitemap undercounts the archive.',
  '2026-10-15 01:00:00+00'),
 ('gooding', 9593, 'enumerated', 0.85, 'https://www.goodingco.com/sitemap.xml',
  '/lot/ URLs in the Gooding sitemap, fetched 2026-10-15.',
  '2026-10-15 01:00:00+00'),
 ('collecting-cars', 26945, 'enumerated', 0.70, 'https://collectingcars.com/sitemap.xml',
  'Distinct /for-sale/ URLs in the sitemap, fetched 2026-10-15. Includes live and ended listings of every vehicle type.',
  '2026-10-15 01:00:00+00'),
 ('broad-arrow', 2943, 'enumerated', 0.80, 'https://www.broadarrowauctions.com/sitemaps/bagauction/sitemap.xml.gz',
  '/vehicles/{sale}/{lot} URLs in the sitemap, fetched 2026-10-15; the /vehicles/sold index page excluded.',
  '2026-10-15 01:00:00+00'),
 ('barnfinds', 63529, 'enumerated', 0.60, 'https://barnfinds.com/wp-sitemap.xml',
  'Posts in wp-sitemap-posts-post-1..64 (63 files of 1,000 plus 529 in the last), fetched 2026-10-15. These are posts, so editorial articles are counted with listings; the vehicle share is unknown.',
  '2026-10-15 01:00:00+00'),
 ('pcarmarket', 27166, 'bounded', 0.50, 'https://www.pcarmarket.com/sitemap.xml',
  'Between 19,471 and 27,166 lots, all categories (watches and collectibles included). Lower bound: sitemap-results.xml 19,255 + auctions 61 + marketplace 155, fetched 2026-10-15. Upper bound: the 27,166 /auction/ URLs found 2026-02-11. The results sitemap no longer lists every past auction; total is set to the upper bound.',
  '2026-10-15 01:00:00+00'),
 ('bonhams', NULL, 'unknown', NULL, 'https://www.bonhams.com/sitemap-sale.xml',
  'The sitemap lists 11,441 sales (auction pages), not lots, and lot pages sit behind the Typesense search API, which is not a public index. The 142,575 lots in source_targets (Typesense pull, 2026-02-11) are a lower bound, and the sales cover every department, not only motorcars.',
  '2026-10-15 01:00:00+00'),
 ('hemmings', NULL, 'unknown', NULL, 'https://www.hemmings.com/sitemap_makes.xml',
  'The sitemap lists make/model/year category pages (1,060 make files), not classified listings. Listings are live inventory with no stable enumerable index, so no lot count exists to divide by.',
  '2026-10-15 01:00:00+00')
) AS v(slug, total, method, conf, url, notes, at)
JOIN public.observation_sources s ON s.slug = v.slug
ON CONFLICT (source_id, census_at) DO NOTHING;

DROP VIEW public.source_target_coverage;
DROP MATERIALIZED VIEW public.mv_source_target_landed;

CREATE MATERIALIZED VIEW public.mv_source_target_landed AS
WITH t AS (
  SELECT source_slug, regexp_replace(lower(source_slug), '[-_]', '', 'g') AS nslug,
         public.source_target_key(listing_url) AS k
  FROM public.source_targets
), e AS (
  SELECT regexp_replace(lower(source_platform), '[-_ ]', '', 'g') AS nplat,
         source_url ~* '^https?://' AS is_http,
         public.source_target_key(source_url) AS k
  FROM public.vehicle_events
  WHERE source_url IS NOT NULL
), tk AS (SELECT DISTINCT k FROM t), ek AS (SELECT DISTINCT k FROM e),
landed AS (
  SELECT t.source_slug, t.nslug, count(DISTINCT t.k) AS landed
  FROM t JOIN ek ON ek.k = t.k GROUP BY 1, 2
), drift AS (
  SELECT e.nplat, count(DISTINCT e.k) AS event_urls,
         count(DISTINCT e.k) FILTER (WHERE tk.k IS NULL) AS event_urls_without_target,
         count(DISTINCT e.k) FILTER (WHERE e.is_http) AS landed_lots
  FROM e LEFT JOIN tk ON tk.k = e.k GROUP BY 1
)
SELECT coalesce(l.source_slug, d.nplat) AS source_slug,
       coalesce(l.landed, 0) AS landed,
       coalesce(d.event_urls, 0) AS event_urls,
       coalesce(d.event_urls_without_target, 0) AS event_urls_without_target,
       coalesce(d.landed_lots, 0) AS landed_lots,
       now() AS measured_at
FROM (SELECT s.source_slug, s.nslug, coalesce(l.landed, 0) AS landed
      FROM (SELECT DISTINCT source_slug, nslug FROM t) s
      LEFT JOIN landed l USING (source_slug, nslug)) l
FULL JOIN drift d ON d.nplat = l.nslug;

CREATE UNIQUE INDEX mv_source_target_landed_slug ON public.mv_source_target_landed (source_slug);

CREATE VIEW public.source_target_coverage AS
WITH pop AS (
  SELECT DISTINCT ON (o.slug) o.slug, c.universe_total, c.census_method, c.census_confidence, c.census_at
  FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
  ORDER BY o.slug, c.census_at DESC
)
SELECT st.source_slug,
       count(*) AS total_targets,
       count(iq.id) AS in_queue,
       count(iq.id) FILTER (WHERE iq.status = 'complete') AS extracted,
       count(iq.id) FILTER (WHERE iq.status = 'pending') AS pending,
       count(iq.id) FILTER (WHERE iq.status = 'failed') AS failed,
       count(iq.id) FILTER (WHERE iq.status = 'skipped') AS skipped,
       count(iq.id) FILTER (WHERE iq.status = 'duplicate') AS duplicate,
       count(*) - count(iq.id) AS gap,
       max(m.landed) AS landed,
       round(100.0 * max(m.landed) / count(*), 2) AS landed_pct,
       max(m.event_urls) AS event_urls,
       max(m.event_urls_without_target) AS event_urls_without_target,
       max(m.measured_at) AS landed_measured_at,
       max(m.landed_lots) AS landed_lots,
       max(p.universe_total) AS population,
       max(p.census_method) AS population_method,
       max(p.census_confidence) AS population_confidence,
       max(p.census_at) AS population_at,
       round(100.0 * max(m.landed_lots) / nullif(max(p.universe_total), 0), 2) AS landed_of_population
FROM public.source_targets st
LEFT JOIN public.import_queue iq ON iq.listing_url = st.listing_url
LEFT JOIN public.mv_source_target_landed m ON m.source_slug = st.source_slug
LEFT JOIN pop p ON p.slug = st.source_slug
GROUP BY st.source_slug
ORDER BY count(*) DESC;

COMMENT ON VIEW public.source_target_coverage IS
  'Per source. landed/landed_pct: targets in source_targets (an older pull, not the population) with a vehicle_events row. landed_lots: distinct http(s) event URLs of the source, targeted or not. population, population_method (enumerated|bounded|unknown), population_confidence, population_at: latest source_census row; null when unknown. landed_of_population = landed_lots / population as a percent, null when the population is unknown, above 100 when the census undercounts. event_urls_without_target is denominator drift against source_targets. Landed numbers are as of landed_measured_at (mv refreshed every 30 min).';

COMMIT;
