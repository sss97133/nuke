-- find_images_near_location: only photos that have an image, as every other photo-GPS path already requires.
--
-- WHY. The phone now records metadata-only vehicle_images rows (image_url '', ai_processing_status 'skipped'; the
-- capture change in #3473). 276 rows with a point had a blank image_url on 2026-11-13; one is filed to a vehicle
-- (46e3606f on 5a1deb95). vehicle_location_fold, admit_photo_gps_locations and idx_vehicle_images_gps_cover all
-- require nullif(btrim(image_url), '') IS NOT NULL. This reader did not, so it returned that row as an image near a
-- point: at (35.97236333, -114.855995), 50 m, vehicle 5a1deb95 it returned 114 ids, 1 of them without an image.
-- WHAT. The same test in the WHERE (marker image_url_guard_v1). Body otherwise equal to the live definition (md5
-- a2d4a709b7d21baf6a0054571fdcad55): same signature, return type, language, security (invoker), owner and grants.
-- Contract: supabase/sql/test_find_images_near_location_url_guard.sql (PG17, PostGIS stood in).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $guard$
DECLARE d text := pg_get_functiondef('public.find_images_near_location(numeric,numeric,uuid,integer)'::regprocedure);
BEGIN
 IF md5(d) <> 'a2d4a709b7d21baf6a0054571fdcad55' AND position('image_url_guard_v1' in d) = 0 THEN
   RAISE EXCEPTION 'find_images_near_location drifted from its live definition; review it';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.find_images_near_location(p_latitude numeric, p_longitude numeric, p_vehicle_id uuid, p_max_distance_meters integer DEFAULT 50)
 RETURNS TABLE(image_id uuid, distance_meters numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    vi.id AS image_id,
    ROUND(
      ST_Distance(
        ST_MakePoint(vi.longitude, vi.latitude)::geography,
        ST_MakePoint(p_longitude, p_latitude)::geography
      )::NUMERIC,
      2
    ) AS distance_meters
  FROM vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id
    AND vi.latitude IS NOT NULL
    AND vi.longitude IS NOT NULL
    -- image_url_guard_v1: a metadata-only row (no image) is not an image near the point.
    AND nullif(btrim(vi.image_url), '') IS NOT NULL
    AND ST_DWithin(
      ST_MakePoint(vi.longitude, vi.latitude)::geography,
      ST_MakePoint(p_longitude, p_latitude)::geography,
      p_max_distance_meters
    )
  ORDER BY distance_meters ASC;
END;
$function$;

DO $check$
BEGIN
 IF position('image_url_guard_v1' in pg_get_functiondef('public.find_images_near_location(numeric,numeric,uuid,integer)'::regprocedure)) = 0 THEN
   RAISE EXCEPTION 'find_images_near_location lacks image_url_guard_v1';
 END IF;
END $check$;
COMMIT;
