-- Existing public/API market trends: a positive price is not a consummated sale.
-- Keep the legacy signature, bucket/table contract, security context, ACL and five-second limit.
-- This is one canonical recorded sale per vehicle, not all lifetime listing/sale episodes.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_market_trends(p_make text, p_model text DEFAULT NULL::text, p_year_from integer DEFAULT NULL::integer, p_year_to integer DEFAULT NULL::integer, p_period text DEFAULT '90d'::text)
 RETURNS TABLE(period_start date, period_end date, sale_count bigint, avg_price numeric, median_price numeric, p25_price numeric, p75_price numeric, min_price numeric, max_price numeric, avg_mileage numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '5s'
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  interval_val    INTERVAL;
  bucket_interval INTERVAL;
  v_start_date    DATE;
  bucket_days     INT;
BEGIN
  CASE p_period
    WHEN '30d' THEN interval_val := INTERVAL '30 days';  bucket_interval := INTERVAL '7 days';   bucket_days := 7;
    WHEN '90d' THEN interval_val := INTERVAL '90 days';  bucket_interval := INTERVAL '14 days';  bucket_days := 14;
    WHEN '1y'  THEN interval_val := INTERVAL '1 year';   bucket_interval := INTERVAL '1 month';  bucket_days := 30;
    WHEN '3y'  THEN interval_val := INTERVAL '3 years';  bucket_interval := INTERVAL '3 months'; bucket_days := 91;
    ELSE             interval_val := INTERVAL '90 days';  bucket_interval := INTERVAL '14 days';  bucket_days := 14;
  END CASE;

  v_start_date := CURRENT_DATE - interval_val;

  -- Strategy: filter vehicles once, compute bucket via integer
  -- division on (sale_date - start_date), then aggregate per bucket.
  -- Empty buckets filled via generate_series LEFT JOIN.
  -- Preserve the deployed fixed-width bucket contract; indexes are verified separately.
  RETURN QUERY EXECUTE $q$
    WITH candidates AS MATERIALIZED (
      SELECT
        v.sale_price, v.mileage, v.sale_date, v.sale_status, v.auction_outcome,
        v.canonical_platform, v.listing_url, v.discovery_url, v.notes, v.import_metadata, v.created_at
      FROM public.vehicles v
      -- Bare boolean predicate also matches the existing lower(make) public partial index.
      WHERE v.is_public
        AND v.deleted_at IS NULL
        AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
        AND lower(make) = lower($1)
        AND sale_price > 0
        AND sale_date IS NOT NULL
        AND sale_date >= $3
        AND sale_date <= CURRENT_DATE
        AND ($2 IS NULL OR lower(model) = lower($2))
        AND ($5 IS NULL OR year >= $5)
        AND ($6 IS NULL OR year <= $6)
    ),
    filtered AS (
      -- Evaluate provenance after the existing date/price/scope filter, not on every make row.
      SELECT v.sale_price, v.mileage, ((v.sale_date - $3::date) / $7) AS bucket_idx
      FROM candidates v
      WHERE public.vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform,
        v.listing_url, v.discovery_url, v.sale_price::numeric, v.notes, v.import_metadata,
        v.created_at) IS NOT NULL
    ),
    agg AS (
      SELECT
        bucket_idx,
        COUNT(sale_price)::bigint                                                     AS sale_count,
        ROUND(AVG(sale_price::numeric), 0)                                            AS avg_price,
        ROUND((PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY sale_price::numeric))::numeric, 0) AS median_price,
        ROUND((PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sale_price::numeric))::numeric, 0) AS p25_price,
        ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sale_price::numeric))::numeric, 0) AS p75_price,
        ROUND(MIN(sale_price::numeric), 0)                                            AS min_price,
        ROUND(MAX(sale_price::numeric), 0)                                            AS max_price,
        ROUND(AVG(mileage::numeric), 0)                                               AS avg_mileage
      FROM filtered
      GROUP BY bucket_idx
    ),
    all_buckets AS (
      SELECT gs AS bucket_idx
      FROM generate_series(0, (CURRENT_DATE - $3::date) / $7) gs
    )
    SELECT
      ($3::date + ab.bucket_idx * $7)                AS period_start,
      ($3::date + ab.bucket_idx * $7 + $7)           AS period_end,
      COALESCE(a.sale_count, 0)::bigint              AS sale_count,
      a.avg_price,
      a.median_price,
      a.p25_price,
      a.p75_price,
      a.min_price,
      a.max_price,
      a.avg_mileage
    FROM all_buckets ab
    LEFT JOIN agg a ON a.bucket_idx = ab.bucket_idx
    ORDER BY ab.bucket_idx
  $q$
  USING p_make, p_model, v_start_date, bucket_interval, p_year_from, p_year_to, bucket_days;
END;
$function$;

COMMENT ON FUNCTION public.get_market_trends(text,text,integer,integer,text) IS
  'Legacy make/model/year-window trends over positive sale_price with a known sale_date, gated to explicit public, nondeleted real vehicle parents and vehicle_sale_basis supported sale provenance. One canonical recorded sale per vehicle; repeated source sale episodes are not counted. Original fixed-width buckets, table result, security context and five-second timeout retained; pinned public,pg_temp and qualified relations/helper. Prices are recorded numeric units with currency unverified; raw composition changes are not a market return. No source-read freshness, complete capture, historical knowledge-as-of, valuation or condition-equivalence claim. Existing zero-filled/partially elapsed buckets remain a compatibility behavior; consumers must not treat missing outcomes as zero demand.';
SELECT count(*) AS lock_waiters FROM pg_stat_activity WHERE wait_event_type = 'Lock';
COMMIT;
