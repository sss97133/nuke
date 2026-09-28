-- get_model_market_stats: the heat-score average only for model families of up to 3,000 priced cars.
--
-- Measured 2026-09-28 ~01:50Z as the function runs now (definer, 45884cbe5), Porsche 911: the model rows 6.6 s
-- (15,000 rows, 26,119 blocks from disk) and the nuke_estimates join for heat_score_avg 19.0 s — over the
-- visitors' 15 s statement timeout (57014 for Porsche 911, Ford Mustang, Chevrolet Corvette; Pontiac Fiero
-- answered in 0.46 s). The average is decoration, null-guarded where shown (VehicleHeader model popover,
-- ModelPortal HeatGauge); above the cap it is left out. Everything else byte-identical.
SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.get_model_market_stats(p_make text, p_model text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
  trend_row record;
  prod_row record;
BEGIN
  WITH model_vehicles AS (
    SELECT sale_price, auction_outcome, sale_status, created_at
    FROM vehicles
    WHERE is_public AND deleted_at IS NULL
      AND lower(make) = lower(p_make)
      AND (lower(model) = lower(p_model) OR lower(normalized_model) = lower(p_model))
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

  -- Heat score from nuke_estimates: one estimate lookup per car, so only for a family of up to 3,000 priced
  -- cars. Porsche 911 (15,000) spent 19 s here and timed the call out for visitors (2026-09-28); above the
  -- cap the key is absent and the header popover / ModelPortal simply show no gauge.
  IF coalesce((result->>'total_listings')::int, 0) <= 3000 THEN
    SELECT INTO result
      result || jsonb_build_object(
        'heat_score_avg', round(avg(ne.heat_score)::numeric, 1)
      )
    FROM nuke_estimates ne
    JOIN vehicles v ON v.id = ne.vehicle_id
    WHERE v.is_public AND v.deleted_at IS NULL
      AND lower(v.make) = lower(p_make)
      AND (lower(v.model) = lower(p_model) OR lower(v.normalized_model) = lower(p_model))
      AND ne.heat_score IS NOT NULL;
  END IF;

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
$function$;

RESET lock_timeout;
RESET statement_timeout;
