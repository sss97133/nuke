-- Live definition of get_county_detail(text) on 2026-10-14 after #1109 (pg_get_functiondef),
-- md5(pg_get_functiondef) a9ca0c546e3c6053314cdcc84b3848bf, the migration guard's expected source. Test fixture only.
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
