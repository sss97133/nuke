-- Census updates from lane-barnfinds-hemmings (verified 2026-10-15), and a data-driven label for sources whose
-- source_targets rows are not lots.
--   * BarnFinds: of 59,662 targets, 56,004 carry a 4-digit year in the slug (an estimate of car posts); about 3.6k are
--     articles. Method 'bounded', confidence 0.70, replacing the sitemap-post count (63,529, which included articles).
--     Replace again when the lane reports the gated count.
--   * Hemmings: its 56,797 targets are make/model/year browse pages (none contains /classifieds/listing/), so landed
--     versus targets is meaningless. Population stays unknown; the census row carries raw_response
--     {"targets_are_lots": false}, and source_target_coverage returns landed_pct NULL for such a source and exposes
--     targets_are_lots (true unless a census row says false). The label lives in source_census, not in the view.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

INSERT INTO public.source_census
  (source_id, universe_total, universe_historical, census_method, census_confidence, census_url, census_notes, raw_response, census_at)
SELECT s.id, v.total, v.total, v.method, v.conf, v.url, v.notes, v.raw::jsonb, v.at::timestamptz
FROM (VALUES
 ('barnfinds', 56004, 'bounded', 0.70, 'https://barnfinds.com/wp-sitemap.xml',
  'Year-in-slug estimate: 56,004 of the 59,662 source_targets carry a 4-digit year in the slug (car posts); about 3.6k are articles. Exact count after the full run. Supersedes the 63,529 sitemap-post count of 2026-10-15 01:00Z, which included articles. Verified by lane-barnfinds-hemmings 2026-10-15.',
  NULL, '2026-10-15 02:00:00+00'),
 ('hemmings', NULL, 'unknown', NULL, 'https://www.hemmings.com/sitemap_makes.xml',
  'Targets are browse pages; lots behind Cloudflare; parked 2026-10-15. The 56,797 source_targets are make/model/year browse pages (0 contain /classifieds/listing/), so landed against targets is meaningless. Verified by lane-barnfinds-hemmings 2026-10-15.',
  '{"targets_are_lots": false}', '2026-10-15 02:00:00+00')
) AS v(slug, total, method, conf, url, notes, raw, at)
JOIN public.observation_sources s ON s.slug = v.slug
ON CONFLICT (source_id, census_at) DO NOTHING;

CREATE OR REPLACE VIEW public.source_target_coverage AS
WITH pop AS (
  SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[-_]', '', 'g'))
         regexp_replace(lower(o.slug), '[-_]', '', 'g') AS nslug, o.slug,
         c.universe_total, c.census_method, c.census_confidence, c.census_at, c.raw_response
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
       CASE WHEN p.raw_response ->> 'targets_are_lots' = 'false' THEN NULL
            ELSE round(100.0 * l.landed / nullif(b.total_targets, 0), 2) END AS landed_pct,
       l.event_urls,
       l.event_urls_without_target,
       l.measured_at AS landed_measured_at,
       l.landed_lots,
       p.universe_total AS population,
       p.census_method AS population_method,
       p.census_confidence::numeric AS population_confidence,
       p.census_at AS population_at,
       round(100.0 * l.landed_lots / nullif(p.universe_total, 0), 2) AS landed_of_population,
       coalesce((p.raw_response ->> 'targets_are_lots')::boolean, true) AS targets_are_lots
FROM base b
LEFT JOIN lan l ON l.nslug = b.nslug
LEFT JOIN pop p ON p.nslug = b.nslug
ORDER BY b.total_targets DESC, l.landed_lots DESC NULLS LAST;

COMMIT;
