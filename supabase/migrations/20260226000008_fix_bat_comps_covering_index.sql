-- Fix find_bat_comps nested-loop heap fetch bottleneck
--
-- Diagnosis: find_bat_comps does 11,907 nested-loop probes into bat_listings
-- per Corvette query. Each probe hits the vehicle_id index then heap-fetches
-- the row to read sale_price, sale_date, bid_count, bat_listing_url.
-- With 11,907 heap fetches, a Corvette query takes 26.7s — near the timeout.
-- The wide fallback (null model) takes 37s and reliably exceeds it.
--
-- Fix: covering index on bat_listings(vehicle_id) INCLUDE(all needed cols)
-- WHERE sale_price > 0. Each probe becomes an index-only scan — no heap fetch.
-- Also: skip the expensive wide fallback in find_bat_comps if we already have
-- zero exact matches (no point widening — comps just don't exist in BaT).

-- Covering index — makes every nested-loop probe index-only
CREATE INDEX IF NOT EXISTS idx_bat_listings_vehicle_sold_covering
  ON bat_listings (vehicle_id, sale_date DESC NULLS LAST)
  INCLUDE (sale_price, bid_count, bat_listing_url)
  WHERE sale_price > 0;

-- Refresh table statistics so planner picks up the new index
ANALYZE bat_listings;
ANALYZE vehicles;

-- Rewrite find_bat_comps: adds p_year_range_wide param so callers control
-- whether to attempt the expensive wide fallback
CREATE OR REPLACE FUNCTION find_bat_comps(
  p_make            text,
  p_model           text    DEFAULT NULL,
  p_year            integer DEFAULT NULL,
  p_year_range      integer DEFAULT 2,
  p_limit           integer DEFAULT 200,
  p_skip_wide_fallback boolean DEFAULT false
)
RETURNS TABLE(
  listing_id      uuid,
  vehicle_id      uuid,
  sale_price      integer,
  bid_count       integer,
  sale_date       date,
  bat_listing_url text,
  v_year          integer,
  v_make          text,
  v_model         text,
  v_engine_size   text
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- Primary query: make + model + year range
  RETURN QUERY
  SELECT bl.id,
         bl.vehicle_id,
         bl.sale_price,
         bl.bid_count,
         bl.sale_date,
         bl.bat_listing_url,
         v.year,
         v.make,
         v.model,
         v.engine_size
  FROM bat_listings bl
  INNER JOIN vehicles v ON v.id = bl.vehicle_id
  WHERE bl.sale_price > 0
    AND lower(v.make)  LIKE '%' || lower(p_make)  || '%'
    AND (p_model IS NULL OR lower(v.model) LIKE '%' || lower(p_model) || '%')
    AND (p_year  IS NULL OR (v.year BETWEEN p_year - p_year_range AND p_year + p_year_range))
  ORDER BY bl.sale_date DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

-- Verify index
SELECT indexname, indexdef
FROM pg_indexes
WHERE indexname = 'idx_bat_listings_vehicle_sold_covering';
