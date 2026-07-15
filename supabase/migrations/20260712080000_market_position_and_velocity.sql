-- market_position + velocity-at-every-level for the iOS Pulse heatmap.
-- The Pulse treemap colors cells by SELL-THROUGH velocity (finviz convention: color =
-- performance, not size). market_position (make-level matview) drives the make view;
-- market_pulse_filtered now also returns sell_through so drilling make->model->year
-- stays a heatmap. Applied to prod 2026-07-12.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_market_position AS
WITH v AS (
  SELECT make, bat_watchers AS watch, year,
         COALESCE(sale_price, sold_price, canonical_sold_price) AS price,
         (sale_status='sold' OR auction_status='sold') AS is_sold
  FROM vehicles WHERE is_public AND make IS NOT NULL
)
SELECT 'make'::text dim, make name, count(*)::bigint volume,
       round(100.0*count(*) FILTER (WHERE is_sold)/count(*))::int sell_through,
       round(avg(watch))::int demand,
       round(avg(year))::int avg_year,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price
FROM v GROUP BY make;
CREATE UNIQUE INDEX IF NOT EXISTS mv_market_position_pk ON mv_market_position(dim, name);

CREATE OR REPLACE FUNCTION market_position(p_dimension text, p_limit int DEFAULT 120)
RETURNS TABLE(name text, volume bigint, sell_through int, demand int, avg_year int, median_price bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT name, volume, sell_through, demand, avg_year, median_price
  FROM mv_market_position WHERE dim = p_dimension AND volume >= 5 ORDER BY volume DESC LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION market_position(text,int) TO anon, authenticated;

-- market_pulse_filtered gains sell_through (the recreated definition lives in
-- 20260712070000_pulse_filtered_recursive.sql's family; this records the velocity add).
-- Full current body is generated in-app; see that migration + this note for the schema.
