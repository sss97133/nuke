-- admit_photo_gps_locations: a vehicle's photo GPS becomes area-grain location observations.
--
-- WHY. A vehicle's own photos carry device GPS, and none of it reached vehicle_location_observations: the only
-- writers were listing extractors (and a 2026-03-10 hand load of 4,165 'sighting' rows). On 2026-11-11 the owner
-- clicked "Boulder City, NV" in a vehicle header and got "Source: None admitted", while 463 of that vehicle's 467
-- photos held GPS. Measured 2026-11-11 over the fleet: 46,557 vehicle_images rows carry latitude/longitude; 14,875 of
-- them are eligible (public, not deleted vehicle; taken_at known; not sensitive, superseded, duplicate, gated or
-- mismatched), on 111 vehicles and 1,110 vehicle-days.
--
-- GRAIN. One row per (vehicle, UTC day of taken_at, area). The area is the county that covers the photo's point
-- (us_county_boundaries, point in polygon) and, when one is near, a city: the nearest city_geocode_lookup centroid in
-- the same state, within 8 km, whose own centroid lies in the same county. The row id is md5(method, vehicle, day,
-- county, lower(city)), so a place never changes under an id, a re-run updates the same rows, and the existing
-- keyers never need to re-fire (county_fips is written, postal_code is not). Photos are placed by their point rounded
-- to 0.001 degree (about 100 m); the area lookup runs once per such cell.
--
-- NO ZIP. The database holds no ZCTA polygons (20261020210000: they are vector tiles in storage, and that migration
-- rules out a point-in-ZCTA fallback). So postal_code and zcta stay NULL here; a ZIP keyer that tests the point
-- against the storage polygons is a separate stage. Precision is 'city' when a city was matched, else 'county'.
--
-- PRIVACY. A car's photo GPS is where its owner lives or works. The public row holds the area only: latitude and
-- longitude are NULL (a centroid there would also be copied into vehicles.gps_latitude/longitude by the fold), and
-- metadata holds counts, the photo clock range and the photo ids (whose coordinates anon cannot read,
-- 20261020190000), never a point, spread or box. Only public, not deleted vehicles are admitted, because the table's
-- anon policy tests confidence, not the vehicle. A point for viewers tied to the vehicle is computed at read time
-- from vehicle_images by the reader, never stored.
--
-- WITHDRAWAL. Nothing is deleted. A run recomputes the set from the photos as they are now; an admitted row that is no
-- longer supported (photo marked sensitive, superseded, duplicate, refiled; vehicle made private or deleted) gets
-- confidence 0, under the 0.50 floor every reader and the anon policy apply, and metadata.withdrawn_at /
-- withdrawn_reason / prior_confidence. If its photos return, the same id is re-admitted with readmitted_at and the
-- earlier withdrawal kept in withdrawn_history.
--
-- THE VEHICLE ROW. fold_vehicle_location_from_observation (and its back-fill twin) fill empty vehicles.city, state,
-- zip_code and gps_* from an observation. Photo-GPS rows are excluded from that fold: a stamp on vehicles cannot be
-- withdrawn when the photo is, and the vehicle row's place is the stated one (listing, owner). The photo rows reach
-- people through the readers.
--
-- RUN. admit_photo_gps_locations(p_vehicle_id) for one vehicle, or with NULL for the fleet (both idempotent),
-- service_role only, receipted in write_receipts. Cron photo-gps-location hourly at :17 with a 60 s statement
-- timeout (the fleet ran about 0.5 s warm and 14 s cold on 2026-11-11); a run that outgrows it fails visibly in
-- v_job_health.
-- Contract: supabase/sql/test_photo_gps_location_admission.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- 1. The area of a point: county by containment, then a nearby city in that county. Always one row.
CREATE OR REPLACE FUNCTION public.photo_gps_area(p_lon double precision, p_lat double precision)
RETURNS TABLE (county_fips text, county_name text, region_code text, city text)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fips text; v_name text; v_usps text; v_city text;
BEGIN
  IF p_lon IS NOT NULL AND p_lat IS NOT NULL THEN
    SELECT b.fips, b.name INTO v_fips, v_name
    FROM public.us_county_boundaries b
    WHERE ST_Covers(b.geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326))
    LIMIT 1;
  END IF;
  IF v_fips IS NOT NULL THEN
    SELECT s.usps INTO v_usps FROM public.us_states s WHERE s.fips = left(v_fips, 2);
    SELECT CASE WHEN g.city = upper(g.city) THEN initcap(btrim(g.city)) ELSE btrim(g.city) END INTO v_city
    FROM public.city_geocode_lookup g
    WHERE g.state = v_usps AND nullif(btrim(g.city), '') IS NOT NULL
      AND g.latitude BETWEEN p_lat - 0.08 AND p_lat + 0.08
      AND g.longitude BETWEEN p_lon - 0.12 AND p_lon + 0.12
      AND ST_DistanceSphere(ST_MakePoint(g.longitude::float8, g.latitude::float8), ST_MakePoint(p_lon, p_lat)) <= 8000
      AND public.map_point_county(g.longitude::float8, g.latitude::float8) = v_fips
    ORDER BY ST_DistanceSphere(ST_MakePoint(g.longitude::float8, g.latitude::float8), ST_MakePoint(p_lon, p_lat)),
             g.sample_size DESC NULLS LAST, g.city
    LIMIT 1;
  END IF;
  RETURN QUERY SELECT v_fips, v_name, v_usps, v_city;
END
$$;
REVOKE ALL ON FUNCTION public.photo_gps_area(double precision, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_gps_area(double precision, double precision) TO service_role;
COMMENT ON FUNCTION public.photo_gps_area(double precision, double precision) IS
'The area of a point for photo-GPS admission (20261116001000): county_fips/county_name of the us_county_boundaries polygon that covers it, its state''s USPS code, and city = the nearest city_geocode_lookup centroid in that state within 8 km whose own centroid is in the same county (NULL when none). Always one row; all NULL outside US counties. service_role only.';

-- 2. The writer.
CREATE OR REPLACE FUNCTION public.admit_photo_gps_locations(p_vehicle_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_method      constant text := 'photo_gps_fold_v1';
  c_writer      constant text := 'admit_photo_gps_locations';
  v_prev_writer text := current_setting('app.writer', true);
  v_started     timestamptz := clock_timestamp();
  v_out         jsonb;
  v_inserted    integer;
  v_updated     integer;
  v_withdrawn   integer;
BEGIN
  PERFORM set_config('app.writer', c_writer, true);
  PERFORM set_config('lock_timeout', '5s', true);

  WITH photos AS MATERIALIZED (
    SELECT i.id, i.vehicle_id, i.taken_at, i.latitude::float8 AS lat, i.longitude::float8 AS lng
    FROM public.vehicle_images i
    JOIN public.vehicles v ON v.id = i.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
    WHERE i.latitude IS NOT NULL AND i.longitude IS NOT NULL AND i.vehicle_id IS NOT NULL
      AND (p_vehicle_id IS NULL OR i.vehicle_id = p_vehicle_id)
      AND i.taken_at IS NOT NULL AND isfinite(i.taken_at)
      AND i.latitude BETWEEN -90 AND 90 AND i.longitude BETWEEN -180 AND 180
      AND NOT (i.latitude = 0 AND i.longitude = 0)
      AND nullif(btrim(i.image_url), '') IS NOT NULL
      AND i.is_sensitive IS NOT TRUE AND i.is_superseded IS NOT TRUE AND i.is_duplicate IS NOT TRUE
      AND (i.vision_gate_status IS NULL OR i.vision_gate_status::text = 'approved')
      AND coalesce(i.image_vehicle_match_status, '') NOT IN ('mismatch', 'unrelated')
  ), cells AS MATERIALIZED (
    SELECT DISTINCT round(p.lat::numeric, 3) AS clat, round(p.lng::numeric, 3) AS clng FROM photos p
  ), cell_area AS MATERIALIZED (
    SELECT c.clat, c.clng, a.county_fips, a.county_name, a.region_code, a.city
    FROM cells c CROSS JOIN LATERAL public.photo_gps_area(c.clng::float8, c.clat::float8) a
  ), placed AS (
    SELECT p.id, p.vehicle_id, p.taken_at, (p.taken_at AT TIME ZONE 'UTC')::date AS utc_day,
           ca.county_fips, ca.county_name, ca.region_code, ca.city
    FROM photos p
    JOIN cell_area ca ON ca.clat = round(p.lat::numeric, 3) AND ca.clng = round(p.lng::numeric, 3)
  ), areas AS MATERIALIZED (
    SELECT md5(concat_ws('|', c_method, pl.vehicle_id, pl.utc_day, pl.county_fips, lower(coalesce(pl.city, ''))))::uuid AS id,
           pl.vehicle_id, pl.utc_day, pl.county_fips, pl.county_name, pl.region_code, pl.city,
           count(*) AS photos, min(pl.taken_at) AS first_at, max(pl.taken_at) AS last_at,
           jsonb_agg(pl.id ORDER BY pl.taken_at, pl.id) AS image_ids
    FROM placed pl
    WHERE pl.county_fips IS NOT NULL
    GROUP BY pl.vehicle_id, pl.utc_day, pl.county_fips, pl.county_name, pl.region_code, pl.city
  ), ins AS (
    INSERT INTO public.vehicle_location_observations AS o
      (id, vehicle_id, source_type, source_platform, observed_at, location_text_clean, country_code, region_code, city,
       county_fips, county_name, "precision", confidence, metadata)
    SELECT a.id, a.vehicle_id, 'exif', 'photo_exif', a.last_at,
           concat_ws(', ', coalesce(a.city, a.county_name), a.region_code), 'US', a.region_code, a.city,
           a.county_fips, a.county_name,
           CASE WHEN a.city IS NULL THEN 'county' ELSE 'city' END,
           CASE WHEN a.city IS NULL THEN 0.8 ELSE 0.7 END,
           jsonb_build_object(
             'method', c_method, 'writer', c_writer, 'utc_day', a.utc_day, 'photos', a.photos,
             'first_taken_at', a.first_at, 'last_taken_at', a.last_at, 'image_ids', a.image_ids,
             'area_key', jsonb_build_object(
               'county', 'point_in_county',
               'city', CASE WHEN a.city IS NULL THEN NULL ELSE 'nearest_city_centroid_8km_same_county' END,
               'cell_degrees', 0.001),
             'admitted_at', now())
    FROM areas a
    ON CONFLICT (id) DO UPDATE
      SET observed_at = EXCLUDED.observed_at,
          confidence  = EXCLUDED.confidence,
          metadata    = EXCLUDED.metadata
                        || jsonb_build_object('admitted_at', coalesce(o.metadata->'admitted_at', EXCLUDED.metadata->'admitted_at'))
                        || CASE WHEN o.metadata ? 'withdrawn_at' THEN jsonb_build_object(
                             'readmitted_at', now(),
                             'withdrawn_history', coalesce(o.metadata->'withdrawn_history', '[]'::jsonb)
                               || jsonb_build_array(jsonb_build_object('withdrawn_at', o.metadata->'withdrawn_at',
                                                                       'readmitted_at', now())))
                           WHEN o.metadata ? 'withdrawn_history' THEN jsonb_build_object(
                             'withdrawn_history', o.metadata->'withdrawn_history',
                             'readmitted_at', o.metadata->'readmitted_at')
                           ELSE '{}'::jsonb END
      WHERE o.source_type = 'exif' AND o.metadata->>'method' = c_method
        AND (o.metadata->'image_ids' IS DISTINCT FROM EXCLUDED.metadata->'image_ids'
             OR o.confidence IS DISTINCT FROM EXCLUDED.confidence
             OR o.observed_at IS DISTINCT FROM EXCLUDED.observed_at
             OR o.metadata ? 'withdrawn_at')
    RETURNING (o.xmax = 0) AS inserted
  ), wd AS (
    UPDATE public.vehicle_location_observations o
       SET confidence = 0,
           metadata = o.metadata || jsonb_build_object(
             'withdrawn_at', now(), 'withdrawn_by', c_writer, 'prior_confidence', o.confidence,
             'withdrawn_reason', 'no eligible photo places the vehicle in this area on this UTC day')
     WHERE o.source_type = 'exif' AND o.metadata->>'method' = c_method
       AND (p_vehicle_id IS NULL OR o.vehicle_id = p_vehicle_id)
       AND o.confidence >= 0.5
       AND NOT EXISTS (SELECT 1 FROM areas a WHERE a.id = o.id)
    RETURNING 1
  )
  SELECT jsonb_build_object(
           'method', c_method,
           'scope', coalesce(p_vehicle_id::text, 'fleet'),
           'photos_eligible', (SELECT count(*) FROM photos),
           'photos_placed', (SELECT count(*) FROM placed WHERE county_fips IS NOT NULL),
           'photos_unplaced_no_us_county', (SELECT count(*) FROM placed WHERE county_fips IS NULL),
           'photos_with_city', (SELECT count(*) FROM placed WHERE city IS NOT NULL),
           'cells', (SELECT count(*) FROM cells),
           'vehicles', (SELECT count(DISTINCT vehicle_id) FROM areas),
           'rows_current', (SELECT count(*) FROM areas)),
         (SELECT count(*) FILTER (WHERE inserted) FROM ins),
         (SELECT count(*) FILTER (WHERE NOT inserted) FROM ins),
         (SELECT count(*) FROM wd)
    INTO v_out, v_inserted, v_updated, v_withdrawn;

  IF v_inserted > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('vehicle_location_observations', 'INSERT', v_inserted, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;
  IF v_updated + v_withdrawn > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('vehicle_location_observations', 'UPDATE', v_updated + v_withdrawn, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);
  RETURN v_out || jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'withdrawn', v_withdrawn,
                                     'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;
REVOKE ALL ON FUNCTION public.admit_photo_gps_locations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_photo_gps_locations(uuid) TO service_role;
COMMENT ON FUNCTION public.admit_photo_gps_locations(uuid) IS
'Admits a vehicle''s photo GPS into vehicle_location_observations (20261116001000): one row per (vehicle, UTC day of taken_at, area), source_type exif, source_platform photo_exif, metadata.method photo_gps_fold_v1. Area = county by point in polygon, plus the nearest city centroid in that county within 8 km (photo_gps_area); precision city or county; confidence 0.7 (city) or 0.8 (county only); latitude, longitude and postal_code NULL (the point never enters the row). observed_at = the day''s last taken_at; metadata carries photos, first/last taken_at, image_ids and the area_key methods. Eligible photos: public, not deleted vehicles; taken_at known; not sensitive, superseded or duplicate; vision gate approved or unset; not a mismatch. Idempotent (id = md5 of method, vehicle, day, area). A row no longer supported is withdrawn (confidence 0, metadata.withdrawn_at), never deleted, and re-admitted under the same id if its photos return. p_vehicle_id NULL = the fleet. service_role only; receipted in write_receipts; cron photo-gps-location.';

-- 3. Photo-GPS rows do not stamp the vehicle row (a stamp could not be withdrawn with its photo).
CREATE OR REPLACE FUNCTION public.fold_vehicle_location_from_observation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_point boolean := NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
                     AND COALESCE(NEW."precision", '') NOT IN ('region', 'country');
BEGIN
  IF NEW.source_type = 'exif' THEN
    RETURN NULL;
  END IF;
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

CREATE OR REPLACE FUNCTION public.fold_vehicle_locations_from_observations(p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 200)
RETURNS TABLE(last_id uuid, scanned integer, updated integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH b AS (
    SELECT o.id, o.vehicle_id, o.city, o.region_code, o.postal_code, o.latitude, o.longitude, o."precision", o.observed_at,
           o.source_type
    FROM public.vehicle_location_observations o
    WHERE o.id > COALESCE(p_after, '00000000-0000-0000-0000-000000000000'::uuid)
      AND o.vehicle_id IS NOT NULL AND COALESCE(o.confidence, 1) >= 0.5
    ORDER BY o.id
    LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  ), s AS (
    SELECT DISTINCT ON (vehicle_id) vehicle_id, city, region_code, postal_code, latitude, longitude,
           (latitude IS NOT NULL AND longitude IS NOT NULL AND COALESCE("precision", '') NOT IN ('region', 'country')) AS has_point
    FROM b
    WHERE source_type IS DISTINCT FROM 'exif'
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
REVOKE ALL ON FUNCTION public.fold_vehicle_location_from_observation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fold_vehicle_locations_from_observations(uuid, integer) FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.vehicle_location_observations.source_type IS
'Kind of observation, text NOT NULL, no CHECK, indexed. listing: a writer or load that parsed a listing''s place. sighting: the photo GPS points of the 2026-03-10 hand load (4,165 rows, exact points; hidden from anon by policy). exif: photo GPS admitted by admit_photo_gps_locations (20261116001000), area grain only (county, city), no point, metadata.method photo_gps_fold_v1; excluded from the vehicle-row fold. The creating migration also listed gps, manual and inferred; none occurs.';

-- 4. Schedule the fleet run.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'photo-gps-location') THEN
      PERFORM cron.unschedule('photo-gps-location');
    END IF;
    PERFORM cron.schedule('photo-gps-location', '17 * * * *',
      $cmd$SET statement_timeout = '60s'; SELECT public.admit_photo_gps_locations(NULL);$cmd$);
  END IF;
END $$;

COMMIT;
