-- get_county_detail reads the county's observations from a covering index and its vehicles by bitmap, so a big county answers.
--
-- Measured 2026-10-14, after #1109 (public vehicles only). pg_stat_statements since 2026-09-29 09:20Z, anon:
--   get_county_detail  12 calls, mean 2,231 ms, max 10,510 ms        (get_county_vehicles, 7 calls, mean 4,491 ms, max 14,904 ms,
--   has no caller anywhere and anon's EXECUTE was revoked by #1111; it is left alone.)
-- Logged out, Clark County (11,031 located vehicles) and Harris County (6,114) time out at 10 s, cold; Ventura County
-- (2,818): 7,073 ms.
-- Causes, each measured:
--  1. get_county_detail fetches each of the county's vehicles with a separate random index probe: 1.77 ms each cold (San
--     Diego County, 5,080 vehicles: 8,973 ms for the count alone), against 0.15 ms each when the same ids are read as a
--     bitmap heap scan, which prefetches (effective_io_concurrency 200): Palm Beach, 9,995 vehicles, 1.5 s. It does this
--     twice (the detail, then the platform breakdown).
--  2. Reading the county's observations, the planner ANDs idx_vlo_county_fips with a scan of all 353,551 observations
--     that have coordinates (idx_vlo_bbox, only to test "IS NOT NULL"): 1.2 s cold for Clark, 3.7 s for Palm Beach.
--  3. For the largest county (Maricopa, 37,260 vehicles) the vehicle fetch by id also ANDs in scans of the two partial
--     indexes behind is_public and deleted_at (about 700,000 entries each) only to test those columns.
--  4. Unstamped observations (no county_fips) are found by scanning every observation with coordinates.
-- After:
--  * idx_vlo_county_cover (county_fips) INCLUDE (vehicle_id, source_platform), partial on the rows the reader wants,
--    answers the county's observations from the index alone (89% of the table is all-visible);
--    idx_vlo_unstamped_coords (latitude, longitude) INCLUDE (vehicle_id, source_platform) holds the 15,552 observations
--    that have coordinates but no county stamp, so the bounding-box test finds them without a scan.
--  * get_county_detail reads the county's (platform, vehicle) pairs once, fetches the vehicles once as a bitmap heap
--    scan by id (the public and deleted tests applied after the fetch; enable_indexscan is off for that one statement
--    and restored), and counts platforms over the pairs in hand. Same JSON, same rows: its definition of a county's
--    vehicles (observed with the county's stamp, plus unstamped ones inside its polygon) is unchanged.
-- Measured on production: the exact function body below, run as the deploy role against the real vehicles and county
-- boundaries, with vehicle_location_observations replaced by an in-memory temp copy of its 353,571 rows that have coordinates
-- carrying the two index definitions (a read-only session cannot build them, so the visibility-map advantage is not credited):
-- Clark 4,526 ms, Los Angeles 2,145 ms, Palm Beach 2,032 ms, Harris 530 ms, Ventura 278 ms, Maricopa 9,007 ms cold and 709 ms on
-- a second look; the live function times out at 10 s for Clark, Harris, Los Angeles and Maricopa. Ventura's document is
-- identical to the live function's (count, total, top 20, makes, platforms; equal make counts can tie in a different order, as
-- they could before). What remains in a large county is one bitmap fetch of its vehicles' rows (about 0.15-0.3 ms each);
-- Maricopa fetches 29,552 heap blocks.
-- The function keeps its return shape, SECURITY DEFINER, search_path, the public-and-undeleted rule and its grants.
--
-- The function is replaced only from its 2026-10-14 source (md5 of pg_get_functiondef); any other source stops the
-- migration. Contract: supabase/sql/test_county_readers_index_backed.sql (CI job county-readers-index-contract).
-- definer-grants: default reviewed get_county_detail
SET statement_timeout = '900s';
SET lock_timeout = '180s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vlo_county_cover
  ON public.vehicle_location_observations (county_fips) INCLUDE (vehicle_id, source_platform)
  WHERE county_fips IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vlo_unstamped_coords
  ON public.vehicle_location_observations (latitude, longitude) INCLUDE (vehicle_id, source_platform)
  WHERE county_fips IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

-- An interrupted concurrent build leaves an INVALID index that IF NOT EXISTS would then skip.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
           WHERE c.relname IN ('idx_vlo_county_cover', 'idx_vlo_unstamped_coords') AND NOT i.indisvalid LOOP
    RAISE EXCEPTION '% is INVALID; DROP INDEX CONCURRENTLY public.% and re-run', r.relname, r.relname;
  END LOOP;
END $$;

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  d_def text := pg_get_functiondef(to_regprocedure('public.get_county_detail(text)'));
BEGIN
  IF d_def IS NULL THEN
    RAISE EXCEPTION 'get_county_detail(text) must exist';
  END IF;
  IF md5(d_def) IS DISTINCT FROM 'a9ca0c546e3c6053314cdcc84b3848bf' AND d_def NOT LIKE '%idx_vlo_unstamped_coords%' THEN
    RAISE EXCEPTION 'get_county_detail is not the 2026-10-14 source this migration was written from (md5 %); re-read it', md5(d_def);
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.get_county_detail(p_fips text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result JSONB;
  county_rec RECORD;
  vehicles_arr JSONB;
  makes_arr JSONB;
  platforms_arr JSONB;
  v_count INTEGER;
  v_total_value BIGINT;
  v_pair_platforms text[];
  v_pair_vehicles uuid[];
  v_ids uuid[];
  v_public uuid[];
  v_indexscan text := current_setting('enable_indexscan');
BEGIN
  -- Get county name from boundary table
  SELECT name, state_fips INTO county_rec
  FROM us_county_boundaries WHERE fips = p_fips;

  IF county_rec IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'County not found',
      'fips', p_fips
    );
  END IF;

  -- Every (platform, vehicle) located in the county, read once: observations stamped with the county, plus the few
  -- unstamped ones inside it (idx_vlo_unstamped_coords narrows those by bounding box before the exact test).
  SELECT COALESCE(array_agg(DISTINCT p.vehicle_id), '{}'),
         COALESCE(array_agg(p.source_platform), '{}'),
         COALESCE(array_agg(p.vehicle_id), '{}')
  INTO v_ids, v_pair_platforms, v_pair_vehicles
  FROM (
    SELECT vlo.source_platform, vlo.vehicle_id
    FROM vehicle_location_observations vlo
    WHERE vlo.county_fips = p_fips
      AND vlo.latitude IS NOT NULL
      AND vlo.longitude IS NOT NULL

    UNION

    SELECT vlo.source_platform, vlo.vehicle_id
    FROM us_county_boundaries cb
    JOIN vehicle_location_observations vlo
      ON vlo.county_fips IS NULL
     AND vlo.latitude IS NOT NULL
     AND vlo.longitude IS NOT NULL
     AND vlo.latitude  BETWEEN ST_YMin(cb.geom) AND ST_YMax(cb.geom)
     AND vlo.longitude BETWEEN ST_XMin(cb.geom) AND ST_XMax(cb.geom)
     AND ST_Contains(cb.geom, ST_SetSRID(ST_MakePoint(vlo.longitude, vlo.latitude), 4326))
    WHERE cb.fips = p_fips
  ) p;

  -- The vehicles are read from the heap by bitmap (one prefetched sweep) instead of one random probe each, by id alone:
  -- the public and deleted tests are applied after the fetch, because as quals on the sweep the planner ANDs in scans of
  -- two 700,000-entry partial indexes (idx_vehicles_platform_source_public, idx_vehicles_requires_improvement) just to test them.
  PERFORM set_config('enable_indexscan', 'off', true);
  WITH located AS MATERIALIZED (
    SELECT v.id, v.year, v.make, v.model, v.sale_price, v.sold_price, v.primary_image_url, v.status, v.is_public, v.deleted_at
    FROM vehicles v
    WHERE v.id = ANY (v_ids)
  ), enriched AS MATERIALIZED (
    SELECT
      l.id,
      l.year,
      l.make,
      l.model,
      l.sale_price,
      l.sold_price,
      l.primary_image_url,
      l.status,
      COALESCE(l.sale_price, l.sold_price) AS effective_price
    FROM located l
    WHERE l.deleted_at IS NULL AND l.is_public = true
  )
  SELECT
    count(*)::integer,
    COALESCE(sum(effective_price), 0)::bigint,
    -- Top 20 vehicles by price DESC
    (
      SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      FROM (
        SELECT e2.id, e2.year, e2.make, e2.model, e2.sale_price, e2.sold_price,
               e2.primary_image_url, e2.status, e2.effective_price
        FROM enriched e2
        ORDER BY e2.effective_price DESC NULLS LAST
        LIMIT 20
      ) t
    ),
    -- Top 10 makes
    (
      SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      FROM (
        SELECT e3.make, count(*)::integer AS count
        FROM enriched e3
        WHERE e3.make IS NOT NULL
        GROUP BY e3.make
        ORDER BY count DESC
        LIMIT 10
      ) t
    ),
    COALESCE(array_agg(e.id), '{}')
  INTO v_count, v_total_value, vehicles_arr, makes_arr, v_public
  FROM enriched e;
  PERFORM set_config('enable_indexscan', v_indexscan, true);

  -- Platform breakdown: the located pairs already in hand, counted over the public vehicles.
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO platforms_arr
  FROM (
    SELECT u.platform, count(DISTINCT u.vehicle_id)::integer AS count
    FROM unnest(v_pair_platforms, v_pair_vehicles) AS u(platform, vehicle_id)
    JOIN unnest(v_public) AS pub(id) ON pub.id = u.vehicle_id
    WHERE u.platform IS NOT NULL
    GROUP BY u.platform
    ORDER BY count DESC
  ) t;

  -- Build final result
  result := jsonb_build_object(
    'fips', p_fips,
    'county_name', county_rec.name,
    'state_fips', county_rec.state_fips,
    'vehicle_count', v_count,
    'total_value', v_total_value,
    'vehicles', vehicles_arr,
    'makes', makes_arr,
    'platforms', platforms_arr,
    'generated_at', now()
  );

  RETURN result;
END;
$function$;

COMMENT ON FUNCTION public.get_county_detail(text) IS
  'A county''s public vehicles: count, summed recorded price, top 20 by price, top makes and platforms. Public, undeleted vehicles only (2026-10-14). Used by the web ChoroplethMap. Reads the county''s (platform, vehicle) pairs once from idx_vlo_county_cover and idx_vlo_unstamped_coords, fetches its vehicles once as a bitmap heap scan, and counts platforms over the pairs in hand (it probed each vehicle separately, twice, and timed out for large counties; 2026-10-14).';

COMMIT;

-- Live verification (after apply), as anon through PostgREST:
--   POST /rest/v1/rpc/get_county_detail  {"p_fips":"32003"}   -- Clark County: a document, no timeout
