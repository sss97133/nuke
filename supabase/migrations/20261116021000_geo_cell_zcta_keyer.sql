-- geo_cell_zcta: which Census 2020 ZCTA holds each photo-GPS cell, keyed in the database from the map's own county files.
--
-- WHY. admit_photo_gps_locations (20261116001000) places a vehicle's photos at county and city grain. The map's third
-- level is the ZIP (vehicle_location_observations.zcta, us_zctas, 20261020210000), and a photo GPS point is exact, so its
-- ZIP is a point-in-polygon answer, not a guess. 20261020210000 kept the 33,791 ZCTA polygons (130 MB) out of the
-- database; they are served from storage as map-data/geo/v1/county/{fips}.geojson (scripts/map/build-tiles.mjs: every
-- ZCTA touching the county, cb_2020_us_zcta520_500k, GEOID property). This migration keeps that: a county's file is
-- fetched through pg_net, read once with PostGIS, and only the answer per cell is stored. No polygon is kept in a table.
-- No edge function: a new one would be the 232nd against the ~50 target in .claude/rules/edge-functions.md.
--
-- Measured on prod 2026-11-12 (read-only, plus 14 GETs of the public files):
--   06037 (Los Angeles, the largest file in use) arrives through pg_net whole: 677,918 bytes, 200, 304 features, all
--   ST_IsValid. ST_Covers on the 1,435 distinct cells of the 14 counties holding admitted photo rows: 1,430 in one ZCTA,
--   5 in none, 0 in two; identical, cell for cell, to an independent ray-casting pass over the same files.
--
-- WHAT.
--   1. geo_cell_zcta: one row per 0.001-degree cell (the cell centre the photo-GPS writer groups by): county, status,
--      zcta, the number of ZCTA shapes covering the centre, source and method. Geography only: no vehicle, photo or
--      user column. service_role only (a cell is about 100 m, near where a photo was taken).
--      status: pending (not yet tested), keyed (one ZCTA covers the centre), no_zcta (none does: ZCTAs do not cover all
--      land), ambiguous (two or more do after 1:500,000 generalisation; no tie-break is invented, zcta stays NULL),
--      no_source (the county's file could not be read; zcta stays NULL).
--   2. geo_zcta_county_loads: the fetch ledger, one row per county: requested / retry / loaded / failed, the pg_net
--      request id, attempts, HTTP status, feature count, error. A county absent from storage (4xx) or whose body is not
--      a GeoJSON feature collection fails at once; a timeout, 5xx, missing response or an error while keying (a lock
--      timeout, a bad shape) is retried, at most 3 requests, then fails. A failed county's cells become no_source.
--   3. geo_zcta_key_cells(fips, features): the PostGIS test, isolated so a PostGIS-free contract can stand in for it.
--   4. key_geo_cells_zcta(p_max_requests): ingest the responses that arrived (at most 20 county files a run), then
--      request the counties that still have pending cells (a loaded county is fetched again when new cells appear in
--      it; the pg_net body is kept 6 h).
--      admit_photo_gps_locations calls it each run (20261116022000); nothing else schedules it.
-- CONTRACT: supabase/sql/test_photo_gps_zcta.sql (PG17, PostGIS and pg_net stood in).
-- Reversal: DROP FUNCTION public.key_geo_cells_zcta(integer), public.geo_zcta_key_cells(text, jsonb);
--   DROP TABLE public.geo_zcta_county_loads, public.geo_cell_zcta; (after reverting 20261116022000).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.geo_cell_zcta (
  cell_lat    numeric     NOT NULL CHECK (cell_lat BETWEEN -90 AND 90 AND cell_lat = round(cell_lat, 3)),
  cell_lng    numeric     NOT NULL CHECK (cell_lng BETWEEN -180 AND 180 AND cell_lng = round(cell_lng, 3)),
  county_fips text        NOT NULL CHECK (county_fips ~ '^[0-9]{5}$'),
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'keyed', 'no_zcta', 'ambiguous', 'no_source')),
  zcta        text        CHECK (zcta ~ '^[0-9]{5}$'),
  candidates  smallint,
  source      text        NOT NULL DEFAULT 'census_2020_zcta520_500k',
  method      text        NOT NULL DEFAULT 'cell_centre_st_covers',
  created_at  timestamptz NOT NULL DEFAULT now(),
  keyed_at    timestamptz,
  PRIMARY KEY (cell_lat, cell_lng),
  CHECK ((status = 'keyed') = (zcta IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS geo_cell_zcta_pending ON public.geo_cell_zcta (county_fips) WHERE status = 'pending';
ALTER TABLE public.geo_cell_zcta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geo_cell_zcta FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.geo_cell_zcta TO service_role;
COMMENT ON TABLE public.geo_cell_zcta IS
'Which Census 2020 ZCTA holds each 0.001-degree cell centre (grain: one cell; PRIMARY KEY cell_lat, cell_lng). Cells are added pending by admit_photo_gps_locations and keyed by key_geo_cells_zcta from the county''s ZCTA file in storage (map-data/geo/v1/county/{fips}.geojson, cb_2020_us_zcta520_500k) with PostGIS ST_Covers on the cell centre. Precision: the centre of a ~100 m cell tested against 1:500,000 shapes, so a cell within about 100-250 m of a ZCTA line can be keyed to its neighbour. Geography only; service_role only. Migration 20261116021000.';
COMMENT ON COLUMN public.geo_cell_zcta.status IS
'pending: not yet tested. keyed: exactly one ZCTA covers the centre (zcta set). no_zcta: none does. ambiguous: two or more do (zcta NULL, no tie-break). no_source: the county file could not be read (geo_zcta_county_loads.status = failed).';
COMMENT ON COLUMN public.geo_cell_zcta.candidates IS 'How many ZCTA shapes cover the cell centre (0, 1, 2+); NULL while pending or no_source.';

CREATE TABLE IF NOT EXISTS public.geo_zcta_county_loads (
  county_fips  text        PRIMARY KEY CHECK (county_fips ~ '^[0-9]{5}$'),
  status       text        NOT NULL CHECK (status IN ('requested', 'retry', 'loaded', 'failed')),
  request_id   bigint,
  requested_at timestamptz,
  attempts     integer     NOT NULL DEFAULT 0,
  http_status  integer,
  features     integer,
  loaded_at    timestamptz,
  error        text
);
ALTER TABLE public.geo_zcta_county_loads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geo_zcta_county_loads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.geo_zcta_county_loads TO service_role;
COMMENT ON TABLE public.geo_zcta_county_loads IS
'Fetch ledger for key_geo_cells_zcta (grain: one county). requested: a pg_net GET is out (request_id). retry: a timeout, 5xx or no response within 2 h; fetched again next run, at most 3 requests. loaded: the file was read and the county''s pending cells keyed (features = shapes in the file). failed: 4xx, an unreadable body, or 3 failed requests; the county''s cells are no_source. Migration 20261116021000.';

-- The PostGIS test. plpgsql so the body is not parsed until it runs (the contract database has no PostGIS).
CREATE OR REPLACE FUNCTION public.geo_zcta_key_cells(p_county_fips text, p_features jsonb)
RETURNS TABLE (k_lat numeric, k_lng numeric, k_zctas text[])
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH shp AS MATERIALIZED (
    SELECT f->'properties'->>'GEOID' AS zcta, ST_SetSRID(ST_GeomFromGeoJSON(f->'geometry'), 4326) AS g
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_features) = 'array' THEN p_features ELSE '[]'::jsonb END) f
    WHERE f->'properties'->>'GEOID' ~ '^[0-9]{5}$' AND jsonb_typeof(f->'geometry') = 'object'
  ), shp_valid AS MATERIALIZED (
    SELECT s.zcta, CASE WHEN ST_IsValid(s.g) THEN s.g ELSE ST_MakeValid(s.g) END AS g FROM shp s
  )
  SELECT c.cell_lat, c.cell_lng,
         (SELECT array_agg(DISTINCT s.zcta ORDER BY s.zcta) FROM shp_valid s
          WHERE ST_Covers(s.g, ST_SetSRID(ST_MakePoint(c.cell_lng::float8, c.cell_lat::float8), 4326)))
  FROM public.geo_cell_zcta c
  WHERE c.county_fips = p_county_fips AND c.status = 'pending';
END
$$;
REVOKE ALL ON FUNCTION public.geo_zcta_key_cells(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geo_zcta_key_cells(text, jsonb) TO service_role;
COMMENT ON FUNCTION public.geo_zcta_key_cells(text, jsonb) IS
'For each pending geo_cell_zcta cell of the county: the sorted GEOIDs of the GeoJSON features (a county ZCTA file''s features array) whose shape covers the cell centre (PostGIS ST_Covers, SRID 4326; an invalid shape is made valid first); NULL when none does. Reads only. service_role only. Migration 20261116021000.';

CREATE OR REPLACE FUNCTION public.key_geo_cells_zcta(p_max_requests integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_path      constant text := '/storage/v1/object/public/map-data/geo/v1/county/';
  c_attempts  constant integer := 3;
  c_ingest    constant integer := 20;  -- county files read per run; the rest wait (their cells stay pending)
  r           record;
  v_code      integer;
  v_body      text;
  v_timed_out boolean;
  v_err       text;
  v_found     boolean;
  v_terminal  boolean;
  v_doc       jsonb;
  v_n         integer;
  v_loaded    integer := 0;
  v_keyed     integer := 0;
  v_failed    integer := 0;
  v_retry     integer := 0;
  v_requested integer := 0;
  v_no_source integer := 0;
BEGIN
  IF p_max_requests IS NULL OR p_max_requests NOT BETWEEN 0 AND 200 THEN
    RAISE EXCEPTION 'key_geo_cells_zcta: p_max_requests must be between 0 and 200, got %', p_max_requests
      USING ERRCODE = '22023';
  END IF;

  -- 1. Read what arrived.
  FOR r IN SELECT l.county_fips, l.request_id, l.requested_at, l.attempts
           FROM public.geo_zcta_county_loads l WHERE l.status = 'requested'
           ORDER BY l.requested_at LIMIT c_ingest FOR UPDATE SKIP LOCKED LOOP
    SELECT h.status_code, h.content, h.timed_out, h.error_msg, true
      INTO v_code, v_body, v_timed_out, v_err, v_found
      FROM net._http_response h WHERE h.id = r.request_id;
    IF NOT FOUND THEN
      IF r.requested_at < now() - interval '2 hours' THEN
        v_code := NULL; v_err := 'no response within 2 hours';
      ELSE
        CONTINUE;  -- still in flight
      END IF;
    END IF;

    v_terminal := NULL;  -- NULL: keyed; true: the file is unusable; false: try again
    IF v_code = 200 THEN
      BEGIN
        v_doc := v_body::jsonb;
        IF jsonb_typeof(v_doc->'features') IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'the body has no features array';
        END IF;
        UPDATE public.geo_cell_zcta c
           SET zcta       = CASE WHEN cardinality(k.k_zctas) = 1 THEN k.k_zctas[1] END,
               status     = CASE coalesce(cardinality(k.k_zctas), 0) WHEN 0 THEN 'no_zcta' WHEN 1 THEN 'keyed'
                                 ELSE 'ambiguous' END,
               candidates = coalesce(cardinality(k.k_zctas), 0),
               keyed_at   = now()
          FROM public.geo_zcta_key_cells(r.county_fips, v_doc->'features') k
         WHERE c.cell_lat = k.k_lat AND c.cell_lng = k.k_lng AND c.status = 'pending';
        GET DIAGNOSTICS v_n = ROW_COUNT;
        UPDATE public.geo_zcta_county_loads
           SET status = 'loaded', http_status = 200, features = jsonb_array_length(v_doc->'features'),
               loaded_at = now(), error = NULL
         WHERE county_fips = r.county_fips;
        v_loaded := v_loaded + 1; v_keyed := v_keyed + v_n;
      EXCEPTION
        WHEN invalid_text_representation OR raise_exception THEN
          -- Not JSON, or JSON without features: the file itself is unusable.
          v_terminal := true; v_err := 'unreadable body: ' || left(SQLERRM, 200);
        WHEN others THEN
          -- A lock timeout, a geometry error, anything else: counted as a failed attempt, never final at once.
          v_terminal := false; v_err := 'keying failed: ' || left(SQLERRM, 200);
      END;
    ELSIF v_code BETWEEN 400 AND 499 THEN
      v_terminal := true; v_err := 'HTTP ' || v_code;
    ELSE
      -- Timeout, 5xx, transport error or no response.
      v_terminal := false;
      v_err := coalesce(nullif(v_err, ''), CASE WHEN v_timed_out THEN 'timed out' END, 'HTTP ' || coalesce(v_code::text, 'none'));
    END IF;

    IF v_terminal IS NULL THEN
      CONTINUE;
    ELSIF v_terminal OR r.attempts >= c_attempts THEN
      UPDATE public.geo_zcta_county_loads SET status = 'failed', http_status = v_code, error = v_err
       WHERE county_fips = r.county_fips;
      v_failed := v_failed + 1;
    ELSE
      -- Fetch again next step, up to c_attempts requests in all.
      UPDATE public.geo_zcta_county_loads SET status = 'retry', http_status = v_code, error = v_err
       WHERE county_fips = r.county_fips;
      v_retry := v_retry + 1;
    END IF;
  END LOOP;

  -- 2. A failed county's cells, old and new, have no source.
  UPDATE public.geo_cell_zcta c SET status = 'no_source', candidates = NULL, keyed_at = now()
    FROM public.geo_zcta_county_loads l
   WHERE l.county_fips = c.county_fips AND l.status = 'failed' AND c.status = 'pending';
  GET DIAGNOSTICS v_no_source = ROW_COUNT;

  -- 3. Ask for the counties that still have pending cells (oldest first) and no request out.
  FOR r IN SELECT c.county_fips, l.status AS load_status
           FROM public.geo_cell_zcta c
           LEFT JOIN public.geo_zcta_county_loads l ON l.county_fips = c.county_fips
           WHERE c.status = 'pending' AND (l.county_fips IS NULL OR l.status IN ('loaded', 'retry'))
           GROUP BY c.county_fips, l.status
           ORDER BY min(c.created_at), c.county_fips
           LIMIT p_max_requests LOOP
    INSERT INTO public.geo_zcta_county_loads AS l (county_fips, status, request_id, requested_at, attempts)
    VALUES (r.county_fips, 'requested',
            net.http_get(public.get_service_url() || c_path || r.county_fips || '.geojson',
                         timeout_milliseconds => 30000),
            now(), 1)
    ON CONFLICT (county_fips) DO UPDATE
      SET status = 'requested', request_id = EXCLUDED.request_id, requested_at = EXCLUDED.requested_at,
          attempts = CASE WHEN l.status = 'retry' THEN l.attempts + 1 ELSE 1 END, error = NULL;
    v_requested := v_requested + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'counties_loaded', v_loaded, 'cells_keyed', v_keyed, 'counties_failed', v_failed, 'counties_retry', v_retry,
    'cells_no_source', v_no_source, 'counties_requested', v_requested,
    'cells_pending', (SELECT count(*) FROM public.geo_cell_zcta WHERE status = 'pending'),
    'counties_failed_total', (SELECT count(*) FROM public.geo_zcta_county_loads WHERE status = 'failed'));
END
$$;
REVOKE ALL ON FUNCTION public.key_geo_cells_zcta(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.key_geo_cells_zcta(integer) TO service_role;
COMMENT ON FUNCTION public.key_geo_cells_zcta(integer) IS
'Keys pending geo_cell_zcta cells: reads the pg_net responses for requested counties (200 → geo_zcta_key_cells, cells keyed / no_zcta / ambiguous, county loaded; at most 20 a run; 4xx or a body that is not a feature collection → failed; timeout, 5xx, none within 2 h or an error while keying → retry, failed after 3 requests), marks a failed county''s pending cells no_source, then requests up to p_max_requests (0..200, default 25) counties that still have pending cells (map-data/geo/v1/county/{fips}.geojson, 30 s). Returns counts. Called by admit_photo_gps_locations each run. SECURITY DEFINER, service_role only. Migration 20261116021000.';

DO $check$
BEGIN
  IF to_regclass('public.geo_cell_zcta') IS NULL OR to_regclass('public.geo_zcta_county_loads') IS NULL
     OR to_regprocedure('public.key_geo_cells_zcta(integer)') IS NULL
     OR has_table_privilege('anon', 'public.geo_cell_zcta', 'SELECT')
     OR has_function_privilege('anon', 'public.key_geo_cells_zcta(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'geo_cell_zcta keyer not as intended';
  END IF;
END $check$;

COMMIT;
