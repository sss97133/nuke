-- get_model_market_stats + get_model_price_history run as definer over exactly what a visitor can see.
--
-- Both were SECURITY INVOKER, so a visitor's call ran under vehicles' row security. The public policy
-- (is_public = true OR auth.role() = 'service_role') is a security barrier, and lower() is not leakproof, so
-- the planner may not apply the lower(make)/lower(model) index conditions before the policy: every anon call
-- scanned vehicles. Measured 2026-09-28 01:45Z through PostgREST with the anon key: get_model_price_history
-- 10–15 s and 57014 timeouts (Porsche 911 1979–85, Pontiac Fiero, Ford Mustang); as the owner the same queries
-- run 0.3–2.4 s, and a plain count of Pontiac Fieros ran > 60 s under SET ROLE anon vs 0.4 s as owner.
--
-- Now SECURITY DEFINER with a pinned search_path, and the visibility rule written into the query: is_public
-- (the anon read policy) and not deleted. Callers see the same public set they saw before, minus deleted rows;
-- signed-in owners' private cars no longer enter model-wide market numbers. Bodies otherwise byte-identical
-- to 79ed0dae3 / 6ac552ce7. Grants unchanged (anon, authenticated, service_role).
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

  -- Heat score from nuke_estimates
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

CREATE OR REPLACE FUNCTION public.get_model_price_history(p_make text, p_model text, p_limit integer DEFAULT 30, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', v.sale_date,
        'price', v.sale_price,
        'vehicle_id', v.id,
        'year', v.year,
        'model', v.model,
        'platform', v.platform
      ) ORDER BY v.sale_date ASC
    ),
    '[]'::jsonb
  ) INTO result
  FROM (
    SELECT id, year, model, sale_date, sale_price, coalesce(nullif(canonical_platform, 'unknown'), platform_source) AS platform
    FROM vehicles
    WHERE is_public
      AND lower(make) = lower(p_make)
      AND (lower(model) = lower(p_model) OR lower(normalized_model) = lower(p_model))
      AND (p_year_min IS NULL OR year >= p_year_min)
      AND (p_year_max IS NULL OR year <= p_year_max)
      AND sale_price > 0
      AND sale_date IS NOT NULL
      AND deleted_at IS NULL
      AND vehicle_sale_basis(sale_status, auction_outcome, canonical_platform, listing_url, discovery_url,
                             sale_price::numeric, notes, import_metadata, created_at) IS NOT NULL
    ORDER BY sale_date DESC
    LIMIT least(greatest(coalesce(p_limit, 30), 1), 500)
  ) v;

  RETURN result;
END;
$function$;

RESET lock_timeout;
RESET statement_timeout;
