-- One rule for every reader of vehicles.sale_price: the stored price is untrusted when it was copied
-- from an event marked unverified/contradicted (and no trusted, non-duplicate event carries the same price),
-- or when a verified event disagrees with it (stale) and no verified event agrees.
create or replace function public.vehicle_sale_price_untrusted(p_vehicle_id uuid, p_sale_price numeric)
returns boolean language sql stable parallel safe as $f$
  select p_sale_price is not null and (
    (exists (select 1 from public.vehicle_events pv where pv.vehicle_id = p_vehicle_id
              and pv.price_verification in ('unverified','contradicted') and pv.final_price = p_sale_price)
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.final_price = p_sale_price and (ok.price_verification is null or ok.price_verification = 'verified')
              and ok.sale_truth_role is distinct from 'duplicate'))
    or
    (exists (select 1 from public.vehicle_events pv where pv.vehicle_id = p_vehicle_id
              and pv.price_verification = 'verified' and pv.final_price <> p_sale_price)
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.price_verification = 'verified' and ok.final_price = p_sale_price))
  )
$f$;
comment on function public.vehicle_sale_price_untrusted(uuid, numeric) is
  'True when vehicles.sale_price must not be used as a sale price (see vehicle_events.price_verification). Readers: AND NOT vehicle_sale_price_untrusted(v.id, v.sale_price).';

CREATE OR REPLACE FUNCTION public.get_comp_tiers(p_year integer, p_make text, p_model_root text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  project_count INT; project_avg REAL; project_min REAL; project_max REAL;
  driver_count INT; driver_avg REAL; driver_min REAL; driver_max REAL;
  restomod_count INT; restomod_avg REAL; restomod_min REAL; restomod_max REAL;
  show_count INT; show_avg REAL; show_min REAL; show_max REAL;
  model_pattern TEXT;
BEGIN
  model_pattern := '%' || LOWER(p_model_root) || '%';

  -- Project tier: $0-$20K
  SELECT COUNT(*), ROUND(AVG(sale_price)::numeric), MIN(sale_price), MAX(sale_price)
  INTO project_count, project_avg, project_min, project_max
  FROM vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND sale_price > 0 AND sale_price < 20000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  -- Driver tier: $20K-$50K
  SELECT COUNT(*), ROUND(AVG(sale_price)::numeric), MIN(sale_price), MAX(sale_price)
  INTO driver_count, driver_avg, driver_min, driver_max
  FROM vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND sale_price BETWEEN 20000 AND 50000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  -- Restomod tier: $50K-$100K
  SELECT COUNT(*), ROUND(AVG(sale_price)::numeric), MIN(sale_price), MAX(sale_price)
  INTO restomod_count, restomod_avg, restomod_min, restomod_max
  FROM vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND sale_price BETWEEN 50000 AND 100000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  -- Show tier: $100K+
  SELECT COUNT(*), ROUND(AVG(sale_price)::numeric), MIN(sale_price), MAX(sale_price)
  INTO show_count, show_avg, show_min, show_max
  FROM vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND sale_price > 100000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  RETURN jsonb_build_object(
    'project',  jsonb_build_object('count', COALESCE(project_count, 0),  'avg', project_avg,  'min', project_min,  'max', project_max),
    'driver',   jsonb_build_object('count', COALESCE(driver_count, 0),   'avg', driver_avg,   'min', driver_min,   'max', driver_max),
    'restomod', jsonb_build_object('count', COALESCE(restomod_count, 0), 'avg', restomod_avg, 'min', restomod_min, 'max', restomod_max),
    'show',     jsonb_build_object('count', COALESCE(show_count, 0),     'avg', show_avg,     'min', show_min,     'max', show_max)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_make_market_stats(p_make text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  result jsonb;
  trend_row record;
BEGIN
  WITH make_vehicles AS (
    SELECT sale_price, coalesce(normalized_model, model) as mdl, auction_outcome, sale_status
    FROM vehicles
    WHERE lower(make) = lower(p_make) AND sale_price > 0 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price)
  ),
  stats AS (
    SELECT
      count(*) as total_listings,
      round(avg(sale_price)) as avg_price,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price) as median_price,
      count(*) FILTER (WHERE sale_status = 'sold' OR auction_outcome = 'sold') as sold_count
    FROM make_vehicles
  ),
  -- Normalize model names: group by base model family, case-insensitive
  top_models AS (
    SELECT
      initcap(CASE 
        WHEN lower(mdl) ~ '^(bel air|el camino|monte carlo|k5 blazer|grand prix|grand sport|grand national|super sport|land cruiser|town car)' 
        THEN split_part(lower(mdl), ' ', 1) || ' ' || split_part(lower(mdl), ' ', 2)
        ELSE split_part(lower(mdl), ' ', 1)
      END) as model,
      count(*) as count,
      round(avg(sale_price)) as avg_price
    FROM make_vehicles
    WHERE mdl IS NOT NULL AND mdl != ''
      AND lower(mdl) NOT IN ('custom', 'pickup', 'other', 'unknown', 'custom deluxe', 'n/a', 'none', 'truck')
    GROUP BY 1
    ORDER BY count DESC
    LIMIT 15
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
      AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price)
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

CREATE OR REPLACE FUNCTION public.get_year_market_stats(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  result jsonb;
BEGIN
  WITH year_vehicles AS (
    SELECT sale_price, make, auction_outcome, sale_status
    FROM vehicles
    WHERE year = p_year AND sale_price > 0 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price)
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
$function$;

CREATE OR REPLACE FUNCTION public.get_ymm_market_index(year_min integer DEFAULT 1950, year_max integer DEFAULT 2005)
 RETURNS TABLE(year integer, make text, model text, n bigint, p25 numeric, median numeric, p75 numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT v.year::int, LOWER(v.make), LOWER(v.model),
    count(*) as n,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY v.sale_price) as p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY v.sale_price) as median,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY v.sale_price) as p75
  FROM vehicles v
  WHERE v.year BETWEEN year_min AND year_max
    AND v.sale_price > 500
    AND NOT public.vehicle_sale_price_untrusted(v.id, v.sale_price)
    AND v.status NOT IN ('deleted','merged','duplicate')
    AND v.make IS NOT NULL AND v.model IS NOT NULL
  GROUP BY v.year, LOWER(v.make), LOWER(v.model)
  HAVING count(*) >= 3;
$function$;

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
        AND NOT public.vehicle_sale_price_untrusted(v.id, v.sale_price)
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
      AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price)
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

CREATE OR REPLACE FUNCTION public.get_comps_scored(p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  w_year        constant numeric := 15;
  w_model       constant numeric := 25;
  w_engine_cyl  constant numeric := 12;
  w_engine_cfg  constant numeric := 5;
  w_trans       constant numeric := 15;
  w_drivetrain  constant numeric := 10;
  w_mileage     constant numeric := 8;
  w_body        constant numeric := 5;
  w_trim_w      constant numeric := 5;

  ref_trans     text;
  ref_cyls      integer;
  ref_eng_cfg   text;
  ref_drive     text;
BEGIN
  ref_trans    := classify_transmission(p_transmission);
  ref_cyls     := extract_cylinder_count(p_engine_type);
  ref_eng_cfg  := extract_engine_config(p_engine_type);
  ref_drive    := classify_drivetrain(p_drivetrain);

  RETURN QUERY
  WITH auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      ae.winning_bid AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ae.source_url,
      ae.source, ae.auction_end_date,
      'auction_event'::text AS src_type,
      ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM vehicles v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold'
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      v.sale_price AS price, v.mileage, v.color,
      v.primary_image_url, v.location, v.listing_url AS source_url,
      NULL::text AS source,
      -- the sale's own date (UTC midnight), so a comp from 2010 reads as 2010, not as undated
      (COALESCE(v.sale_date, v.bat_sale_date)::timestamp AT TIME ZONE 'UTC') AS auction_end_date,
      'vehicle_record'::text AS src_type,
      v.currency_code AS cur, COALESCE(v.sale_date, v.bat_sale_date) AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM vehicles v
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%'
           OR (length(public.model_spelling_key(p_model)) >= 2 AND length(public.model_spelling_key(v.model)) >= 2 AND (public.model_spelling_key(v.model) LIKE '%' || public.model_spelling_key(p_model) || '%' OR public.model_spelling_key(p_model) LIKE '%' || public.model_spelling_key(v.model) || '%')))
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND v.sale_price IS NOT NULL AND v.sale_price > 0
      -- price_verification: one shared rule (vehicle_sale_price_untrusted)
      AND NOT public.vehicle_sale_price_untrusted(v.id, v.sale_price)
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM auction_events ae2
        WHERE ae2.vehicle_id = v.id AND ae2.winning_bid > 0 AND ae2.outcome = 'sold'
      )
  ),
  raw_cands AS (
    SELECT * FROM auction_cands
    UNION ALL
    SELECT * FROM vehicle_cands
  ),
  -- native amount x sale-date USD rate (fx_usd_rate). NULL currency = legacy row, read as reported.
  conv_cands AS (
    SELECT r.*, r.price AS price_native, fx.rate AS fx_rate, fx.rate_date AS fx_rate_date,
      CASE WHEN r.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE fx.source END AS fx_source,
      CASE WHEN r.cur IS NULL THEN r.price::numeric ELSE round(r.price * fx.rate, 2) END AS price_usd
    FROM raw_cands r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  ),
  all_cands AS (
    SELECT * FROM conv_cands c
    WHERE (c.cur IS NULL OR c.fx_rate IS NOT NULL)   -- foreign amount with no rate: excluded, never read as USD
      AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
      AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ),
  scored AS (
    SELECT
      c.id AS vehicle_id,
      c.year AS yr,
      c.make AS mk,
      c.model AS mdl,
      c.trim AS tr,
      c.vin AS vi,
      c.price_usd AS sale_price,
      c.mileage AS miles,
      c.color AS clr,
      c.primary_image_url AS image_url,
      c.location AS loc,
      c.source_url AS listing_url,
      c.source AS platform,
      c.auction_end_date AS sold_date,
      c.src_type AS source_type,
      c.price_native, c.cur, c.fx_rate, c.fx_rate_date, c.fx_source,

      -- Year score
      (CASE WHEN p_year IS NOT NULL AND c.year IS NOT NULL
        THEN w_year * GREATEST(0, 1.0 - ABS(c.year - p_year)::numeric / GREATEST(LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50), 1))
        ELSE w_year * 0.5
      END) AS s_year,

      -- Model score
      (CASE
        WHEN p_model IS NULL THEN w_model * 0.5
        WHEN lower(c.model) = lower(p_model) THEN w_model
        WHEN length(public.model_spelling_key(p_model)) >= 2 AND public.model_spelling_key(c.model) = public.model_spelling_key(p_model) THEN w_model
        WHEN lower(c.model) LIKE '%' || lower(p_model) || '%' THEN w_model * 0.7
        WHEN lower(p_model) LIKE '%' || lower(c.model) || '%' THEN w_model * 0.6
        WHEN lower(c.model) LIKE '%' || lower(split_part(p_model, ' ', 1)) || '%' THEN w_model * 0.4
        ELSE 0
      END) AS s_model,

      -- Engine cylinder score
      (CASE
        WHEN ref_cyls IS NULL OR extract_cylinder_count(c.v_engine) IS NULL THEN w_engine_cyl * 0.3
        WHEN extract_cylinder_count(c.v_engine) = ref_cyls THEN w_engine_cyl
        WHEN ABS(extract_cylinder_count(c.v_engine) - ref_cyls) <= 2 THEN w_engine_cyl * 0.5
        ELSE 0
      END) AS s_engine_cyl,

      -- Engine config score
      (CASE
        WHEN ref_eng_cfg IS NULL OR extract_engine_config(c.v_engine) IS NULL THEN w_engine_cfg * 0.3
        WHEN extract_engine_config(c.v_engine) = ref_eng_cfg THEN w_engine_cfg
        ELSE 0
      END) AS s_engine_cfg,

      -- Transmission score
      (CASE
        WHEN ref_trans IS NULL OR classify_transmission(c.v_trans) IS NULL THEN w_trans * 0.3
        WHEN classify_transmission(c.v_trans) = ref_trans THEN w_trans
        ELSE 0
      END) AS s_trans,

      -- Drivetrain score
      (CASE
        WHEN ref_drive IS NULL OR classify_drivetrain(c.v_drive) IS NULL THEN w_drivetrain * 0.3
        WHEN classify_drivetrain(c.v_drive) = ref_drive THEN w_drivetrain
        WHEN classify_drivetrain(c.v_drive) IN ('4WD','AWD') AND ref_drive IN ('4WD','AWD') THEN w_drivetrain * 0.8
        ELSE 0
      END) AS s_drivetrain,

      -- Mileage score
      (CASE
        WHEN p_mileage IS NULL OR c.mileage IS NULL OR p_mileage = 0 THEN w_mileage * 0.3
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.2 THEN w_mileage
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 0.5 THEN w_mileage * 0.6
        WHEN ABS(c.mileage - p_mileage) <= p_mileage * 1.0 THEN w_mileage * 0.3
        ELSE 0
      END) AS s_mileage,

      -- Body style score
      (CASE
        WHEN p_body_style IS NULL OR c.v_body IS NULL THEN w_body * 0.3
        WHEN lower(c.v_body) = lower(p_body_style) THEN w_body
        WHEN lower(c.v_body) LIKE '%' || lower(p_body_style) || '%' THEN w_body * 0.6
        ELSE 0
      END) AS s_body,

      -- Trim score
      (CASE
        WHEN p_trim IS NULL OR c.trim IS NULL THEN w_trim_w * 0.3
        WHEN lower(c.trim) = lower(p_trim) THEN w_trim_w
        WHEN lower(c.trim) LIKE '%' || lower(p_trim) || '%' THEN w_trim_w * 0.6
        ELSE 0
      END) AS s_trim

    FROM all_cands c
  )
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    ROUND(s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim, 1) AS similarity_score,
    jsonb_build_object(
      'year', ROUND(s.s_year, 1),
      'model', ROUND(s.s_model, 1),
      'engine_cyl', ROUND(s.s_engine_cyl, 1),
      'engine_cfg', ROUND(s.s_engine_cfg, 1),
      'transmission', ROUND(s.s_trans, 1),
      'drivetrain', ROUND(s.s_drivetrain, 1),
      'mileage', ROUND(s.s_mileage, 1),
      'body_style', ROUND(s.s_body, 1),
      'trim', ROUND(s.s_trim, 1)
    ) AS score_breakdown,
    s.price_native::numeric AS sale_price_native, s.cur AS currency_code, s.fx_rate, s.fx_rate_date, s.fx_source
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
END;
$function$;
