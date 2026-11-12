-- map_facts vehicle and sale folds: honour the 0.50 confidence floor, and rank photo GPS last when placing a sale.
--
-- WHY. admit_photo_gps_locations (20261116001000) added area-grain photo rows (source_type exif) to
-- vehicle_location_observations, 1,461 rows on 111 vehicles on 2026-11-12, and withdraws a row it no longer supports
-- by setting confidence 0. The anon policy, the provenance reader and the vehicle-row fold all apply confidence >= 0.50.
-- Two map folds read every row without that floor:
--   fold_map_facts_vehicle places each public vehicle by its latest observation. A withdrawn photo row (confidence 0)
--     would still place the vehicle, and its "latest" test would hide the vehicle's earlier, admitted place. Photo rows
--     that stand (confidence >= 0.50) are location testimony like any other and keep placing the vehicle; measured
--     2026-11-12 01:29Z, 2 vehicles in map_facts already carried source_platform photo_exif.
--   fold_map_facts_sale places a sale by the observation with the sale's URL, else its platform, else the latest. A
--     sale's place is where it was offered, so a photo row now ranks after every other row; it is used only when nothing
--     else places the vehicle.
-- The listing fold reads source_type = 'listing' only, and get_county_vehicles / get_county_detail require a
-- latitude, which photo rows never carry; neither changes.
-- The bodies are otherwise the live definitions (md5 checked below). Contract:
-- supabase/sql/test_map_facts_photo_location.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text; s text;
BEGIN
  v := pg_get_functiondef('public.fold_map_facts_vehicle(date,date,timestamptz)'::regprocedure);
  s := pg_get_functiondef('public.fold_map_facts_sale(date,date,timestamptz)'::regprocedure);
  IF md5(v) <> '22759bd62652ef3cc42a14bbfbc40452' AND position('location_confidence_floor_v1' in v) = 0 THEN
    RAISE EXCEPTION 'fold_map_facts_vehicle drifted from 20261021143000; review current definition';
  END IF;
  IF md5(s) <> '14c911f74db80c13b26aaf55f1a1f34f' AND position('location_confidence_floor_v1' in s) = 0 THEN
    RAISE EXCEPTION 'fold_map_facts_sale drifted from 20261021143000; review current definition';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.fold_map_facts_vehicle(p_from date, p_to date, p_as_of timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from timestamptz := p_from::timestamp AT TIME ZONE 'UTC';
  v_to   timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
BEGIN
  -- location_confidence_floor_v1: an observation under the 0.50 floor (a withdrawn photo row) neither places a vehicle
  -- nor hides its earlier place.
  CREATE TEMP TABLE IF NOT EXISTS map_fold_entities
    (entity_id uuid, source_platform text, day date, state text, county text, zcta text, value numeric) ON COMMIT DROP;
  TRUNCATE map_fold_entities;
  INSERT INTO map_fold_entities
  SELECT f.vehicle_id, coalesce(f.source_platform, 'unknown'), f.day, coalesce(left(f.county, 2), st.fips), f.county,
         f.zcta, NULL
  FROM (
    SELECT DISTINCT ON (o.vehicle_id) o.vehicle_id, o.source_platform, (o.observed_at AT TIME ZONE 'UTC')::date AS day,
           CASE WHEN o.county_fips ~ '^[0-9]{5}$' THEN o.county_fips END AS county, o.zcta, o.region_code, o.country_code
    FROM public.vehicle_location_observations o
    WHERE o.vehicle_id IS NOT NULL AND coalesce(o.confidence, 1) >= 0.5
      AND o.observed_at >= v_from AND o.observed_at < v_to AND o.observed_at <= p_as_of
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_location_observations p
                      WHERE p.vehicle_id = o.vehicle_id AND p.observed_at > o.observed_at AND p.observed_at <= p_as_of
                        AND coalesce(p.confidence, 1) >= 0.5)
    ORDER BY o.vehicle_id, o.observed_at DESC
  ) f
  JOIN public.vehicles v ON v.id = f.vehicle_id AND v.is_public AND v.deleted_at IS NULL
  LEFT JOIN public.us_states st ON f.county IS NULL AND st.usps = f.region_code AND coalesce(f.country_code, 'US') = 'US';
  RETURN public.map_facts_write_layer('vehicle', p_from, p_to, ARRAY['state', 'county', 'zcta'], false, p_as_of);
END
$function$;

CREATE OR REPLACE FUNCTION public.fold_map_facts_sale(p_from date, p_to date, p_as_of timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from timestamptz := p_from::timestamp AT TIME ZONE 'UTC';
  v_to   timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
BEGIN
  -- location_confidence_floor_v1: observations under the 0.50 floor never place a sale; photo GPS (exif) ranks after
  -- every other observation, since a sale's place is where it was offered.
  CREATE TEMP TABLE IF NOT EXISTS map_fold_entities
    (entity_id uuid, source_platform text, day date, state text, county text, zcta text, value numeric) ON COMMIT DROP;
  TRUNCATE map_fold_entities;
  INSERT INTO map_fold_entities
  SELECT s.vehicle_id, coalesce(s.source_platform, 'unknown'), s.day, left(loc.county, 2), loc.county, loc.zcta, s.final_price
  FROM (
    SELECT DISTINCT ON (e.vehicle_id) e.vehicle_id, e.source_platform, e.source_url, (e.sold_at AT TIME ZONE 'UTC')::date AS day,
           e.final_price
    FROM public.vehicle_events e
    WHERE e.event_status = 'sold' AND e.sold_at IS NOT NULL AND e.vehicle_id IS NOT NULL
      AND e.ended_at >= v_from - interval '7 days' AND e.ended_at < v_to + interval '7 days'
      AND e.sold_at >= v_from AND e.sold_at < v_to AND e.sold_at <= p_as_of
    ORDER BY e.vehicle_id, e.sold_at DESC
  ) s
  JOIN public.vehicles v ON v.id = s.vehicle_id AND v.is_public AND v.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT CASE WHEN o.county_fips ~ '^[0-9]{5}$' THEN o.county_fips END AS county, o.zcta
    FROM public.vehicle_location_observations o
    WHERE o.vehicle_id = s.vehicle_id AND (o.county_fips ~ '^[0-9]{5}$' OR o.zcta IS NOT NULL)
      AND coalesce(o.confidence, 1) >= 0.5
    ORDER BY (o.source_url IS NOT DISTINCT FROM s.source_url AND s.source_url IS NOT NULL) DESC,
             (o.source_platform IS NOT DISTINCT FROM s.source_platform) DESC,
             (o.source_type IS DISTINCT FROM 'exif') DESC,
             o.observed_at DESC
    LIMIT 1
  ) loc ON true;
  RETURN public.map_facts_write_layer('sale', p_from, p_to, ARRAY['state', 'county', 'zcta'], false, p_as_of);
END
$function$;

REVOKE ALL ON FUNCTION public.fold_map_facts_vehicle(date, date, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fold_map_facts_sale(date, date, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fold_map_facts_vehicle(date, date, timestamptz), public.fold_map_facts_sale(date, date, timestamptz) TO service_role;

COMMIT;
