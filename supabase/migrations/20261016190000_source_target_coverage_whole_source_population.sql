-- source_target_coverage: only whole-source census rows count as the population (2026-10-15).
-- Other lanes now write scoped rows into source_census: per-day counts for Collecting Cars (cars published that UTC day:
-- 49, 21, 92 ...) and the Mecum active-sales roster (2,407 lots in sales ending after the read). The view took the newest row
-- per source as the population, so Collecting Cars read 614 landed against 49 (1,250%) and Mecum 158k against 2,407.
-- Convention, now in the view and its comment: a row is a population row when universe_total IS NULL (an 'unknown' marker)
-- or universe_historical IS NOT NULL (the whole source, history included). A scoped row (a day, an active roster) leaves
-- universe_historical NULL and sets universe_total or universe_active as it needs. All earlier population rows set both.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE VIEW public.source_target_coverage AS
WITH pop AS (
  SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[-_]', '', 'g'))
         regexp_replace(lower(o.slug), '[-_]', '', 'g') AS nslug, o.slug,
         c.universe_total, c.census_method, c.census_confidence, c.census_at, c.raw_response
  FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
  WHERE c.universe_total IS NULL OR c.universe_historical IS NOT NULL
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


COMMENT ON VIEW public.source_target_coverage IS
  'Per source. landed/landed_pct: targets in source_targets (an older pull, not the population) with a vehicle_events row. landed_lots: distinct http(s) event URLs of the source, targeted or not. population, population_method, population_confidence, population_at: the latest whole-source source_census row (universe_total NULL = unknown, or universe_historical NOT NULL); scoped rows (a day, an active roster: universe_historical NULL) are ignored. landed_of_population = landed_lots / population as a percent, null when unknown, above 100 when the census undercounts. targets_are_lots false = source_targets rows are not lots (landed_pct null). event_urls_without_target is denominator drift. Landed numbers are as of landed_measured_at.';
COMMIT;
