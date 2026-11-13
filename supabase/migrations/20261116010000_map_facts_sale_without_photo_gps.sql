-- map_facts sale fold: photo GPS never places a sale.
--
-- WHY. 20261116005000 ranked photo GPS rows (source_type exif, admit_photo_gps_locations) after every other observation
-- when placing a sale, but still used one when nothing else placed the vehicle. The fact is written under the sale's
-- own platform (bat, mecum...), not photo_exif, so a sale would be counted silently in the county where the car was
-- photographed: the holder's place, not where it was offered. Measured 2026-11-12: 44 of the 111 vehicles with photo
-- areas have no other county or ZCTA location; 0 of them have a sold event yet, so no live fact changes today.
-- WHAT. fold_map_facts_sale reads no exif row; such a sale stays unplaced, as it was before photo rows existed. The
-- vehicle fold is unchanged: there photo rows place the vehicle under their own facet, source_platform photo_exif.
-- The body is otherwise the live definition (md5 checked below). Contract: supabase/sql/test_map_facts_photo_location.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE s text;
BEGIN
  s := pg_get_functiondef('public.fold_map_facts_sale(date,date,timestamptz)'::regprocedure);
  IF md5(s) <> 'd2dda2e332eefc482386cee6b31b9877' AND position('sale_place_without_photo_gps_v1' in s) = 0 THEN
    RAISE EXCEPTION 'fold_map_facts_sale drifted from 20261116005000; review current definition';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.fold_map_facts_sale(p_from date, p_to date, p_as_of timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from timestamptz := p_from::timestamp AT TIME ZONE 'UTC';
  v_to   timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
BEGIN
  -- location_confidence_floor_v1: observations under the 0.50 floor never place a sale.
  -- sale_place_without_photo_gps_v1: photo GPS (exif) never places a sale. A sale's place is where it was offered;
  -- where the car was photographed is the holder's place, and would be counted under the sale's platform.
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
      AND coalesce(o.confidence, 1) >= 0.5 AND o.source_type IS DISTINCT FROM 'exif'
    ORDER BY (o.source_url IS NOT DISTINCT FROM s.source_url AND s.source_url IS NOT NULL) DESC,
             (o.source_platform IS NOT DISTINCT FROM s.source_platform) DESC,
             o.observed_at DESC
    LIMIT 1
  ) loc ON true;
  RETURN public.map_facts_write_layer('sale', p_from, p_to, ARRAY['state', 'county', 'zcta'], false, p_as_of);
END
$function$;

REVOKE ALL ON FUNCTION public.fold_map_facts_sale(date, date, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fold_map_facts_sale(date, date, timestamptz) TO service_role;

COMMIT;
