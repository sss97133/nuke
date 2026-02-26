-- Fix find_bat_comps statement timeout
--
-- Root cause: find_bat_comps uses ILIKE '%make%' which requires GIN trigram
-- indexes. The existing trigram indexes on vehicles.make/model are partial
-- (WHERE is_public = true) so they're skipped for bat_listings joins.
-- Also: bat_listings has no index on sale_date (used in ORDER BY) or
-- sale_price (used in WHERE filter).
--
-- Fix:
--   1. Add unrestricted trigram indexes for make + model
--   2. Add bat_listings index on (sale_price, sale_date) for filter + sort
--   3. Update find_bat_comps to use lower() so it hits the trgm index

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Unrestricted trigram indexes (no is_public filter)
--    These are additive — the existing partial ones stay for public-only queries.
CREATE INDEX IF NOT EXISTS vehicles_make_trgm_bat_idx
  ON vehicles USING GIN (lower(make) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS vehicles_model_trgm_bat_idx
  ON vehicles USING GIN (lower(model) gin_trgm_ops);

-- 2. bat_listings: filter + sort index
CREATE INDEX IF NOT EXISTS bat_listings_sold_date_idx
  ON bat_listings (sale_date DESC NULLS LAST)
  WHERE sale_price > 0;

-- 3. Rewrite find_bat_comps to use lower() — hits the trgm index
CREATE OR REPLACE FUNCTION find_bat_comps(
  p_make       text,
  p_model      text    DEFAULT NULL,
  p_year       integer DEFAULT NULL,
  p_year_range integer DEFAULT 2,
  p_limit      integer DEFAULT 200
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

-- Verify indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('vehicles', 'bat_listings')
  AND indexname IN (
    'vehicles_make_trgm_bat_idx',
    'vehicles_model_trgm_bat_idx',
    'bat_listings_sold_date_idx'
  )
ORDER BY tablename, indexname;
