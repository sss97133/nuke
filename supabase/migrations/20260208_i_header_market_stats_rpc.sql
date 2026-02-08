-- Header popover market stats RPC functions
-- Used by Year/Make/Model clickable segments in VehicleHeader

-- 1. Year market stats
CREATE OR REPLACE FUNCTION get_year_market_stats(p_year integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH year_vehicles AS (
    SELECT sale_price, make, auction_outcome, sale_status
    FROM vehicles
    WHERE year = p_year AND sale_price > 0
  ),
  stats AS (
    SELECT
      count(*) as total_listings,
      round(avg(sale_price)) as avg_price,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price) as median_price,
      count(*) FILTER (WHERE sale_status = 'sold' OR auction_outcome = 'sold') as sold_count
    FROM year_vehicles
  ),
  top_makes AS (
    SELECT make, count(*) as count
    FROM year_vehicles
    WHERE make IS NOT NULL AND make != ''
    GROUP BY make
    ORDER BY count DESC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'year', p_year,
    'total_listings', s.total_listings,
    'avg_price', s.avg_price,
    'median_price', round(s.median_price::numeric),
    'sell_through_pct', CASE WHEN s.total_listings > 0
      THEN round(s.sold_count::numeric / s.total_listings, 2)
      ELSE NULL END,
    'top_makes', coalesce((SELECT jsonb_agg(jsonb_build_object('make', tm.make, 'count', tm.count)) FROM top_makes tm), '[]'::jsonb)
  ) INTO result
  FROM stats s;

  RETURN coalesce(result, jsonb_build_object('year', p_year));
END;
$$;

-- 2. Make market stats
CREATE OR REPLACE FUNCTION get_make_market_stats(p_make text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result jsonb;
  trend_row record;
BEGIN
  WITH make_vehicles AS (
    SELECT sale_price, coalesce(normalized_model, model) as mdl, auction_outcome, sale_status
    FROM vehicles
    WHERE lower(make) = lower(p_make) AND sale_price > 0
  ),
  stats AS (
    SELECT
      count(*) as total_listings,
      round(avg(sale_price)) as avg_price,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price) as median_price,
      count(*) FILTER (WHERE sale_status = 'sold' OR auction_outcome = 'sold') as sold_count
    FROM make_vehicles
  ),
  top_models AS (
    SELECT mdl as model, count(*) as count, round(avg(sale_price)) as avg_price
    FROM make_vehicles
    WHERE mdl IS NOT NULL AND mdl != ''
    GROUP BY mdl
    ORDER BY count DESC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'make', p_make,
    'total_listings', s.total_listings,
    'avg_price', s.avg_price,
    'median_price', round(s.median_price::numeric),
    'sell_through_pct', CASE WHEN s.total_listings > 0
      THEN round(s.sold_count::numeric / s.total_listings, 2)
      ELSE NULL END,
    'top_models', coalesce((SELECT jsonb_agg(jsonb_build_object('model', tm.model, 'count', tm.count, 'avg_price', tm.avg_price)) FROM top_models tm), '[]'::jsonb)
  ) INTO result
  FROM stats s;

  -- Blend in market_trends sentiment if available
  SELECT INTO trend_row
    avg_sentiment_score, demand_high_pct, price_rising_pct
  FROM market_trends
  WHERE lower(make) = lower(p_make) AND model IS NULL
  ORDER BY calculated_at DESC NULLS LAST
  LIMIT 1;

  IF trend_row IS NOT NULL AND trend_row.avg_sentiment_score IS NOT NULL THEN
    result := result || jsonb_build_object(
      'sentiment_score', round(trend_row.avg_sentiment_score, 2),
      'demand_high_pct', round(trend_row.demand_high_pct, 1)
    );
  END IF;

  RETURN coalesce(result, jsonb_build_object('make', p_make));
END;
$$;

-- 3. Model market stats
CREATE OR REPLACE FUNCTION get_model_market_stats(p_make text, p_model text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  result jsonb;
  trend_row record;
  prod_row record;
BEGIN
  WITH model_vehicles AS (
    SELECT sale_price, auction_outcome, sale_status, created_at
    FROM vehicles
    WHERE lower(make) = lower(p_make)
      AND (lower(coalesce(normalized_model, model)) = lower(p_model) OR lower(model) = lower(p_model))
      AND sale_price > 0
  ),
  stats AS (
    SELECT
      count(*) as total_listings,
      round(avg(sale_price)) as avg_price,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price) as median_price,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY sale_price) as p25,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY sale_price) as p75,
      count(*) FILTER (WHERE sale_status = 'sold' OR auction_outcome = 'sold') as sold_count
    FROM model_vehicles
  ),
  days_calc AS (
    SELECT avg(EXTRACT(EPOCH FROM (now() - created_at)) / 86400) as avg_days
    FROM model_vehicles
    WHERE sale_status = 'sold' OR auction_outcome = 'sold'
  )
  SELECT jsonb_build_object(
    'make', p_make,
    'model', p_model,
    'total_listings', s.total_listings,
    'avg_price', s.avg_price,
    'median_price', round(s.median_price::numeric),
    'p25', round(s.p25::numeric),
    'p75', round(s.p75::numeric),
    'sell_through_pct', CASE WHEN s.total_listings > 0
      THEN round(s.sold_count::numeric / s.total_listings, 2)
      ELSE NULL END,
    'avg_days_on_market', round(d.avg_days::numeric)
  ) INTO result
  FROM stats s, days_calc d;

  -- Market trends
  SELECT INTO trend_row
    avg_sentiment_score, demand_high_pct, price_rising_pct, price_declining_pct
  FROM market_trends
  WHERE lower(make) = lower(p_make)
    AND lower(model) = lower(p_model)
  ORDER BY calculated_at DESC NULLS LAST
  LIMIT 1;

  IF trend_row IS NOT NULL AND trend_row.price_rising_pct IS NOT NULL THEN
    result := result || jsonb_build_object(
      'trend_direction', CASE
        WHEN trend_row.price_rising_pct > 50 THEN 'up'
        WHEN trend_row.price_declining_pct > 50 THEN 'down'
        ELSE 'stable'
      END,
      'sentiment_score', round(coalesce(trend_row.avg_sentiment_score, 0), 2),
      'demand_high_pct', round(coalesce(trend_row.demand_high_pct, 0), 1)
    );
  END IF;

  -- Heat score from nuke_estimates
  SELECT INTO result
    result || jsonb_build_object(
      'heat_score_avg', round(avg(ne.heat_score)::numeric, 1)
    )
  FROM nuke_estimates ne
  JOIN vehicles v ON v.id = ne.vehicle_id
  WHERE lower(v.make) = lower(p_make)
    AND (lower(coalesce(v.normalized_model, v.model)) = lower(p_model) OR lower(v.model) = lower(p_model))
    AND ne.heat_score IS NOT NULL;

  -- Production data
  SELECT INTO prod_row
    total_produced, rarity_level, collector_demand_score
  FROM vehicle_production_data
  WHERE lower(make) = lower(p_make)
    AND lower(model) = lower(p_model)
  ORDER BY year DESC NULLS LAST
  LIMIT 1;

  IF prod_row IS NOT NULL AND prod_row.total_produced IS NOT NULL THEN
    result := result || jsonb_build_object(
      'production_count', prod_row.total_produced,
      'rarity_label', prod_row.rarity_level,
      'collector_demand_score', prod_row.collector_demand_score
    );
  END IF;

  RETURN coalesce(result, jsonb_build_object('make', p_make, 'model', p_model));
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION get_year_market_stats(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_make_market_stats(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_model_market_stats(text, text) TO anon, authenticated, service_role;
