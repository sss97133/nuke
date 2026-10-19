-- vehicle_map_county_listings: new listings per county, source and day, the measure of the one county map.
--
-- WHY. The owner wants one map, the county map, counting listings (2026-10-19). The county map's data
-- (vehicle_map_county_data) counts every located vehicle with its sold value, and its refresh job refresh-geo-analysis is
-- inactive. A listing count computed at page time joins every located vehicle to vehicles for the public test: on
-- 2026-10-19 a 3-day window took 5.2 s for 2,092 lookups (1,411 pages read from disk), so 30 days cannot be read live.
--
-- WHAT. A materialized view, one row per (county, source platform, UTC day): the vehicles whose first listing location
-- observation in the last 30 days falls on that day in that county (source_type 'listing', county_fips keyed by
-- trg_key_vehicle_location_county from the ZIP or the point), public and undeleted only, with how many carry an asking
-- price and their sum. "Listings" over a window = the sum of its days: each vehicle counts once, on the day it was first
-- seen listed. 30 days bounds the refresh: on 2026-10-19 the 60-day input was 58,393 vehicles, each a vehicles lookup on a
-- disk-bound database. refresh_vehicle_map_county_listings() rebuilds it (concurrently once populated); cron hourly at :40.
-- Read by map-vehicles (mode=county|state, event_type=listing). Created WITH NO DATA: the first cron run fills it.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE MATERIALIZED VIEW IF NOT EXISTS public.vehicle_map_county_listings AS
WITH first_listing AS (
  SELECT DISTINCT ON (o.vehicle_id)
         o.vehicle_id, o.county_fips AS fips, o.source_platform, (o.observed_at AT TIME ZONE 'UTC')::date AS day
  FROM public.vehicle_location_observations o
  WHERE o.source_type = 'listing'
    AND o.county_fips ~ '^[0-9]{5}$'
    AND o.vehicle_id IS NOT NULL
    AND o.observed_at >= now() - interval '30 days'
  ORDER BY o.vehicle_id, o.observed_at
)
SELECT f.fips,
       coalesce(f.source_platform, 'unknown') AS source_platform,
       f.day,
       count(*)::integer AS listings,
       count(v.asking_price)::integer AS priced,
       sum(v.asking_price)::numeric AS asking_sum,
       now() AS as_of
FROM first_listing f
JOIN public.vehicles v ON v.id = f.vehicle_id AND v.is_public AND v.deleted_at IS NULL
GROUP BY f.fips, coalesce(f.source_platform, 'unknown'), f.day
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_map_county_listings_key
  ON public.vehicle_map_county_listings (fips, source_platform, day);
CREATE INDEX IF NOT EXISTS vehicle_map_county_listings_day
  ON public.vehicle_map_county_listings (day);

COMMENT ON MATERIALIZED VIEW public.vehicle_map_county_listings IS
'New listings per county, source and day (migration 20261020004000), the measure of the county map. Grain: one (fips, source_platform, UTC day). A vehicle counts once, on the day of its first listing location observation (vehicle_location_observations source_type listing with county_fips) in the 30 days before the refresh, in that observation''s county and source; public, undeleted vehicles only. listings = vehicles; priced = those with vehicles.asking_price; asking_sum = their sum (unit: listing currency as recorded, mostly USD, not converted). as_of = refresh time. A window''s listings = the sum over its days. Owner refresh_vehicle_map_county_listings() (cron vehicle-map-county-listings, hourly :40). Reader map-vehicles mode=county|state with event_type=listing.';

CREATE OR REPLACE FUNCTION public.refresh_vehicle_map_county_listings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_populated boolean;
BEGIN
  SELECT relispopulated INTO v_populated FROM pg_class WHERE oid = 'public.vehicle_map_county_listings'::regclass;
  IF v_populated THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.vehicle_map_county_listings;
  ELSE
    REFRESH MATERIALIZED VIEW public.vehicle_map_county_listings;
  END IF;
  RETURN jsonb_build_object('rows', (SELECT count(*) FROM public.vehicle_map_county_listings),
    'concurrent', v_populated, 'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;

REVOKE ALL ON FUNCTION public.refresh_vehicle_map_county_listings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_vehicle_map_county_listings() TO service_role;
REVOKE ALL ON public.vehicle_map_county_listings FROM anon, authenticated;
GRANT SELECT ON public.vehicle_map_county_listings TO service_role;

COMMENT ON FUNCTION public.refresh_vehicle_map_county_listings() IS
'Rebuilds vehicle_map_county_listings (concurrently once populated; the first call fills it). Returns {rows, concurrent, ms}. SECURITY DEFINER, service_role only. Scheduled by cron vehicle-map-county-listings (hourly at :40, statement_timeout 10min). Migration 20261020004000.';

SELECT cron.schedule('vehicle-map-county-listings', '40 * * * *',
  $cron$SET statement_timeout = '10min'; SELECT public.refresh_vehicle_map_county_listings();$cron$);

COMMIT;
