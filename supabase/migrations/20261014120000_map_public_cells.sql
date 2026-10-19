-- mv_map_public_cells: the location-observation grid that map-vehicles draws its clusters and month histogram from,
-- public, undeleted vehicles only.
--
-- Measured on production 2026-10-14 (EXPLAIN ANALYZE, BUFFERS): map-vehicles reads vehicle_location_observations
-- over a direct database connection, so no row policy applies, and its only vehicle test was that the row exists.
-- 43,501 non-public vehicles have 44,136 observations at confidence >= 0.7; zoomed in, the points mode returned
-- each one's id, year, make, model, sale price, photo and location text to anyone. Zoomed out, the /atlas default
-- view (continental bbox, zoom 5, confidence 0.7) clusters 121,353 observations: 15.8 s with the existence join,
-- 36-46 s once the join also requires is_public and deleted_at IS NULL (121k probes into vehicles), 32 s as a hash
-- join on idx_vehicles_public_cohort_probe (208k heap fetches). The function's 15 s statement_timeout never applied
-- (SET LOCAL outside a transaction), so every call died at the pooler's ~10.5 s (500, 57014).
--
-- This fold holds one row per 0.01-degree cell, month, confidence band, source and event type, with the coarser
-- 0.1- and 1-degree cells each row belongs to, computed from the raw coordinates the way the live query rounds
-- them (so a cluster at any precision sums exactly the observations the live query would put there). The confidence
-- band compares in real, as the live query's untyped parameter does against the real column (6 rows sit at exactly
-- 0.7). The base filter is the live query's lowest band, confidence >= 0.5. Months are UTC, as the live histogram's
-- are (the sessions run in UTC).
-- map-vehicles reads it for a cluster or histogram request with no time, source, event type or vehicle filter and a
-- confidence of 0.5 or 0.7; any other request, and every zoomed-in point request, reads the live tables with the
-- public test. The bbox is applied at 0.01 degrees: a point within 0.005 degrees of the edge can fall either way.
--
-- Refresh: public.refresh_map_public_cells(), concurrently once populated, every 6 hours at :25 (job
-- map-public-cells-refresh) plus a one-shot now that unschedules itself before it runs. Its clock is
-- mv_map_public_cells_clock, refreshed with it; map-vehicles reports it as meta.cells_as_of. Planned on production:
-- a parallel hash join of 353,688 usable observations with the public ids from idx_vehicles_public_cohort_probe,
-- about 104k groups. Readable only by the service role (and its owner, the function's connection).
-- Contract: supabase/sql/test_map_public_cells.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_map_public_cells AS
SELECT
  round(vlo.longitude::numeric, 0)::float8 AS lng0,
  round(vlo.latitude::numeric, 0)::float8 AS lat0,
  round(vlo.longitude::numeric, 1)::float8 AS lng1,
  round(vlo.latitude::numeric, 1)::float8 AS lat1,
  round(vlo.longitude::numeric, 2)::float8 AS lng2,
  round(vlo.latitude::numeric, 2)::float8 AS lat2,
  to_char(date_trunc('month', vlo.observed_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
  vlo.confidence >= 0.7::real AS conf70,
  coalesce(vlo.source_platform, '') AS source_platform,
  vlo.source_type,
  count(*)::int AS n,
  sum(vlo.confidence::double precision) AS confidence_sum
FROM public.vehicle_location_observations vlo
JOIN public.vehicles v ON v.id = vlo.vehicle_id AND v.is_public AND v.deleted_at IS NULL
WHERE vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL AND vlo.confidence >= 0.5::real
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
WITH NO DATA;

-- one row per key: what REFRESH ... CONCURRENTLY needs, and the bbox scan's index (lat2, lng2 lead)
CREATE UNIQUE INDEX IF NOT EXISTS mv_map_public_cells_key
  ON public.mv_map_public_cells (lat2, lng2, lat1, lng1, lat0, lng0, month, conf70, source_platform, source_type);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_map_public_cells_clock AS
SELECT now() AS refreshed_at
WITH NO DATA;

COMMENT ON MATERIALIZED VIEW public.mv_map_public_cells IS
  'Location observations of public, undeleted vehicles at confidence >= 0.5, counted per 0.01-degree cell (with its 0.1- and 1-degree cells, rounded from the raw coordinates), UTC month, confidence >= 0.7 band, source and event type. map-vehicles reads it for unfiltered clusters and histograms. Refreshed by refresh_map_public_cells(); clock in mv_map_public_cells_clock. 20261014120000.';
COMMENT ON MATERIALIZED VIEW public.mv_map_public_cells_clock IS
  'When mv_map_public_cells was last refreshed (refresh_map_public_cells refreshes both). 20261014120000.';

REVOKE ALL ON public.mv_map_public_cells, public.mv_map_public_cells_clock FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mv_map_public_cells, public.mv_map_public_cells_clock TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_map_public_cells()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- concurrently once populated, so map reads keep reading; the first fill must be plain
  IF (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_map_public_cells'::regclass) THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_map_public_cells;
  ELSE
    REFRESH MATERIALIZED VIEW public.mv_map_public_cells;
  END IF;
  REFRESH MATERIALIZED VIEW public.mv_map_public_cells_clock;
END
$function$;
REVOKE ALL ON FUNCTION public.refresh_map_public_cells() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_map_public_cells() TO service_role;

SELECT cron.schedule(
  'map-public-cells-refresh',
  '25 */6 * * *',
  $job$SET statement_timeout = '10min'; SELECT public.refresh_map_public_cells();$job$
);
-- The first fill now. The one-shot removes itself before it refreshes, so a failure is logged once, not every minute.
SELECT cron.schedule(
  'map-public-cells-fill-once-20261014',
  '* * * * *',
  $once$SELECT cron.unschedule('map-public-cells-fill-once-20261014'); SET statement_timeout = '10min'; SELECT public.refresh_map_public_cells();$once$
);

COMMIT;
