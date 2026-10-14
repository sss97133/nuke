-- get_county_detail and get_county_vehicles answer with public vehicles only.
--
-- Both run as their owner (SECURITY DEFINER), anon may execute both, and neither checked visibility:
--   get_county_vehicles  returned private vehicle ids. Logged out on 2026-10-14, Clark County (32003) returned
--                        200 ids: 90 private, 2 deleted, 59 public, 49 with no vehicle row.
--   get_county_detail    returned year, make, model, sale and sold price, image and status for the county's
--                        top 20 vehicles, private ones included, and counted private vehicles in its totals,
--                        makes and platforms. Clark County holds 4,932 private and 3,417 public located
--                        vehicles; its read times out for anon, smaller counties answer.
-- After: both join vehicles on is_public and not deleted, and both pin search_path to public (PostGIS lives
-- there), which an owner-run function without a fixed path lacked. Return shapes are unchanged, so the web's
-- ChoroplethMap keeps working. No row changes.
-- Each function is replaced only from its 2026-10-14 source (base64 SHA-256 of prosrc); any other source stops the migration.
-- Contract: supabase/sql/test_county_readers_public_only.sql (CI job county-readers-contract).
SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- One transaction: a failed guard leaves both functions as found, whatever psql's error setting.
BEGIN;

DO $guard$
DECLARE
  d_hash text := (SELECT encode(sha256(prosrc::bytea), 'base64') FROM pg_proc WHERE oid = to_regprocedure('public.get_county_detail(text)'));
  v_hash text := (SELECT encode(sha256(prosrc::bytea), 'base64') FROM pg_proc WHERE oid = to_regprocedure('public.get_county_vehicles(text)'));
BEGIN
  IF d_hash IS DISTINCT FROM 'VIo4f6qOjKMOKu39N44eAHqrDy5JXt+48FDHb/4lns4='
     AND NOT EXISTS (SELECT FROM pg_proc WHERE oid = to_regprocedure('public.get_county_detail(text)')
                       AND prosrc LIKE '%v.is_public = true%' AND proconfig::text LIKE '%search_path=public%') THEN
    RAISE EXCEPTION 'get_county_detail is not the 2026-10-14 source this migration was written from (sha256 %); re-read it', d_hash;
  END IF;
  IF v_hash IS DISTINCT FROM 'FePXGobe7hSRDGu8GOWOVe8CScyhlAlloWR8GQ4J3t0='
     AND NOT EXISTS (SELECT FROM pg_proc WHERE oid = to_regprocedure('public.get_county_vehicles(text)')
                       AND prosrc LIKE '%v.is_public = true%' AND proconfig::text LIKE '%search_path=public%') THEN
    RAISE EXCEPTION 'get_county_vehicles is not the 2026-10-14 source this migration was written from (sha256 %); re-read it', v_hash;
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

  -- Find all distinct vehicles in this county
  -- Leverage the county_fips index first; fall back to spatial for VLOs without fips
  WITH county_vehicles AS (
    SELECT DISTINCT vlo.vehicle_id
    FROM vehicle_location_observations vlo
    WHERE vlo.county_fips = p_fips
      AND vlo.latitude IS NOT NULL
      AND vlo.longitude IS NOT NULL

    UNION

    SELECT DISTINCT vlo.vehicle_id
    FROM vehicle_location_observations vlo
    JOIN us_county_boundaries cb ON cb.fips = p_fips
      AND ST_Contains(cb.geom, ST_SetSRID(ST_MakePoint(vlo.longitude, vlo.latitude), 4326))
    WHERE vlo.county_fips IS NULL
      AND vlo.latitude IS NOT NULL
      AND vlo.longitude IS NOT NULL
  ),
  -- Enrich with vehicle data
  enriched AS (
    SELECT
      v.id,
      v.year,
      v.make,
      v.model,
      v.sale_price,
      v.sold_price,
      v.primary_image_url,
      v.status,
      COALESCE(v.sale_price, v.sold_price) AS effective_price
    FROM county_vehicles cv
    JOIN vehicles v ON v.id = cv.vehicle_id AND v.deleted_at IS NULL AND v.is_public = true
  )
  -- Compute aggregates
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
    )
  INTO v_count, v_total_value, vehicles_arr, makes_arr
  FROM enriched e;

  -- Platform breakdown (separate query using VLOs for source_platform)
  WITH county_vlos AS (
    SELECT vlo.source_platform, vlo.vehicle_id
    FROM vehicle_location_observations vlo
    WHERE vlo.county_fips = p_fips
      AND vlo.latitude IS NOT NULL
      AND vlo.longitude IS NOT NULL

    UNION

    SELECT vlo.source_platform, vlo.vehicle_id
    FROM vehicle_location_observations vlo
    JOIN us_county_boundaries cb ON cb.fips = p_fips
      AND ST_Contains(cb.geom, ST_SetSRID(ST_MakePoint(vlo.longitude, vlo.latitude), 4326))
    WHERE vlo.county_fips IS NULL
      AND vlo.latitude IS NOT NULL
      AND vlo.longitude IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  FROM (
    SELECT source_platform AS platform, count(DISTINCT vehicle_id)::integer AS count
    FROM county_vlos
    WHERE source_platform IS NOT NULL
      AND EXISTS (SELECT 1 FROM vehicles pv WHERE pv.id = county_vlos.vehicle_id AND pv.is_public = true AND pv.deleted_at IS NULL)
    GROUP BY source_platform
    ORDER BY count DESC
  ) t
  INTO platforms_arr;

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

CREATE OR REPLACE FUNCTION public.get_county_vehicles(p_fips text)
 RETURNS TABLE(vehicle_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT vlo.vehicle_id
  FROM vehicle_location_observations vlo
  JOIN us_county_boundaries cb ON cb.fips = p_fips
    AND ST_Contains(cb.geom, ST_SetSRID(ST_MakePoint(vlo.longitude, vlo.latitude), 4326))
  JOIN vehicles v ON v.id = vlo.vehicle_id AND v.is_public = true AND v.deleted_at IS NULL
  WHERE vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL
  LIMIT 200;
$function$;

COMMENT ON FUNCTION public.get_county_detail(text) IS
  'A county''s public vehicles: count, summed recorded price, top 20 by price, top makes and platforms. Public, undeleted vehicles only (2026-10-14). Used by the web ChoroplethMap.';
COMMENT ON FUNCTION public.get_county_vehicles(text) IS
  'Up to 200 public, undeleted vehicle ids located in a county (2026-10-14).';

COMMIT;

RESET statement_timeout;
RESET lock_timeout;
