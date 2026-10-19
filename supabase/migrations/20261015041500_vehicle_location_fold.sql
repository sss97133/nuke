-- fold_vehicle_location_from_observation: a location observation fills the vehicle row's empty place columns.
--
-- Measured 2026-10-15 by measure-landing-depth (dry run, 40 lots per source, retained captures vs canonical model):
--   craigslist: city, state and point were in the capture for 40 of 40 lots and in vehicle_location_observations for 26 of 26
--               linked lots, and on the vehicles row for 0 of 26 (the row kept only the town in vehicles.location).
--   carsandbids: city and state in the capture for 40 of 40, in the observations for 40 of 40, on the row for 5 of 40.
--   bat: postal code in the capture for 40 of 40, in the observations for 40 of 40, on the row for 0 of 40.
-- In the 3,000 newest observations: 251 of 251 craigslist, 23 of 26 carsandbids (state) and 2,568 of 2,723 bat (zip) vehicles
-- had the place in an observation and an empty column on the row. The writers (extract-craigslist, extract-cars-and-bids-core,
-- extract-bat-core) record the observation correctly; nothing carried it to the row the profile reads.
--
-- Rule: fill an empty column, never overwrite a value; coordinates only from an observation that located the vehicle to a
-- city or finer (a region-level point is a centroid, not a place). The observation stays the testimony; the row is a fold.
-- fold_vehicle_locations_from_observations(after, limit) is the same rule for rows that arrived before the trigger,
-- walking vehicle_location_observations by id so a caller can resume from the last id it returns.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fold_vehicle_location_from_observation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_point boolean := NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
                     AND COALESCE(NEW."precision", '') NOT IN ('region', 'country');
BEGIN
  UPDATE public.vehicles v
     SET city          = COALESCE(NULLIF(v.city, ''), NULLIF(NEW.city, '')),
         state         = COALESCE(NULLIF(v.state, ''), NULLIF(NEW.region_code, '')),
         zip_code      = COALESCE(NULLIF(v.zip_code, ''), NULLIF(NEW.postal_code, '')),
         gps_latitude  = CASE WHEN v_point THEN COALESCE(v.gps_latitude, NEW.latitude) ELSE v.gps_latitude END,
         gps_longitude = CASE WHEN v_point THEN COALESCE(v.gps_longitude, NEW.longitude) ELSE v.gps_longitude END
   WHERE v.id = NEW.vehicle_id
     AND (   (COALESCE(v.city, '') = ''     AND COALESCE(NEW.city, '') <> '')
          OR (COALESCE(v.state, '') = ''    AND COALESCE(NEW.region_code, '') <> '')
          OR (COALESCE(v.zip_code, '') = '' AND COALESCE(NEW.postal_code, '') <> '')
          OR (v_point AND (v.gps_latitude IS NULL OR v.gps_longitude IS NULL)));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- the observation is the record; a failed fold must never refuse it
  RAISE WARNING 'fold_vehicle_location_from_observation % : %', NEW.id, SQLERRM;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.fold_vehicle_location_from_observation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fold_vehicle_location ON public.vehicle_location_observations;
CREATE TRIGGER trg_fold_vehicle_location
  AFTER INSERT ON public.vehicle_location_observations
  FOR EACH ROW
  WHEN (NEW.vehicle_id IS NOT NULL AND COALESCE(NEW.confidence, 1) >= 0.5)
  EXECUTE FUNCTION public.fold_vehicle_location_from_observation();

CREATE OR REPLACE FUNCTION public.fold_vehicle_locations_from_observations(p_after uuid DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS TABLE (last_id uuid, scanned integer, updated integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH b AS (
    SELECT o.id, o.vehicle_id, o.city, o.region_code, o.postal_code, o.latitude, o.longitude, o."precision", o.observed_at
    FROM public.vehicle_location_observations o
    WHERE o.id > COALESCE(p_after, '00000000-0000-0000-0000-000000000000'::uuid)
      AND o.vehicle_id IS NOT NULL AND COALESCE(o.confidence, 1) >= 0.5
    ORDER BY o.id
    LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  ), s AS (
    SELECT DISTINCT ON (vehicle_id) vehicle_id, city, region_code, postal_code, latitude, longitude,
           (latitude IS NOT NULL AND longitude IS NOT NULL AND COALESCE("precision", '') NOT IN ('region', 'country')) AS has_point
    FROM b
    ORDER BY vehicle_id, observed_at DESC NULLS LAST, id DESC
  ), u AS (
    UPDATE public.vehicles v
       SET city          = COALESCE(NULLIF(v.city, ''), NULLIF(s.city, '')),
           state         = COALESCE(NULLIF(v.state, ''), NULLIF(s.region_code, '')),
           zip_code      = COALESCE(NULLIF(v.zip_code, ''), NULLIF(s.postal_code, '')),
           gps_latitude  = CASE WHEN s.has_point THEN COALESCE(v.gps_latitude, s.latitude) ELSE v.gps_latitude END,
           gps_longitude = CASE WHEN s.has_point THEN COALESCE(v.gps_longitude, s.longitude) ELSE v.gps_longitude END
      FROM s
     WHERE v.id = s.vehicle_id
       AND (   (COALESCE(v.city, '') = ''     AND COALESCE(s.city, '') <> '')
            OR (COALESCE(v.state, '') = ''    AND COALESCE(s.region_code, '') <> '')
            OR (COALESCE(v.zip_code, '') = '' AND COALESCE(s.postal_code, '') <> '')
            OR (s.has_point AND (v.gps_latitude IS NULL OR v.gps_longitude IS NULL)))
    RETURNING 1
  )
  SELECT (SELECT id FROM b ORDER BY id DESC LIMIT 1), (SELECT count(*)::integer FROM b), (SELECT count(*)::integer FROM u);
$$;

REVOKE ALL ON FUNCTION public.fold_vehicle_locations_from_observations(uuid, integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fold_vehicle_location_from_observation() IS
  'Trigger function: a vehicle_location_observations row fills the vehicle''s empty city, state, zip_code and point. Fills only empty columns; a point only from an observation located to a city or finer. Never refuses the observation.';
COMMENT ON FUNCTION public.fold_vehicle_locations_from_observations(uuid, integer) IS
  'Same fold for observations that predate the trigger: scans up to p_limit (max 1000) observations after p_after by id and returns the last id scanned, the rows scanned and the vehicles updated.';

COMMIT;
