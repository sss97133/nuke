-- Internal (no app callers) raw sale_price readers -> trusted USD sale price:
-- untrusted (contradicted/unverified copy) -> NULL, non-USD -> sale_price_usd. asking_price fallback kept.
-- Rollback: supabase/rollbacks/20261026014000_internal_readers_usd_trusted_down.sql
CREATE OR REPLACE FUNCTION public.get_squarebody_stats(p_year_min integer DEFAULT 1973, p_year_max integer DEFAULT 1991, p_model_filter text DEFAULT NULL::text)
 RETURNS TABLE(total_count bigint, avg_price numeric, min_price numeric, max_price numeric, with_images bigint, source_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH squarebodies AS (
    SELECT v.id, COALESCE((CASE WHEN public.vehicle_sale_price_untrusted(v.id, v.sale_price) THEN NULL WHEN coalesce(v.sale_price_currency, 'USD') = 'USD' THEN v.sale_price ELSE v.sale_price_usd END), v.asking_price) as price
    FROM vehicles v
    WHERE v.year BETWEEN p_year_min AND p_year_max
      AND is_squarebody(v.year, v.make, v.model)
      AND (p_model_filter IS NULL OR LOWER(v.model) ~ p_model_filter)
  )
  SELECT
    COUNT(*)::BIGINT as total_count,
    COALESCE(AVG(price) FILTER (WHERE price > 0), 0)::NUMERIC as avg_price,
    COALESCE(MIN(price) FILTER (WHERE price > 0), 0)::NUMERIC as min_price,
    COALESCE(MAX(price) FILTER (WHERE price > 0), 0)::NUMERIC as max_price,
    (SELECT COUNT(DISTINCT vi.vehicle_id) FROM vehicle_images vi WHERE vi.vehicle_id IN (SELECT id FROM squarebodies LIMIT 500))::BIGINT as with_images,
    (SELECT COUNT(DISTINCT v2.discovery_source) FROM vehicles v2 WHERE v2.id IN (SELECT id FROM squarebodies))::BIGINT as source_count
  FROM squarebodies;
END;
$function$;

CREATE OR REPLACE FUNCTION public.make_stats(p_make text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  result jsonb;
  total_count bigint;
  with_price bigint;
  with_vin bigint;
  with_images bigint;
  price_stats record;
  top_models jsonb;
  top_sources jsonb;
  year_dist jsonb;
BEGIN
  -- Basic counts
  SELECT 
    count(*),
    count(*) FILTER (WHERE COALESCE((CASE WHEN public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price) THEN NULL WHEN coalesce(vehicles.sale_price_currency, 'USD') = 'USD' THEN vehicles.sale_price ELSE vehicles.sale_price_usd END), asking_price) IS NOT NULL),
    count(*) FILTER (WHERE vin IS NOT NULL),
    count(*) FILTER (WHERE primary_image_url IS NOT NULL OR image_count > 0)
  INTO total_count, with_price, with_vin, with_images
  FROM vehicles
  WHERE make ILIKE p_make;
  
  -- Price stats
  SELECT 
    MIN(p)::numeric AS price_low,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p)::numeric AS price_median,
    MAX(p)::numeric AS price_high
  INTO price_stats
  FROM (
    SELECT COALESCE((CASE WHEN public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price) THEN NULL WHEN coalesce(vehicles.sale_price_currency, 'USD') = 'USD' THEN vehicles.sale_price ELSE vehicles.sale_price_usd END), asking_price) AS p
    FROM vehicles
    WHERE make ILIKE p_make AND COALESCE((CASE WHEN public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price) THEN NULL WHEN coalesce(vehicles.sale_price_currency, 'USD') = 'USD' THEN vehicles.sale_price ELSE vehicles.sale_price_usd END), asking_price) IS NOT NULL
      AND COALESCE((CASE WHEN public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price) THEN NULL WHEN coalesce(vehicles.sale_price_currency, 'USD') = 'USD' THEN vehicles.sale_price ELSE vehicles.sale_price_usd END), asking_price) > 0
  ) prices;
  
  -- Top 10 models
  SELECT COALESCE(jsonb_agg(row_to_json(m)::jsonb), '[]'::jsonb) INTO top_models
  FROM (
    SELECT model, count(*)::int AS count
    FROM vehicles
    WHERE make ILIKE p_make AND model IS NOT NULL
    GROUP BY model
    ORDER BY count DESC
    LIMIT 10
  ) m;
  
  -- Top 5 sources
  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) INTO top_sources
  FROM (
    SELECT COALESCE(source, 'unknown') AS source, count(*)::int AS count
    FROM vehicles
    WHERE make ILIKE p_make
    GROUP BY source
    ORDER BY count DESC
    LIMIT 5
  ) s;
  
  -- Year distribution by decade
  SELECT COALESCE(jsonb_agg(row_to_json(d)::jsonb), '[]'::jsonb) INTO year_dist
  FROM (
    SELECT 
      (year / 10 * 10)::text || 's' AS decade,
      count(*)::int AS count
    FROM vehicles
    WHERE make ILIKE p_make AND year IS NOT NULL
    GROUP BY year / 10
    ORDER BY year / 10
  ) d;
  
  result := jsonb_build_object(
    'make', p_make,
    'total_vehicles', total_count,
    'total_with_price', with_price,
    'total_with_vin', with_vin,
    'total_with_images', with_images,
    'price_low', price_stats.price_low,
    'price_median', price_stats.price_median,
    'price_high', price_stats.price_high,
    'top_models', top_models,
    'top_sources', top_sources,
    'year_distribution', year_dist
  );
  
  RETURN result;
END;
$function$;
