-- map_county_observations: one page of a county's located vehicles for the map, as any visitor sees them.
--
-- The iOS map drills into a county by reading vehicle_location_observations with an embedded vehicles join,
-- 1,000 rows a page. Signed in, the two tables' row-level policies evaluate the per-vehicle access
-- functions for every row: measured 2026-11-13 on Clark County (32003, 18,155 observations), 4.2 s a page
-- as the owner against 0.6 s logged out, so the county took about 85 s on his phone (edge logs 03:09Z).
--
-- The map shows the public market, so this reader returns exactly what the logged-out policy admits
-- ("Public read high confidence observations" with the anon branch): confidence >= 0.5, not a private
-- sighting, on a vehicle that is public and not deleted. Same row shape as the client's table read
-- (vehicles nested with the columns anon is granted). Keyset by observation id.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.map_county_observations(p_fips text, p_after uuid DEFAULT NULL, p_limit integer DEFAULT 1000)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
           'id', o.id, 'observed_at', o.observed_at, 'source_type', o.source_type,
           'source_platform', o.source_platform, 'source_url', o.source_url, 'postal_code', o.postal_code,
           'county_fips', o.county_fips, 'city', o.city, 'precision', o.precision, 'confidence', o.confidence,
           'vehicles', jsonb_build_object(
             'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model, 'trim', v.trim,
             'primary_image_url', v.primary_image_url, 'city', v.city, 'state', v.state,
             'status', v.status, 'deleted_at', v.deleted_at))
  FROM public.vehicle_location_observations o
  JOIN public.vehicles v ON v.id = o.vehicle_id
  WHERE o.county_fips = p_fips
    AND o.confidence >= 0.5
    AND o.source_type <> 'sighting'
    AND v.is_public = true
    AND v.deleted_at IS NULL
    AND (p_after IS NULL OR o.id > p_after)
  ORDER BY o.id
  LIMIT least(greatest(coalesce(p_limit, 1000), 1), 2000);
$$;

COMMENT ON FUNCTION public.map_county_observations(text, uuid, integer) IS
  'One keyset page of a county''s located vehicles for the map, as a logged-out visitor sees them (public, not deleted, not a private sighting, confidence >= 0.5). Same shape as the vehicle_location_observations + vehicles read. Reader for apps/nuke-capture-ios MarketMapView.';

REVOKE ALL ON FUNCTION public.map_county_observations(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_county_observations(text, uuid, integer) TO anon, authenticated, service_role;
