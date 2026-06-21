-- Valuation lookup by (year, make, model)
-- Query bat_listings × vehicles for real sold-price stats and top comparables.
-- Per-YMM lookup is fast thanks to idx_vehicles_ymm; full-table aggregation is not needed.

CREATE OR REPLACE FUNCTION public.valuation_by_ymm(
  p_year   integer DEFAULT NULL,
  p_make   text    DEFAULT NULL,
  p_model  text    DEFAULT NULL   -- prefix match (LIKE 'model%')
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats        jsonb;
  v_comparables  jsonb;
  v_match_count  integer;
BEGIN
  -- Require at least make + (year or model) for a meaningful query
  IF p_make IS NULL OR (p_year IS NULL AND p_model IS NULL) THEN
    RETURN jsonb_build_object(
      'error', 'must provide p_make and at least one of p_year/p_model',
      'stats', NULL, 'comparables', '[]'::jsonb
    );
  END IF;

  -- De-dup matched listings by trailing-slash-normalized URL
  WITH matched AS (
    SELECT DISTINCT ON (rtrim(bl.bat_listing_url, '/'))
      bl.sale_date,
      bl.sale_price,
      bl.bid_count,
      bl.comment_count,
      bl.bat_listing_url,
      bl.bat_listing_title,
      v.year, v.make, v.model
    FROM bat_listings bl
    JOIN vehicles v ON v.id = bl.vehicle_id
    WHERE bl.sale_price > 0
      AND lower(v.make) = lower(p_make)
      AND (p_year  IS NULL OR v.year = p_year)
      AND (p_model IS NULL OR lower(v.model) LIKE lower(p_model) || '%')
    ORDER BY rtrim(bl.bat_listing_url, '/'), bl.sale_date DESC NULLS LAST
  )
  SELECT
    jsonb_build_object(
      'sold_count',        count(*),
      'median',            percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price)::int,
      'p10',               percentile_cont(0.1) WITHIN GROUP (ORDER BY sale_price)::int,
      'p90',               percentile_cont(0.9) WITHIN GROUP (ORDER BY sale_price)::int,
      'min',               min(sale_price),
      'max',               max(sale_price),
      'avg',               round(avg(sale_price))::int,
      'last_sale',         max(sale_date),
      'first_sale',        min(sale_date),
      'avg_bid_count',     round(avg(bid_count)::numeric, 1),
      'avg_comment_count', round(avg(comment_count)::numeric, 1)
    ),
    count(*)
  INTO v_stats, v_match_count
  FROM matched;

  -- Top 10 most-recent comparable sales (de-duplicated)
  WITH matched_dedup AS (
    SELECT DISTINCT ON (rtrim(bl.bat_listing_url, '/'))
      bl.sale_date,
      bl.sale_price,
      bl.bid_count,
      bl.comment_count,
      bl.bat_listing_url,
      bl.bat_listing_title,
      v.year, v.make, v.model
    FROM bat_listings bl
    JOIN vehicles v ON v.id = bl.vehicle_id
    WHERE bl.sale_price > 0
      AND lower(v.make) = lower(p_make)
      AND (p_year  IS NULL OR v.year = p_year)
      AND (p_model IS NULL OR lower(v.model) LIKE lower(p_model) || '%')
    ORDER BY rtrim(bl.bat_listing_url, '/'), bl.sale_date DESC NULLS LAST
  )
  SELECT coalesce(jsonb_agg(t), '[]'::jsonb)
  INTO v_comparables
  FROM (
    SELECT
      sale_date,
      sale_price,
      bid_count,
      comment_count,
      bat_listing_url,
      bat_listing_title,
      year, make, model
    FROM matched_dedup
    ORDER BY sale_date DESC NULLS LAST
    LIMIT 10
  ) t;

  -- Outlier flag: max sale price more than 5x median suggests bad data
  IF v_match_count >= 3 AND (v_stats->>'max')::numeric > (v_stats->>'median')::numeric * 5 THEN
    v_stats := v_stats || jsonb_build_object('possible_outlier', true);
  END IF;

  RETURN jsonb_build_object(
    'query', jsonb_build_object('year', p_year, 'make', p_make, 'model', p_model),
    'stats', v_stats,
    'comparables', v_comparables
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.valuation_by_ymm(integer, text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.valuation_by_ymm IS
'Vehicle valuation by year/make/model. Returns median/p10/p90/range plus top 10 most-recent comparable BaT sales. Built on real sold prices, de-duplicated by listing URL.';
