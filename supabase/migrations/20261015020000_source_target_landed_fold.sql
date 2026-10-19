-- Intake coverage meter: count source_targets that have a landed vehicle_events row.
-- The old view counted only import_queue.status flips, which most writers never make.
-- Match key: platform-specific id where the URL shape varies (mecum lot id, bonhams auction+lot),
-- otherwise the URL with scheme, www, query, fragment and trailing slash removed.
-- The match cannot run inside the 10 s view timeout, so it is stored in a matview
-- refreshed by pg_cron, like mv_events_by_platform.
SET statement_timeout = '600s';
SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.source_target_key(url text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN url ~* 'mecum\.com/lots/[0-9]+' THEN 'mecum:' || substring(url FROM '(?i)mecum\.com/lots/([0-9]+)')
    WHEN url ~* 'bonhams\.com/auction/[0-9]+/lot/[0-9]+' THEN 'bonhams:' || substring(url FROM '(?i)bonhams\.com/auction/([0-9]+/lot/[0-9]+)')
    ELSE regexp_replace(lower(url), '^https?://(www\.)?|[?#].*$|/+$', '', 'g')
  END
$$;

CREATE MATERIALIZED VIEW public.mv_source_target_landed AS
WITH t AS (
  SELECT source_slug, regexp_replace(lower(source_slug), '[-_]', '', 'g') AS nslug,
         public.source_target_key(listing_url) AS k
  FROM public.source_targets
), e AS (
  SELECT regexp_replace(lower(source_platform), '[-_ ]', '', 'g') AS nplat,
         public.source_target_key(source_url) AS k
  FROM public.vehicle_events
  WHERE source_url IS NOT NULL
), tk AS (SELECT DISTINCT k FROM t), ek AS (SELECT DISTINCT k FROM e),
landed AS (
  SELECT t.source_slug, t.nslug, count(DISTINCT t.k) AS landed
  FROM t JOIN ek ON ek.k = t.k GROUP BY 1, 2
), drift AS (
  SELECT e.nplat, count(DISTINCT e.k) AS event_urls,
         count(DISTINCT e.k) FILTER (WHERE tk.k IS NULL) AS event_urls_without_target
  FROM e LEFT JOIN tk ON tk.k = e.k GROUP BY 1
)
SELECT coalesce(l.source_slug, d.nplat) AS source_slug,
       coalesce(l.landed, 0) AS landed,
       coalesce(d.event_urls, 0) AS event_urls,
       coalesce(d.event_urls_without_target, 0) AS event_urls_without_target,
       now() AS measured_at
FROM (SELECT s.source_slug, s.nslug, coalesce(l.landed, 0) AS landed
      FROM (SELECT DISTINCT source_slug, nslug FROM t) s
      LEFT JOIN landed l USING (source_slug, nslug)) l
FULL JOIN drift d ON d.nplat = l.nslug;

CREATE UNIQUE INDEX mv_source_target_landed_slug ON public.mv_source_target_landed (source_slug);

CREATE OR REPLACE VIEW public.source_target_coverage AS
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
       max(m.measured_at) AS landed_measured_at
FROM public.source_targets st
LEFT JOIN public.import_queue iq ON iq.listing_url = st.listing_url
LEFT JOIN public.mv_source_target_landed m ON m.source_slug = st.source_slug
GROUP BY st.source_slug
ORDER BY count(*) DESC;

COMMENT ON VIEW public.source_target_coverage IS
  'Per source: known targets, import_queue status counts, and landed = distinct targets with a vehicle_events row (key: source_target_key). landed and event_* come from mv_source_target_landed, refreshed every 30 min; landed_measured_at is its date. event_urls_without_target is denominator drift.';

SELECT cron.schedule('refresh-source-target-landed', '12,42 * * * *',
  $c$SET statement_timeout = '300s'; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_source_target_landed;$c$);
