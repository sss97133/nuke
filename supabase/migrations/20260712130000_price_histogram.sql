-- price_histogram: log-spaced price distribution buckets for any cohort filter.
-- The data organ behind the Pulse 'bell curve' distribution views (FIND organ,
-- docs/features/explore/THEORY.md). Deployed to prod 2026-07-12.
CREATE OR REPLACE FUNCTION price_histogram(p_filters jsonb DEFAULT '{}'::jsonb, p_buckets int DEFAULT 40)
RETURNS TABLE(bucket int, lo bigint, hi bigint, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH priced AS (
    SELECT COALESCE(sale_price, sold_price, canonical_sold_price)::numeric AS p
    FROM vehicles
    WHERE is_public AND deleted_at IS NULL
      AND COALESCE(sale_price, sold_price, canonical_sold_price) > 500
      AND COALESCE(sale_price, sold_price, canonical_sold_price) < 10000000
      AND (p_filters->>'make'  IS NULL OR make = p_filters->>'make')
      AND (p_filters->>'model' IS NULL OR model = p_filters->>'model')
      AND (p_filters->>'year'  IS NULL OR year::text = p_filters->>'year')
  ), b AS (
    SELECT width_bucket(ln(p), ln(500), ln(10000000), p_buckets) AS wb FROM priced
  )
  SELECT wb,
         round(exp(ln(500) + (ln(10000000)-ln(500)) * (wb-1) / p_buckets))::bigint,
         round(exp(ln(500) + (ln(10000000)-ln(500)) *  wb    / p_buckets))::bigint,
         count(*)
  FROM b GROUP BY wb ORDER BY wb;
$fn$;
GRANT EXECUTE ON FUNCTION price_histogram(jsonb, int) TO anon, authenticated;
