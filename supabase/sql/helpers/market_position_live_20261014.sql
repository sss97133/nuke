-- Live on production 2026-10-14 (pg_get_functiondef).
CREATE OR REPLACE FUNCTION public.market_position(p_dimension text, p_limit integer DEFAULT 120)
 RETURNS TABLE(name text, volume bigint, sell_through integer, demand integer, avg_year integer, median_price bigint, total_value bigint, p25 bigint, p50 bigint, p75 bigint, price_n integer, watch_sum bigint, watch_n integer, auction_med bigint, market_med bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT name, volume, sell_through, demand, avg_year, median_price,
         total_value, p25, p50, p75, price_n, watch_sum, watch_n, auction_med, market_med
  FROM mv_market_position
  WHERE dim = p_dimension AND volume >= 5
  ORDER BY volume DESC
  LIMIT p_limit;
$function$

;
