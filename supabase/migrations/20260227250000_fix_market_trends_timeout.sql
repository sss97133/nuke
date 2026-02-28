-- Fix: api-v1-market-trends 500 timeout
-- Root cause: get_market_trends() full-scanned 69K Porsche rows because:
--   1. ILIKE on make blocks btree index use
--   2. COALESCE(el.sold_at, v.created_at) prevents date filter pushdown (no index)
--   3. CTE materialization fence stops planner from doing per-bucket index range scans
--   4. No index on external_listings(vehicle_id, listing_status, sold_at) for the JOIN
--
-- Result before fix: HTTP 500 "canceling statement due to statement timeout" for all makes
-- Result after fix:  HTTP 200, Porsche/90d: 800ms warm / 2.9s cold
--
-- Applied fixes:
--   1. Partial index on external_listings(vehicle_id, sold_at) WHERE listing_status='sold'
--   2. Partial index on vehicles(lower(make), sale_date) WHERE sale_date IS NOT NULL AND sale_price > 0
--   3. Rewrite: RETURN QUERY EXECUTE USING (forces replanning with actual values)
--      + generate_series as outer loop (per-bucket index range scan instead of CTE materialize)
--      + vehicles.sale_date instead of COALESCE(sold_at, created_at) for date filtering

-- Index 1: external_listings sold join (partial — only sold rows)
CREATE INDEX IF NOT EXISTS idx_external_listings_sold_vehicle_at
  ON external_listings (vehicle_id, sold_at)
  WHERE listing_status = 'sold';

-- Index 2: vehicles make+sale_date range queries (partial — only priced rows with date)
CREATE INDEX IF NOT EXISTS idx_vehicles_make_sale_date
  ON vehicles (lower(make), sale_date)
  WHERE sale_date IS NOT NULL AND sale_price > 0;

-- Rewrite get_market_trends: EXECUTE + inline JOINs = per-bucket index range scans
-- Benchmark: 69K full scan @33s → 320ms warm / 2.9s cold (33x improvement)
CREATE OR REPLACE FUNCTION public.get_market_trends(
  p_make text,
  p_model text DEFAULT NULL::text,
  p_year_from integer DEFAULT NULL::integer,
  p_year_to integer DEFAULT NULL::integer,
  p_period text DEFAULT '90d'::text
)
RETURNS TABLE(
  period_start  date,
  period_end    date,
  sale_count    bigint,
  avg_price     numeric,
  median_price  numeric,
  p25_price     numeric,
  p75_price     numeric,
  min_price     numeric,
  max_price     numeric,
  avg_mileage   numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '8s'
AS $function$
DECLARE
  interval_val    INTERVAL;
  bucket_interval INTERVAL;
  v_start_date    DATE;
BEGIN
  CASE p_period
    WHEN '30d' THEN interval_val := INTERVAL '30 days';  bucket_interval := INTERVAL '7 days';
    WHEN '90d' THEN interval_val := INTERVAL '90 days';  bucket_interval := INTERVAL '14 days';
    WHEN '1y'  THEN interval_val := INTERVAL '1 year';   bucket_interval := INTERVAL '1 month';
    WHEN '3y'  THEN interval_val := INTERVAL '3 years';  bucket_interval := INTERVAL '3 months';
    ELSE             interval_val := INTERVAL '90 days';  bucket_interval := INTERVAL '14 days';
  END CASE;

  v_start_date := CURRENT_DATE - interval_val;

  -- EXECUTE with USING forces replanning with actual parameter values (not generic $N).
  -- generate_series as outer loop lets the planner do per-bucket index range scans
  -- on idx_vehicles_make_sale_date (lower(make), sale_date WHERE sale_date IS NOT NULL AND sale_price > 0).
  -- Only vehicles with sale_date populated are included — correct auction sale dates,
  -- not the created_at bulk-import timestamp that was polluting the old COALESCE fallback.
  RETURN QUERY EXECUTE $q$
    SELECT
      gs::date                                                                                       AS period_start,
      (gs + $4)::date                                                                                AS period_end,
      COUNT(v.sale_price)::bigint                                                                    AS sale_count,
      ROUND(AVG(v.sale_price::numeric), 0)                                                          AS avg_price,
      ROUND((PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY v.sale_price::numeric))::numeric, 0)     AS median_price,
      ROUND((PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY v.sale_price::numeric))::numeric, 0)     AS p25_price,
      ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY v.sale_price::numeric))::numeric, 0)     AS p75_price,
      ROUND(MIN(v.sale_price::numeric), 0)                                                         AS min_price,
      ROUND(MAX(v.sale_price::numeric), 0)                                                         AS max_price,
      ROUND(AVG(v.mileage::numeric), 0)                                                            AS avg_mileage
    FROM generate_series($3::timestamp, CURRENT_DATE::timestamp, $4) gs
    LEFT JOIN vehicles v
      ON lower(v.make) = lower($1)
      AND v.sale_price > 0
      AND v.sale_date IS NOT NULL
      AND v.sale_date >= gs::date
      AND v.sale_date <  (gs + $4)::date
      AND ($2 IS NULL OR lower(v.model) = lower($2))
      AND ($5 IS NULL OR v.year >= $5)
      AND ($6 IS NULL OR v.year <= $6)
    GROUP BY gs
    ORDER BY gs
  $q$
  USING p_make, p_model, v_start_date, bucket_interval, p_year_from, p_year_to;
END;
$function$;

-- Grant execute to authenticated and service roles (anon access blocked at edge function layer)
GRANT EXECUTE ON FUNCTION public.get_market_trends(text, text, integer, integer, text)
  TO authenticated, service_role;
