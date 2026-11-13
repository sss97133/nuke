-- admit_photo_gps_locations keys each photo area by ZIP (zcta); the location fold gives each ZIP area its own point.
--
-- WHY. Photo-GPS rows (20261116001000) stop at county and city, so a vehicle's photos reach the map's county level
-- but not its ZIP level, and two ZIPs of one city fold into one area. 20261116021000 keys every photo cell to its
-- Census 2020 ZCTA (geo_cell_zcta, from the map's own county files, PostGIS ST_Covers on the cell centre). This
-- migration writes that key onto the rows.
--
-- WHAT.
--   1. admit_photo_gps_locations:
--      - each run adds its new cells to geo_cell_zcta (pending) and calls key_geo_cells_zcta(25) before placing photos;
--      - the area adds zcta: one row per (vehicle, UTC day, county, city, zcta), written to the existing
--        vehicle_location_observations.zcta column (20261020210000; indexed; the ZIP-level map fold and readZip read it).
--        postal_code stays NULL: a ZCTA is a tabulation area, not a mailing address;
--      - id = md5(method, vehicle, day, county, lower(city)[, zcta]): concat_ws drops a NULL zcta, so a row whose cells
--        have no ZCTA (no_zcta, ambiguous, no_source) keeps its 20261116001000 id. A row that gains a zcta gets a new id;
--        the old one is withdrawn once (confidence 0, kept) with withdrawn_reason naming the ZIP key. Measured
--        2026-11-12: 1,461 admitted rows on 111 vehicles; 1,430 of their 1,435 cells fall in one ZCTA, so about all of
--        them are replaced once, and 191 rows (13%) split across two or more ZCTAs;
--      - a photo whose cell is still pending (its county file not read yet) waits for the next run, and the rows of that
--        vehicle and county are not withdrawn meanwhile, so an area never drops to nothing while its ZIP is fetched. The
--        first run after deploy requests the 14 counties and admits nothing new; the next run keys and replaces;
--      - metadata.area_key.zcta names the method (cell centre in the 1:500,000 ZCTA shape) and metadata.zcta_unkeyed
--        lists why a row has none; the return adds photos_held_zcta_pending, rows_with_zcta and the keyer's counts.
--      photo_gps_area, the eligibility test, the grain otherwise, confidences, withdrawal and receipts are unchanged.
--      The photos and cells are read once into temp tables (the cron run averaged 29.0 s of its 60 s on 2026-11-11/12).
--   2. vehicle_location_fold: the tied viewer's point of an area averages that area's photos only. It grouped areas by
--      zcta already but averaged the point over every row of the county and city, so two ZIP areas of one city showed
--      the same point. The rest of the body is the 20261116035000 definition.
-- Public readers still get area grain only: zcta is a public map key (us_zctas, readable by every role).
-- CONTRACT: supabase/sql/test_photo_gps_zcta.sql (PG17; PostGIS and pg_net stood in).
-- Reversal: re-apply the admit_photo_gps_locations body of 20261116001000 and the fold of 20261116035000.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE a text; f text;
BEGIN
  IF to_regprocedure('public.key_geo_cells_zcta(integer)') IS NULL OR to_regclass('public.geo_cell_zcta') IS NULL THEN
    RAISE EXCEPTION 'geo_cell_zcta keyer (20261116021000) is missing';
  END IF;
  a := pg_get_functiondef('public.admit_photo_gps_locations(uuid)'::regprocedure);
  f := pg_get_functiondef('public.vehicle_location_fold(uuid)'::regprocedure);
  IF md5(a) <> '00b41dab3b68bff3504cbdc9595b123d' AND position('photo_gps_zcta_v1' in a) = 0 THEN
    RAISE EXCEPTION 'admit_photo_gps_locations drifted from 20261116001000; review it';
  END IF;
  IF md5(f) <> 'c55690dcc7f158de4fa2203265325f5d' AND position('zcta_point_v1' in f) = 0 THEN
    RAISE EXCEPTION 'vehicle_location_fold drifted from 20261116035000; review it';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.admit_photo_gps_locations(p_vehicle_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_method      constant text := 'photo_gps_fold_v1';
  c_writer      constant text := 'admit_photo_gps_locations';
  c_zcta_key    constant text := 'photo_gps_zcta_v1: cell centre (0.001 deg) in census_2020_zcta520_500k, ST_Covers';
  v_prev_writer text := current_setting('app.writer', true);
  v_started     timestamptz := clock_timestamp();
  v_key         jsonb;
  v_out         jsonb;
  v_inserted    integer;
  v_updated     integer;
  v_withdrawn   integer;
BEGIN
  PERFORM set_config('app.writer', c_writer, true);
  PERFORM set_config('lock_timeout', '5s', true);

  DROP TABLE IF EXISTS pg_temp.pgl_photos;
  DROP TABLE IF EXISTS pg_temp.pgl_cells;
  CREATE TEMP TABLE pgl_photos ON COMMIT DROP AS
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
      AND coalesce(i.image_vehicle_match_status, '') NOT IN ('mismatch', 'unrelated');
  CREATE TEMP TABLE pgl_cells ON COMMIT DROP AS
    SELECT c.clat, c.clng, a.county_fips, a.county_name, a.region_code, a.city
    FROM (SELECT DISTINCT round(p.lat::numeric, 3) AS clat, round(p.lng::numeric, 3) AS clng FROM pgl_photos p) c
    CROSS JOIN LATERAL public.photo_gps_area(c.clng::float8, c.clat::float8) a;

  -- ZIP key: new cells wait as pending; the keyer reads the county files that arrived and asks for the rest.
  INSERT INTO public.geo_cell_zcta (cell_lat, cell_lng, county_fips)
  SELECT c.clat, c.clng, c.county_fips FROM pgl_cells c WHERE c.county_fips ~ '^[0-9]{5}$'
  ON CONFLICT (cell_lat, cell_lng) DO NOTHING;
  v_key := public.key_geo_cells_zcta(25);

  WITH cell_area AS MATERIALIZED (
    SELECT c.clat, c.clng, c.county_fips, c.county_name, c.region_code, c.city,
           z.zcta, coalesce(z.status, 'pending') AS zcta_status
    FROM pgl_cells c
    LEFT JOIN public.geo_cell_zcta z ON z.cell_lat = c.clat AND z.cell_lng = c.clng
  ), placed AS MATERIALIZED (
    SELECT p.id, p.vehicle_id, p.taken_at, (p.taken_at AT TIME ZONE 'UTC')::date AS utc_day,
           ca.county_fips, ca.county_name, ca.region_code, ca.city, ca.zcta, ca.zcta_status
    FROM pgl_photos p
    JOIN cell_area ca ON ca.clat = round(p.lat::numeric, 3) AND ca.clng = round(p.lng::numeric, 3)
  ), held AS MATERIALIZED (
    -- Photos whose ZIP is still being fetched: their vehicle and county keep the rows they have until the next run.
    SELECT DISTINCT pl.vehicle_id, pl.county_fips FROM placed pl
    WHERE pl.county_fips IS NOT NULL AND pl.zcta_status = 'pending'
  ), areas AS MATERIALIZED (
    SELECT md5(concat_ws('|', c_method, pl.vehicle_id, pl.utc_day, pl.county_fips, lower(coalesce(pl.city, '')),
                         pl.zcta))::uuid AS id,
           pl.vehicle_id, pl.utc_day, pl.county_fips, pl.county_name, pl.region_code, pl.city, pl.zcta,
           count(*) AS photos, min(pl.taken_at) AS first_at, max(pl.taken_at) AS last_at,
           jsonb_agg(pl.id ORDER BY pl.taken_at, pl.id) AS image_ids,
           jsonb_agg(DISTINCT pl.zcta_status) FILTER (WHERE pl.zcta IS NULL) AS zcta_unkeyed
    FROM placed pl
    WHERE pl.county_fips IS NOT NULL AND pl.zcta_status <> 'pending'
    GROUP BY pl.vehicle_id, pl.utc_day, pl.county_fips, pl.county_name, pl.region_code, pl.city, pl.zcta
  ), ins AS (
    INSERT INTO public.vehicle_location_observations AS o
      (id, vehicle_id, source_type, source_platform, observed_at, location_text_clean, country_code, region_code, city,
       county_fips, county_name, zcta, "precision", confidence, metadata)
    SELECT a.id, a.vehicle_id, 'exif', 'photo_exif', a.last_at,
           concat_ws(', ', coalesce(a.city, a.county_name), a.region_code), 'US', a.region_code, a.city,
           a.county_fips, a.county_name, a.zcta,
           CASE WHEN a.city IS NULL THEN 'county' ELSE 'city' END,
           CASE WHEN a.city IS NULL THEN 0.8 ELSE 0.7 END,
           jsonb_build_object(
             'method', c_method, 'writer', c_writer, 'utc_day', a.utc_day, 'photos', a.photos,
             'first_taken_at', a.first_at, 'last_taken_at', a.last_at, 'image_ids', a.image_ids,
             'area_key', jsonb_build_object(
               'county', 'point_in_county',
               'city', CASE WHEN a.city IS NULL THEN NULL ELSE 'nearest_city_centroid_8km_same_county' END,
               'zcta', CASE WHEN a.zcta IS NULL THEN NULL ELSE c_zcta_key END,
               'cell_degrees', 0.001),
             'admitted_at', now())
           || CASE WHEN a.zcta IS NULL THEN jsonb_build_object('zcta_unkeyed', a.zcta_unkeyed) ELSE '{}'::jsonb END
    FROM areas a
    ON CONFLICT (id) DO UPDATE
      SET observed_at = EXCLUDED.observed_at,
          confidence  = EXCLUDED.confidence,
          zcta        = EXCLUDED.zcta,
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
             OR o.metadata->'area_key' IS DISTINCT FROM EXCLUDED.metadata->'area_key'
             OR o.metadata->'zcta_unkeyed' IS DISTINCT FROM EXCLUDED.metadata->'zcta_unkeyed'
             OR o.metadata ? 'withdrawn_at')
    RETURNING (o.xmax = 0) AS inserted
  ), wd AS (
    UPDATE public.vehicle_location_observations o
       SET confidence = 0,
           metadata = o.metadata || jsonb_build_object(
             'withdrawn_at', now(), 'withdrawn_by', c_writer, 'prior_confidence', o.confidence,
             'withdrawn_reason', CASE
               WHEN o.zcta IS NULL AND EXISTS (
                 SELECT 1 FROM areas a
                 WHERE a.vehicle_id = o.vehicle_id AND a.utc_day::text = o.metadata->>'utc_day'
                   AND a.county_fips = o.county_fips AND a.city IS NOT DISTINCT FROM o.city AND a.zcta IS NOT NULL)
               THEN 'replaced by the rows of the same day and area keyed by ZIP (zcta)'
               ELSE 'no eligible photo places the vehicle in this area on this UTC day' END)
     WHERE o.source_type = 'exif' AND o.metadata->>'method' = c_method
       AND (p_vehicle_id IS NULL OR o.vehicle_id = p_vehicle_id)
       AND o.confidence >= 0.5
       AND NOT EXISTS (SELECT 1 FROM areas a WHERE a.id = o.id)
       AND NOT EXISTS (SELECT 1 FROM held h WHERE h.vehicle_id = o.vehicle_id AND h.county_fips = o.county_fips)
    RETURNING 1
  )
  SELECT jsonb_build_object(
           'method', c_method,
           'scope', coalesce(p_vehicle_id::text, 'fleet'),
           'photos_eligible', (SELECT count(*) FROM pgl_photos),
           'photos_placed', (SELECT count(*) FROM placed WHERE county_fips IS NOT NULL AND zcta_status <> 'pending'),
           'photos_held_zcta_pending', (SELECT count(*) FROM placed WHERE county_fips IS NOT NULL AND zcta_status = 'pending'),
           'photos_unplaced_no_us_county', (SELECT count(*) FROM placed WHERE county_fips IS NULL),
           'photos_with_city', (SELECT count(*) FROM placed WHERE city IS NOT NULL AND zcta_status <> 'pending'),
           'cells', (SELECT count(*) FROM pgl_cells),
           'vehicles', (SELECT count(DISTINCT vehicle_id) FROM areas),
           'rows_current', (SELECT count(*) FROM areas),
           'rows_with_zcta', (SELECT count(*) FROM areas WHERE zcta IS NOT NULL),
           'zcta_keyer', v_key),
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
'Admits a vehicle''s photo GPS into vehicle_location_observations (20261116001000, ZIP key 20261116029000): one row per (vehicle, UTC day of taken_at, area), source_type exif, source_platform photo_exif, metadata.method photo_gps_fold_v1. Area = county by point in polygon, the nearest city centroid in that county within 8 km (photo_gps_area), and the ZCTA of the photo''s 0.001-degree cell (geo_cell_zcta, keyed by key_geo_cells_zcta, which this writer calls; NULL when no single ZCTA covers the cell). Photos in a cell still being keyed wait for the next run. precision city or county; confidence 0.7 (city) or 0.8 (county only); latitude, longitude and postal_code NULL (the point never enters the row). observed_at = the day''s last taken_at; metadata carries photos, first/last taken_at, image_ids, the area_key methods and, without a zcta, zcta_unkeyed. Eligible photos: public, not deleted vehicles; taken_at known; not sensitive, superseded or duplicate; vision gate approved or unset; not a mismatch. Idempotent (id = md5 of method, vehicle, day, area). A row no longer supported is withdrawn (confidence 0, metadata.withdrawn_at, withdrawn_reason), never deleted, and re-admitted under the same id if its photos return. p_vehicle_id NULL = the fleet. service_role only; receipted in write_receipts; cron photo-gps-location.';

COMMENT ON COLUMN public.vehicle_location_observations.zcta IS
'The ZIP-level place key, a 2020 ZCTA (us_zctas). Two writers: left(postal_code, 5) when that code is a ZCTA, set at insert and when postal_code changes by trg_key_vehicle_location_zcta and for existing rows by key_vehicle_location_zcta() (20261020210000); and, for photo-GPS rows (source_type exif), the ZCTA whose 1:500,000 shape covers the photo''s 0.001-degree cell centre, written by admit_photo_gps_locations (20261116029000, geo_cell_zcta). NULL means no ZIP-level place; the map reports those as "no ZIP".';

-- 2. The location fold: the 20261116012000 body, with the tied point averaged per ZIP area.
CREATE OR REPLACE FUNCTION public.vehicle_location_fold(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  RETURN (
  with gate as (
    select v.user_id, v.owner_id, v.uploaded_by,
           auth.uid() in (v.user_id, v.owner_id, v.uploaded_by) as tied
    from public.vehicles v
    where v.id = p_vehicle_id
      and ((v.is_public = true and v.deleted_at is null)
           or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
  ), rows_ as materialized (
    -- Photo GPS admitted at area grain (admit_photo_gps_locations, 20261116001000). The row holds no point.
    select o.id, o.observed_at, o.created_at, o.confidence, o."precision" as level, o.city, o.county_fips,
           o.county_name, o.region_code, o.country_code, o.zcta, o.location_text_clean as label,
           o.metadata->>'utc_day' as utc_day, o.metadata->'image_ids' as image_ids
    from public.vehicle_location_observations o
    where exists (select 1 from gate)
      and o.vehicle_id = p_vehicle_id and o.source_type = 'exif'
      and o.metadata->>'method' = 'photo_gps_fold_v1' and o.confidence >= 0.5
    order by o.observed_at desc, o.id
    limit 1001
  ), ids as materialized (
    select l.id as row_id, x.image_id::uuid as image_id
    from rows_ l
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(l.image_ids) = 'array'
      then l.image_ids else '[]'::jsonb end) x(image_id)
    where x.image_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), photos as materialized (
    -- A row counts only while one of its photos is visible: the reader's visible_images predicates, by primary key.
    -- photo_gps_cover_v1: the photo must still hold its point. With the image_url test this is the predicate of
    -- idx_vehicle_images_gps_cover, so each photo is one index-only probe on (vehicle_id, id).
    -- photo_gps_cover_v2: one probe per photo, forced. The planner estimates one row for ids, and joined plainly it
    -- rescans every cover entry of the vehicle per photo (043c6d8b: 2,476 x 1,238, 2.2 s). OFFSET 0 keeps the
    -- lateral subquery from being flattened, so p.image_id is an index condition.
    select p.row_id, i.taken_at, i.latitude, i.longitude
    from ids p
    cross join lateral (
      select i.taken_at, i.latitude, i.longitude
      from public.vehicle_images i
      where i.id = p.image_id and i.vehicle_id = p_vehicle_id
        and i.latitude is not null and i.longitude is not null
        and nullif(btrim(i.image_url), '') is not null
        and i.is_sensitive is not true and i.is_superseded is not true
        and i.is_duplicate is not true
        and (i.vision_gate_status is null or i.vision_gate_status::text = 'approved')
        and coalesce(i.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
      offset 0
    ) i
  ), tied as (
    -- The exact place is the owner's: only a viewer tied to the vehicle gets a point.
    select coalesce((select g.tied from gate g), false) as tied
  ), current_ as materialized (
    select l.*, p.photos, p.first_taken_at, p.last_taken_at,
           case when (select tied from tied) then jsonb_build_object(
             'lat', round(p.lat::numeric, 4), 'lng', round(p.lng::numeric, 4), 'photos', p.photos) end as point
    from rows_ l
    join (select row_id, count(*) as photos, min(taken_at) as first_taken_at, max(taken_at) as last_taken_at,
                 avg(latitude) as lat, avg(longitude) as lng
          from photos group by row_id) p on p.row_id = l.id
  ), areas as materialized (
    select c.level, c.label, c.city, c.county_fips, c.county_name, c.region_code, c.country_code, c.zcta,
           sum(c.photos) as photos, count(*) as days, min(c.first_taken_at) as first_taken_at,
           max(c.last_taken_at) as last_taken_at, max(c.confidence) as confidence,
           (array_agg(c.id order by c.observed_at desc, c.id))[1] as latest_observation_id,
           max(c.created_at) as ingested_at,
           -- Where to centre a city-level area: the city's published centroid (city_geocode_lookup, built from
           -- listings), never the photos. County-level areas have none; draw the county's shape.
           case when c.city is not null then (
             select jsonb_build_object('lat', round(g.latitude::numeric, 4), 'lng', round(g.longitude::numeric, 4),
                                       'source', 'city_geocode_lookup', 'basis', 'city_centroid')
             from public.city_geocode_lookup g
             where lower(g.city) = lower(c.city) and g.state = c.region_code
               and g.latitude is not null and g.longitude is not null
             order by g.sample_size desc nulls last, g.city
             limit 1) end as centroid,
           jsonb_agg(c.id order by c.observed_at desc, c.id) as observation_ids,
           case when (select tied from tied) then (
             select jsonb_build_object('lat', round(avg(pp.latitude)::numeric, 4),
                                       'lng', round(avg(pp.longitude)::numeric, 4), 'photos', count(*))
             from photos pp
             join current_ c2 on c2.id = pp.row_id
             where c2.county_fips is not distinct from c.county_fips and c2.city is not distinct from c.city
               and c2.zcta is not distinct from c.zcta) end as point  -- zcta_point_v1: one point per ZIP area
    from current_ c
    group by c.level, c.label, c.city, c.county_fips, c.county_name, c.region_code, c.country_code, c.zcta
  )
  select case when exists (select 1 from gate) then jsonb_build_object(
    'row_count', (select count(*) from rows_),
    'areas', coalesce((select jsonb_agg(jsonb_build_object(
        'source_type','exif','source_platform','photo_exif','method','photo_gps_fold_v1',
        'level',a.level,'label',a.label,'city',a.city,'county_fips',a.county_fips,'county_name',a.county_name,
        'region_code',a.region_code,'country_code',a.country_code,'zcta',a.zcta,
        'photos',a.photos,'days',a.days,'first_taken_at',a.first_taken_at,'last_taken_at',a.last_taken_at,
        'confidence',a.confidence,'latest_observation_id',a.latest_observation_id,
        'observation_ids',a.observation_ids,'centroid',a.centroid,'point',a.point,'ingested_at',a.ingested_at)
      order by a.photos desc, a.last_taken_at desc, a.label) from areas a), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'observation_id',c.id,'utc_day',c.utc_day,'observed_at',c.observed_at,'level',c.level,'label',c.label,
        'city',c.city,'county_fips',c.county_fips,'county_name',c.county_name,'region_code',c.region_code,
        'zcta',c.zcta,'photos',c.photos,'first_taken_at',c.first_taken_at,'last_taken_at',c.last_taken_at,
        'confidence',c.confidence,'point',c.point)
      order by c.observed_at desc, c.id) from current_ c), '[]'::jsonb)) end
  );
END
$function$;

DO $check$
BEGIN
  IF position('photo_gps_zcta_v1' in pg_get_functiondef('public.admit_photo_gps_locations(uuid)'::regprocedure)) = 0
     OR position('zcta_point_v1' in pg_get_functiondef('public.vehicle_location_fold(uuid)'::regprocedure)) = 0
     OR has_function_privilege('anon', 'public.admit_photo_gps_locations(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.vehicle_location_fold(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'photo GPS ZIP key not as intended';
  END IF;
END $check$;

COMMIT;
