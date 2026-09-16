-- One Query Language for the Map (docs/features/explore/THEORY.md — FIND organ):
-- the county choropleth must render ANY MarketQuery filter set, not just make.
-- Geography is resolved ONCE per vehicle (PostGIS point-in-county), then filters
-- run live against vehicles. NOT YET DEPLOYED — deploy via direct psql
-- (statement_timeout=0) after the canonical-identity rebuild completes.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_vehicle_county AS
SELECT DISTINCT ON (vlo.vehicle_id)
       vlo.vehicle_id, cb.fips, cb.state_fips
FROM vehicle_location_observations vlo
JOIN us_county_boundaries cb
  ON st_contains(cb.geom, st_setsrid(st_makepoint(vlo.longitude, vlo.latitude), 4326))
WHERE vlo.latitude BETWEEN 24 AND 50 AND vlo.longitude BETWEEN -130 AND -66;
CREATE UNIQUE INDEX IF NOT EXISTS mv_vehicle_county_pk ON mv_vehicle_county(vehicle_id);
CREATE INDEX IF NOT EXISTS mv_vehicle_county_fips ON mv_vehicle_county(fips);

CREATE OR REPLACE FUNCTION county_density_filtered(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE(fips text, state_fips text, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT mc.fips, max(mc.state_fips), count(*)::bigint
  FROM mv_vehicle_county mc
  JOIN vehicles v ON v.id = mc.vehicle_id AND v.is_public AND v.deleted_at IS NULL
  WHERE (p_filters->>'make'  IS NULL OR v.make  = p_filters->>'make')
    AND (p_filters->>'model' IS NULL OR v.model = p_filters->>'model')
    AND (p_filters->>'year_min' IS NULL OR v.year >= (p_filters->>'year_min')::int)
    AND (p_filters->>'year_max' IS NULL OR v.year <= (p_filters->>'year_max')::int)
    AND (p_filters->>'price_min' IS NULL OR COALESCE(v.sale_price, v.sold_price, v.canonical_sold_price) >= (p_filters->>'price_min')::numeric)
    AND (p_filters->>'price_max' IS NULL OR COALESCE(v.sale_price, v.sold_price, v.canonical_sold_price) <= (p_filters->>'price_max')::numeric)
  GROUP BY mc.fips;
$fn$;
GRANT EXECUTE ON FUNCTION county_density_filtered(jsonb) TO anon, authenticated;
