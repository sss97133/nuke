CREATE INDEX IF NOT EXISTS idx_bat_listings_vehicle_sold_covering
  ON bat_listings (vehicle_id, sale_date DESC NULLS LAST)
  INCLUDE (sale_price, bid_count, bat_listing_url)
  WHERE sale_price > 0;

ANALYZE bat_listings;
ANALYZE vehicles;

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
