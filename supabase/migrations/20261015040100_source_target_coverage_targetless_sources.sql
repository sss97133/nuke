-- Intake coverage meter, part 3: auction sources that hold events but have no source_targets rows
-- (Cars & Bids, RM Sotheby's) now appear in source_target_coverage with their census row and landed lots.
-- Both populations are 'unknown': Cars & Bids sits behind Cloudflare (403 to a plain fetch) and its last 12 months
-- of sitemap ids say nothing of earlier years; RM Sotheby's publishes no sitemap or robots file. The view keeps
-- landed_of_population null for them and says why in source_census.census_notes.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

INSERT INTO public.source_census
  (source_id, universe_total, universe_historical, census_method, census_confidence, census_url, census_notes, census_at)
SELECT s.id, NULL, NULL, 'unknown', NULL, v.url, v.notes, '2026-10-15 03:00:00+00'::timestamptz
FROM (VALUES
 ('cars_and_bids', 'https://carsandbids.com/sitemap.xml',
  'No full lot count. The sitemap is behind Cloudflare (403 to a plain fetch). Online-auctions lane read it through Firecrawl on 2026-10-15: 11,279 auction ids for the last 12 months only, which says nothing of earlier years. Floor: 18,659 distinct http event URLs held on 2026-10-15, so the population is at least that.'),
 ('rm-sothebys', 'https://rmsothebys.com/',
  'No lot count. rmsothebys.com publishes no sitemap or robots.txt (404, 2026-10-15), so lots are reachable only by crawling every auction page. The January row (12, pagination) counted result pages, not lots. Floor: 1,255 distinct http event URLs held on 2026-10-15; another 1,307 RM events carry no http listing URL.')
) AS v(slug, url, notes)
JOIN public.observation_sources s ON s.slug = v.slug
ON CONFLICT (source_id, census_at) DO NOTHING;

CREATE OR REPLACE VIEW public.source_target_coverage AS
WITH pop AS (
  SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[-_]', '', 'g'))
         regexp_replace(lower(o.slug), '[-_]', '', 'g') AS nslug, o.slug,
         c.universe_total, c.census_method, c.census_confidence, c.census_at
  FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
  ORDER BY regexp_replace(lower(o.slug), '[-_]', '', 'g'), c.census_at DESC
), tgt AS (
  SELECT st.source_slug,
         regexp_replace(lower(st.source_slug), '[-_]', '', 'g') AS nslug,
         count(*) AS total_targets,
         count(iq.id) AS in_queue,
         count(iq.id) FILTER (WHERE iq.status = 'complete') AS extracted,
         count(iq.id) FILTER (WHERE iq.status = 'pending') AS pending,
         count(iq.id) FILTER (WHERE iq.status = 'failed') AS failed,
         count(iq.id) FILTER (WHERE iq.status = 'skipped') AS skipped,
         count(iq.id) FILTER (WHERE iq.status = 'duplicate') AS duplicate,
         count(*) - count(iq.id) AS gap
  FROM public.source_targets st
  LEFT JOIN public.import_queue iq ON iq.listing_url = st.listing_url
  GROUP BY st.source_slug
), lan AS (
  SELECT regexp_replace(lower(source_slug), '[-_]', '', 'g') AS nslug, source_slug,
         landed, event_urls, event_urls_without_target, landed_lots, measured_at
  FROM public.mv_source_target_landed
), base AS (
  SELECT t.source_slug, t.nslug, t.total_targets, t.in_queue, t.extracted, t.pending, t.failed, t.skipped,
         t.duplicate, t.gap
  FROM tgt t
  UNION ALL
  SELECT p.slug, p.nslug, 0, 0, 0, 0, 0, 0, 0, 0
  FROM pop p
  WHERE EXISTS (SELECT 1 FROM lan WHERE lan.nslug = p.nslug AND lan.landed_lots > 0)
    AND NOT EXISTS (SELECT 1 FROM tgt WHERE tgt.nslug = p.nslug)
)
SELECT b.source_slug,
       b.total_targets, b.in_queue, b.extracted, b.pending, b.failed, b.skipped, b.duplicate, b.gap,
       l.landed,
       round(100.0 * l.landed / nullif(b.total_targets, 0), 2) AS landed_pct,
       l.event_urls,
       l.event_urls_without_target,
       l.measured_at AS landed_measured_at,
       l.landed_lots,
       p.universe_total AS population,
       p.census_method AS population_method,
       p.census_confidence::numeric AS population_confidence,
       p.census_at AS population_at,
       round(100.0 * l.landed_lots / nullif(p.universe_total, 0), 2) AS landed_of_population
FROM base b
LEFT JOIN lan l ON l.nslug = b.nslug
LEFT JOIN pop p ON p.nslug = b.nslug
ORDER BY b.total_targets DESC, l.landed_lots DESC NULLS LAST;

COMMIT;
