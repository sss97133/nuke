-- Explore map RPCs (iOS choropleth). Applied to prod 2026-07-12; recorded for drift.
--
-- county_density_all — all-listings count per US county FIPS (summed across makes
--   from mv_make_geographic_density, joined to us_county_boundaries for the name).
--   Feeds the county choropleth's fill. (Per-make density uses the existing
--   get_make_heatmap(p_make); this is the "All makes" base.)
-- market_map_points — top metros with coordinates (metro-pulse matview joined to
--   city_geocode_lookup), the earlier bubble layer; retained for reuse.
-- SECURITY DEFINER because city_geocode_lookup / boundaries carry RLS the anon role
--   can't read through directly.

CREATE OR REPLACE FUNCTION county_density_all()
RETURNS TABLE(fips text, name text, state_fips text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.fips, b.name, d.state_fips, d.count
  FROM (
    SELECT fips, max(state_fips) state_fips, sum(count)::bigint count
    FROM mv_make_geographic_density WHERE fips IS NOT NULL GROUP BY fips
  ) d
  LEFT JOIN us_county_boundaries b ON b.fips = d.fips
  ORDER BY d.count DESC;
$$;
GRANT EXECUTE ON FUNCTION county_density_all() TO anon, authenticated;

CREATE OR REPLACE FUNCTION market_map_points(p_limit int DEFAULT 200)
RETURNS TABLE(metro text, city text, state text, total_listings bigint,
              active bigint, sold bigint, avg_price numeric, lat numeric, lon numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.metro,
         split_part(p.metro, ', ', 1) AS city,
         split_part(p.metro, ', ', 2) AS state,
         p.total_listings, p.active, p.sold, p.avg_price,
         g.latitude, g.longitude
  FROM marketplace_metro_pulse p
  JOIN city_geocode_lookup g
    ON lower(g.city) = lower(split_part(p.metro, ', ', 1))
   AND upper(g.state) = upper(split_part(p.metro, ', ', 2))
  WHERE g.latitude IS NOT NULL AND g.longitude IS NOT NULL
  ORDER BY p.total_listings DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION market_map_points(int) TO anon, authenticated;
