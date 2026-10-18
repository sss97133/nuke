-- get_model_market_stats: the model match becomes index-backed; same rows, same answer.
--
-- The match was  lower(coalesce(normalized_model, model)) = m OR lower(model) = m.  The coalesce form
-- matches no index, so every call read every priced car of the make from the heap and filtered there.
-- Rewritten as  lower(model) = m OR lower(normalized_model) = m  (identical for NULL and non-NULL
-- normalized_model), with a (lower(make), lower(normalized_model)) index beside the existing
-- idx_vehicles_lower_make_model, so the planner ORs two index scans and reads only the matching cars.
-- normalized_model differs from model on 4,740 of 8,966 priced Pontiacs, so the second arm is needed.
--
-- Measured 2026-09-27: pg_stat_statements since 09-24 — 285 calls, mean 21,062 ms, max 59,268 ms,
-- 6,003 s of database time; eight ran at once at 22:47Z (13–57 s each, all on DataFileRead) while the host
-- sat at load1 20.8 on 4 GB. EXPLAIN ANALYZE, Pontiac / Fiero: current predicate 24,338 ms, 14,075 heap
-- blocks (9,647 from disk), 309 rows; the model arm alone on the existing index 638 ms, 184 buffers.
-- Callers: feed BrandHeartbeat / ModelPortal (useModelMarketStats), the vehicle header's model popover,
-- enrich-msrp.
--
-- Index build: CONCURRENTLY (writers keep writing); vehicles heap is 2.4 GB. lock_timeout covers the wait
-- for older snapshots (the longest statements here run <= 60 s).
SET statement_timeout = '900s';
SET lock_timeout = '180s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_lower_make_normalized_model
  ON public.vehicles (lower(make), lower(normalized_model));

-- An interrupted concurrent build leaves an INVALID index that IF NOT EXISTS would then skip.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'public.idx_vehicles_lower_make_normalized_model'::regclass AND NOT i.indisvalid
  ) THEN
    RAISE EXCEPTION 'idx_vehicles_lower_make_normalized_model is INVALID; DROP INDEX CONCURRENTLY public.idx_vehicles_lower_make_normalized_model and re-run';
  END IF;
END $$;

-- expression statistics for the new index (ANALYZE samples 30,000 rows)
ANALYZE public.vehicles;

CREATE OR REPLACE FUNCTION public.get_model_market_stats(p_make text, p_model text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  result jsonb;
  trend_row record;
  prod_row record;
BEGIN
  WITH model_vehicles AS (
    SELECT sale_price, auction_outcome, sale_status, created_at
    FROM vehicles
    WHERE lower(make) = lower(p_make)
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
  WHERE lower(v.make) = lower(p_make)
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

RESET lock_timeout;
RESET statement_timeout;
