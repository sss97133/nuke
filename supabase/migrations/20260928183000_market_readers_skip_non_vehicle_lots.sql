-- Market readers skip non-vehicle lots (decision 5, Skylar 2026-09-28).
--
-- pcarmarket sold watches, scale models, signs, seats, wheels, engines and tool kits that were imported as cars;
-- 115 were marked listing_kind 'non_vehicle_item' through correct_vehicle_sale_provenance_batch (2026-09-28
-- 17:22Z, cited to each lot's own auction URL). Until now no market reader looked at listing_kind, so e.g. ten
-- "1982 Porsche 911SC Targa" rows (a Lotus sign $125, a Ferrari calendar $475, a Rolex $6,731 ...) sat in the
-- 1982 911 market's sales. Each function below is its live prod definition plus one predicate:
-- listing_kind IS DISTINCT FROM 'non_vehicle_item' (the column allows 'vehicle' | 'non_vehicle_item' | NULL).
--   * cohort_members          → get_make_model_terminal (/cohort), sentiment points, class-stratified price
--   * get_model_market_stats  → vehicle page model stats
--   * get_model_price_history → vehicle page price chart
-- Owners, ACLs, SECURITY DEFINER and SET clauses are part of the definitions / survive CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.cohort_members(p_subject_id uuid)
 RETURNS TABLE(vehicle_id uuid)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE p record; alts text; pattern text;
BEGIN
  SELECT * INTO p FROM public.make_model_profiles WHERE subject_id = p_subject_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT string_agg(
           regexp_replace(lower(t), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g'), '|')
    INTO alts
  FROM (
    SELECT lower(p.canonical_model) AS t
    UNION
    SELECT lower(a) FROM public.canonical_models cm, unnest(cm.aliases) a
     WHERE cm.id = p.canonical_model_id
  ) s
  WHERE t IS NOT NULL AND length(trim(t)) > 0;

  IF alts IS NULL OR alts = '' THEN RETURN; END IF;
  pattern := '\y(' || alts || ')\y';

  IF p.grain = 'year' THEN
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year = %s AND lower(v.model) ~ %L
          AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item''',
      p.canonical_make, p.year, pattern);
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT v.id FROM public.vehicles v
        WHERE lower(v.make) = lower(%L) AND v.year BETWEEN %s AND %s AND lower(v.model) ~ %L
          AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item''',
      p.canonical_make, p.year_start, p.year_end, pattern);
  END IF;
END;
$function$;

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
    WHERE is_public AND deleted_at IS NULL AND listing_kind IS DISTINCT FROM 'non_vehicle_item'
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
    WHERE v.is_public AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
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
      AND listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND vehicle_sale_basis(sale_status, auction_outcome, canonical_platform, listing_url, discovery_url,
                             sale_price::numeric, notes, import_metadata, created_at) IS NOT NULL
    ORDER BY sale_date DESC
    LIMIT least(greatest(coalesce(p_limit, 30), 1), 500)
  ) v;

  RETURN result;
END;
$function$;
