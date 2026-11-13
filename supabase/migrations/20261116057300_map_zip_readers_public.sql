-- map_zip_counts and map_zip_activity read as any visitor sees, without per-row policy calls.
--
-- Both ran SECURITY INVOKER, so every row of vehicle_location_observations and vehicles went through the
-- tables' access policies (vehicle_listing_viewer_tied, vehicle_user_has_access). Measured 2026-11-13 on
-- Clark County (32003) with EXPLAIN ANALYZE: signed in as the owner both exceeded the 60 s probe limit;
-- logged out map_zip_counts took 292 ms and map_zip_activity 6,685 ms; as the owner role (no policies)
-- 0.4-1 s. The owner's phone logged map_zip_activity at 15,093 ms (edge logs 2026-11-13 03:09Z).
--
-- They now run as their owner with the logged-out policy written as set filters: an observation with
-- confidence >= 0.5 that is not a private sighting, on a public vehicle that is not deleted (the
-- "Public read high confidence observations" policy's anon branch; vehicles' anon branch is is_public).
-- auction_events is readable by anon and authenticated without condition. Bodies otherwise unchanged.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.map_zip_counts(p_fips text[], p_make text DEFAULT NULL::text)
 RETURNS TABLE(county_fips text, zip text, make text, vehicles bigint)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT o.county_fips,
         substring(btrim(o.postal_code) FROM 1 FOR 5) AS zip,
         min(btrim(v.make)) AS make,
         count(DISTINCT v.id) AS vehicles
  FROM public.vehicle_location_observations o
  JOIN public.vehicles v ON v.id = o.vehicle_id
  WHERE o.county_fips = ANY (p_fips)
    AND o.county_fips IS NOT NULL
    AND o.confidence >= 0.5
    AND o.source_type <> 'sighting'
    AND v.is_public = true
    AND v.deleted_at IS NULL
    AND coalesce(v.status, '') NOT IN ('deleted', 'merged', 'rejected', 'duplicate')
    AND btrim(o.postal_code) ~ '^[0-9]{5}(-[0-9]{4})?$'
    AND (p_make IS NULL OR lower(btrim(v.make)) = lower(btrim(p_make)))
  GROUP BY o.county_fips, substring(btrim(o.postal_code) FROM 1 FOR 5), lower(nullif(btrim(v.make), ''))
$function$;

CREATE OR REPLACE FUNCTION public.map_zip_activity(p_fips text[], p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_make text DEFAULT NULL::text)
 RETURNS TABLE(county_fips text, zip text, make text, windowed bigint, sold_24h bigint, listed_24h bigint, fresh_24h bigint)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '15s'
AS $function$
  WITH b AS (
    SELECT now() AS t,
           now() - interval '24 hours' AS d1,
           CASE WHEN p_start IS NOT NULL AND p_end IS NOT NULL AND p_end > p_start THEN p_start END AS ws,
           CASE WHEN p_start IS NOT NULL AND p_end IS NOT NULL AND p_end > p_start THEN p_end END AS we
  ),
  ev AS MATERIALIZED (
    SELECT x.vehicle_id, x.in_window, x.sold_new, x.listed_new
    FROM (
      SELECT e.vehicle_id,
             coalesce(e.auction_end_date >= b.ws AND e.auction_end_date < b.we, false) AS in_window,
             (e.outcome = 'sold' AND e.auction_end_date >= b.d1 AND e.auction_end_date <= b.t) AS sold_new,
             (e.outcome = 'live' AND e.auction_end_date > b.t AND e.created_at >= b.d1) AS listed_new
      FROM public.auction_events e, b
      WHERE e.duplicate_of IS NULL
        AND e.vehicle_id IS NOT NULL
        AND e.auction_end_date >= least(coalesce(b.ws, b.d1), b.d1)
    ) x
    WHERE x.in_window OR x.sold_new OR x.listed_new
  ),
  loc AS (
    SELECT DISTINCT o.vehicle_id, o.county_fips,
           substring(btrim(o.postal_code) FROM 1 FOR 5) AS zip
    FROM public.vehicle_location_observations o
    WHERE o.vehicle_id IN (SELECT vehicle_id FROM ev)
      AND o.county_fips = ANY (p_fips)
      AND o.confidence >= 0.5
      AND o.source_type <> 'sighting'
      AND btrim(o.postal_code) ~ '^[0-9]{5}(-[0-9]{4})?$'
  )
  SELECT loc.county_fips,
         loc.zip,
         min(btrim(v.make)) AS make,
         count(DISTINCT ev.vehicle_id) FILTER (WHERE ev.in_window) AS windowed,
         count(DISTINCT ev.vehicle_id) FILTER (WHERE ev.sold_new) AS sold_24h,
         count(DISTINCT ev.vehicle_id) FILTER (WHERE ev.listed_new) AS listed_24h,
         count(DISTINCT ev.vehicle_id) FILTER (WHERE ev.sold_new OR ev.listed_new) AS fresh_24h
  FROM ev
  JOIN loc ON loc.vehicle_id = ev.vehicle_id
  JOIN public.vehicles v ON v.id = ev.vehicle_id
  WHERE v.deleted_at IS NULL
    AND v.is_public = true
    AND coalesce(v.status, '') NOT IN ('deleted', 'merged', 'rejected', 'duplicate')
    AND (p_make IS NULL OR lower(btrim(v.make)) = lower(btrim(p_make)))
  GROUP BY loc.county_fips, loc.zip, lower(nullif(btrim(v.make), ''))
$function$;
