-- vehicle_location_observations: key county_fips from the observation's point when it has no ZIP.
--
-- WHY. The county key (20261007213000) reads only a five-digit ZIP. Facebook Marketplace shows "City, ST" and no ZIP, so
-- its rows (city-grain point from city_geocode_lookup since 2026-10-19) carry no county and the county map counts none
-- of them: on 2026-10-19 16:50Z, facebook_marketplace 1,820 rows in two days, 0 with county_fips (bat 5,461 of 6,486,
-- craigslist 1,229 of 1,494). 17,984 rows of every source have a point and no county.
-- Point-in-county was the original coder (scripts/geocode-backfill.mjs, 337,576 rows through 2026-03-29); this restores it
-- in the database for rows the ZIP key cannot reach. ZIP still wins when present.
--
-- WHAT.
--   1. key_vehicle_location_county(): ZIP through zip_to_fips as before; otherwise, with latitude and longitude, the
--      us_county_boundaries row whose geom covers the point (GIST idx_county_boundaries_geom). metadata.county_key records
--      {method point_in_county, grain <the row's precision, default point>, at, writer}. A point in no county (offshore,
--      outside the US) leaves the row as written; never raises.
--   2. trg_key_vehicle_location_county fires on INSERT or UPDATE OF postal_code, region_code, latitude, longitude, for an
--      uncoded row with a US ZIP and state, or with a point.
--   3. key_vehicle_location_county_from_point(p_batch): the back-fill writer for uncoded rows with a point and no usable
--      ZIP, same shape as key_vehicle_location_county_from_zip (service_role, receipted, SKIP LOCKED, idempotent).
--
-- LIMITS. A city-grain point (Facebook) is the city's centroid: a city spanning counties gets the county of its centroid.
--   The grain is recorded, so readers can tell a point-keyed city from a ZIP-keyed address.
-- ASSAY. select count(*) from vehicle_location_observations o where county_fips is null and latitude is not null
--   and created_at < now() - interval '1 day' and exists (select 1 from us_county_boundaries c
--   where ST_Covers(c.geom, ST_SetSRID(ST_MakePoint(o.longitude::float8, o.latitude::float8), 4326)))  -- 0 after back-fill.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.key_vehicle_location_county()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_zip    text := CASE WHEN NEW.postal_code ~ '^[0-9]{5}(-[0-9]{4})?$' AND NEW.region_code ~ '^[A-Z]{2}$'
                        THEN left(NEW.postal_code, 5) END;
  v_fips   text;
  v_name   text;
  v_key    jsonb;
BEGIN
  IF v_zip IS NOT NULL THEN
    SELECT c.fips, c.name INTO v_fips, v_name
    FROM public.zip_to_fips z
    JOIN public.us_county_boundaries c ON c.fips = z.fips
    WHERE z.zip = v_zip;
    IF v_fips IS NOT NULL THEN
      v_key := jsonb_build_object('method', 'zip_to_fips', 'zip', v_zip, 'grain', 'zip');
    END IF;
  END IF;

  IF v_fips IS NULL AND NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    SELECT c.fips, c.name INTO v_fips, v_name
    FROM public.us_county_boundaries c
    WHERE ST_Covers(c.geom, ST_SetSRID(ST_MakePoint(NEW.longitude::float8, NEW.latitude::float8), 4326))
    LIMIT 1;
    IF v_fips IS NOT NULL THEN
      v_key := jsonb_build_object('method', 'point_in_county', 'grain', coalesce(NEW.precision, 'point'));
    END IF;
  END IF;

  IF v_fips IS NOT NULL THEN
    NEW.county_fips := v_fips;
    NEW.county_name := v_name;
    NEW.metadata := CASE WHEN NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) = 'object'
                         THEN coalesce(NEW.metadata, '{}'::jsonb)
                         ELSE jsonb_build_object('prior', NEW.metadata) END
                    || jsonb_build_object('county_key', v_key || jsonb_build_object(
                         'at', now(), 'writer', 'trg_key_vehicle_location_county'));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_key_vehicle_location_county ON public.vehicle_location_observations;
CREATE TRIGGER trg_key_vehicle_location_county
BEFORE INSERT OR UPDATE OF postal_code, region_code, latitude, longitude ON public.vehicle_location_observations
FOR EACH ROW
WHEN (NEW.county_fips IS NULL AND (
  (NEW.postal_code ~ '^[0-9]{5}(-[0-9]{4})?$' AND NEW.region_code ~ '^[A-Z]{2}$')
  OR (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL)))
EXECUTE FUNCTION public.key_vehicle_location_county();

COMMENT ON FUNCTION public.key_vehicle_location_county() IS
'BEFORE INSERT OR UPDATE OF postal_code, region_code, latitude, longitude trigger function on vehicle_location_observations (trigger trg_key_vehicle_location_county; migrations 20261007213000, 20261020003000). For a row with no county_fips: a five-digit US postal code with a two-letter state code is looked up through zip_to_fips joined to us_county_boundaries (metadata.county_key {method zip_to_fips, zip, grain zip}); otherwise a row with latitude and longitude takes the us_county_boundaries county whose geom covers the point (GIST; {method point_in_county, grain = the row''s precision}). Sets county_fips, county_name and metadata.county_key {..., at, writer}. No match leaves the row as written; never raises. Back-fill: key_vehicle_location_county_from_zip() and key_vehicle_location_county_from_point().';
COMMENT ON TRIGGER trg_key_vehicle_location_county ON public.vehicle_location_observations IS
'Keys county_fips and county_name at insert (and when the postal code, state or point of an uncoded row changes): from the ZIP when there is one, else from the point; see key_vehicle_location_county(). Fires only when county_fips is NULL.';

CREATE OR REPLACE FUNCTION public.key_vehicle_location_county_from_point(p_batch integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_writer      constant text := 'key_vehicle_location_county_from_point';
  v_prev_writer text := current_setting('app.writer', true);
  v_started     timestamptz := clock_timestamp();
  v_keyed       integer := 0;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'key_vehicle_location_county_from_point: p_batch must be between 1 and 10000, got %', p_batch
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.writer', c_writer, true);

  -- Only rows whose point lies in a county enter the batch, so a point in no county never blocks the walk.
  WITH pick AS (
    SELECT o.id, c.fips, c.name, coalesce(o.precision, 'point') AS grain
    FROM public.vehicle_location_observations o
    JOIN LATERAL (
      SELECT b.fips, b.name FROM public.us_county_boundaries b
      WHERE ST_Covers(b.geom, ST_SetSRID(ST_MakePoint(o.longitude::float8, o.latitude::float8), 4326))
      LIMIT 1
    ) c ON true
    WHERE o.county_fips IS NULL
      AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL
      AND NOT (o.postal_code ~ '^[0-9]{5}(-[0-9]{4})?$' AND o.region_code ~ '^[A-Z]{2}$'
               AND EXISTS (SELECT 1 FROM public.zip_to_fips z WHERE z.zip = left(o.postal_code, 5)))
    LIMIT p_batch
    FOR UPDATE OF o SKIP LOCKED
  ), upd AS (
    UPDATE public.vehicle_location_observations o
    SET county_fips = p.fips,
        county_name = p.name,
        metadata    = CASE WHEN o.metadata IS NULL OR jsonb_typeof(o.metadata) = 'object'
                           THEN coalesce(o.metadata, '{}'::jsonb)
                           ELSE jsonb_build_object('prior', o.metadata) END
                      || jsonb_build_object('county_key', jsonb_build_object(
                           'method', 'point_in_county', 'grain', p.grain, 'at', now(), 'writer', c_writer))
    FROM pick p
    WHERE p.id = o.id
    RETURNING 1
  )
  SELECT count(*) INTO v_keyed FROM upd;

  IF v_keyed > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('vehicle_location_observations', 'UPDATE', v_keyed, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object('keyed', v_keyed, 'batch', p_batch,
                            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;

REVOKE ALL ON FUNCTION public.key_vehicle_location_county_from_point(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.key_vehicle_location_county_from_point(integer) TO service_role;

COMMENT ON FUNCTION public.key_vehicle_location_county_from_point(integer) IS
'Sanctioned back-fill writer for vehicle_location_observations.county_fips from the point (migration 20261020003000): takes up to p_batch (1..10000, default 2000) uncoded rows with latitude and longitude and no ZIP the ZIP key can use, and keys each to the us_county_boundaries county covering its point, setting county_fips, county_name and metadata.county_key {method point_in_county, grain = the row''s precision, at, writer}; the same rule as trigger trg_key_vehicle_location_county. Only rows whose point lies in a county are taken, so points outside every county never stall the walk. One write_receipts row per call; app.writer set for the call and restored. SECURITY DEFINER, EXECUTE for service_role only. Run by hand through scripts/data/q.sh until keyed = 0 (17,984 rows with a point and no county on 2026-10-19 16:50Z).';

UPDATE public.pipeline_registry
SET write_via = write_via || ' Since migration 20261020003000 the trigger also keys rows with no ZIP from their point (point_in_county), back-filled by key_vehicle_location_county_from_point().',
    updated_at = now()
WHERE table_name = 'vehicle_location_observations' AND column_name = 'county_fips'
  AND write_via NOT LIKE '%key_vehicle_location_county_from_point%';

COMMIT;
