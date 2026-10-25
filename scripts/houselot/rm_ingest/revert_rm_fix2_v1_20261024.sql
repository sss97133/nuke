-- caller controls the transaction (wrap in BEGIN ... ROLLBACK for tests); no COMMIT here
-- Revert rm_fix2_v1_20261024
set local statement_timeout='50s';
update public.vehicle_events e set metadata = e.metadata || jsonb_build_object('attach_basis', b.old_attach_basis) from public.backup_rm_fix2_v1_20261024_attach b where e.id=b.event_id and e.metadata->'attach_basis'->'lot_fix'->>'run_id'='rm_fix2_v1_20261024';
alter table public.vehicle_events drop constraint if exists vehicle_events_attach_lot_not_url;
update public.vehicles v set listing_kind=b.old_listing_kind, origin_metadata=b.old_origin_metadata from public.backup_rm_fix2_v1_20261024_nonvehicle b where v.id=b.vehicle_id;
update public.vehicle_events e set lot_category=b.old_lot_category, lot_category_source=b.old_lot_category_source from public.backup_rm_fix2_v1_20261024_nonvehicle b where e.id=b.event_id;
update public.nuke_estimates n set is_stale=b.old_ne_stale from public.backup_rm_fix2_v1_20261024_nonvehicle b where n.vehicle_id=b.vehicle_id and b.old_ne_stale is not null;
update public.vehicles v set make=b.old_make, model=b.old_model, make_source=b.old_make_source, model_source=b.old_model_source from public.backup_rm_fix2_v1_20261024_makes b where v.id=b.vehicle_id;
CREATE OR REPLACE FUNCTION public.compute_nuke_estimates_bulk(p_batch_size integer DEFAULT 10000, p_offset integer DEFAULT 0)
 RETURNS TABLE(computed integer, errors integer, batch_offset integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_computed INT := 0;
  v_errors INT := 0;
BEGIN
  -- Compute estimates using comps-based valuation in pure SQL
  WITH target_vehicles AS (
    -- Vehicles with prices but no estimate yet
    SELECT cvp.vehicle_id, cvp.year, cvp.make, cvp.model, cvp.best_price, cvp.is_sold,
           v.asking_price, v.current_value, v.sale_status, v.sale_date, v.created_at
    FROM clean_vehicle_prices cvp
    JOIN vehicles v ON v.id = cvp.vehicle_id
    LEFT JOIN nuke_estimates ne ON ne.vehicle_id = cvp.vehicle_id
    WHERE cvp.best_price > 0
      AND ne.id IS NULL
    ORDER BY cvp.vehicle_id
    LIMIT p_batch_size OFFSET p_offset
  ),
  -- Compute recency-weighted median from comps for each vehicle
  comp_prices AS (
    SELECT
      tv.vehicle_id,
      tv.year AS v_year,
      tv.make AS v_make,
      tv.model AS v_model,
      tv.best_price AS own_price,
      tv.asking_price,
      tv.current_value,
      tv.sale_status,
      tv.sale_date,
      tv.created_at,
      -- Recency-weighted percentile price from comps
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY comp.best_price) AS median_price,
      COUNT(comp.vehicle_id) AS comp_count,
      -- Count how many signals we have
      (CASE WHEN EXISTS(SELECT 1 FROM comment_discoveries cd WHERE cd.vehicle_id = tv.vehicle_id) THEN 1 ELSE 0 END +
       CASE WHEN EXISTS(SELECT 1 FROM condition_assessments ca WHERE ca.vehicle_id = tv.vehicle_id) THEN 1 ELSE 0 END +
       CASE WHEN EXISTS(SELECT 1 FROM vehicle_production_data vpd
                        WHERE LOWER(vpd.make) = LOWER(tv.make) AND LOWER(vpd.model) = LOWER(tv.model) AND vpd.year = tv.year)
            THEN 1 ELSE 0 END
      ) AS extra_signal_count
    FROM target_vehicles tv
    JOIN clean_vehicle_prices comp
      ON LOWER(comp.make) = LOWER(tv.make)
      AND LOWER(comp.model) LIKE '%' || LOWER(tv.model) || '%'
      AND comp.year BETWEEN tv.year - 3 AND tv.year + 3
      AND comp.best_price > 0
      AND comp.vehicle_id != tv.vehicle_id
    GROUP BY tv.vehicle_id, tv.year, tv.make, tv.model, tv.best_price,
             tv.asking_price, tv.current_value, tv.sale_status, tv.sale_date, tv.created_at
    HAVING COUNT(comp.vehicle_id) >= 1
  ),
  -- Compute the final estimates
  estimates AS (
    SELECT
      cp.vehicle_id,
      cp.median_price AS estimated_value,
      -- Confidence interval based on price tier
      cp.median_price * (1 - CASE
        WHEN cp.median_price < 15000 THEN 0.08
        WHEN cp.median_price < 50000 THEN 0.12
        WHEN cp.median_price < 150000 THEN 0.18
        WHEN cp.median_price < 500000 THEN 0.25
        ELSE 0.35
      END) AS value_low,
      cp.median_price * (1 + CASE
        WHEN cp.median_price < 15000 THEN 0.08
        WHEN cp.median_price < 50000 THEN 0.12
        WHEN cp.median_price < 150000 THEN 0.18
        WHEN cp.median_price < 500000 THEN 0.25
        ELSE 0.35
      END) AS value_high,
      -- Confidence score
      LEAST(100, 30 + cp.extra_signal_count * 8 + LEAST(cp.comp_count, 20) * 1.5 + 10)::INT AS confidence_score,
      -- Price tier
      CASE
        WHEN cp.median_price < 15000 THEN 'budget'
        WHEN cp.median_price < 50000 THEN 'mainstream'
        WHEN cp.median_price < 150000 THEN 'enthusiast'
        WHEN cp.median_price < 500000 THEN 'collector'
        ELSE 'trophy'
      END AS price_tier,
      -- Confidence interval pct
      CASE
        WHEN cp.median_price < 15000 THEN 8.0
        WHEN cp.median_price < 50000 THEN 12.0
        WHEN cp.median_price < 150000 THEN 18.0
        WHEN cp.median_price < 500000 THEN 25.0
        ELSE 35.0
      END AS confidence_interval_pct,
      -- Signal weights (comps only for bulk, rest default)
      jsonb_build_object(
        'comps', jsonb_build_object('weight', 0.40, 'multiplier', 1.0, 'sourceCount', cp.comp_count),
        'condition', jsonb_build_object('weight', 0.15, 'multiplier', 1.0, 'sourceCount', 0),
        'rarity', jsonb_build_object('weight', 0.05, 'multiplier', 1.0, 'sourceCount', 0),
        'sentiment', jsonb_build_object('weight', 0.08, 'multiplier', 1.0, 'sourceCount', 0),
        'bid_curve', jsonb_build_object('weight', 0.10, 'multiplier', 1.0, 'sourceCount', 0),
        'market_trend', jsonb_build_object('weight', 0.10, 'multiplier', 1.0, 'sourceCount', 0),
        'survival', jsonb_build_object('weight', 0.04, 'multiplier', 1.0, 'sourceCount', 0),
        'originality', jsonb_build_object('weight', 0.08, 'multiplier', 1.0, 'sourceCount', 0)
      ) AS signal_weights,
      -- Deal score
      CASE WHEN COALESCE(cp.asking_price, cp.current_value) > 0 THEN
        ROUND(((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100 *
          CASE
            WHEN cp.created_at > NOW() - INTERVAL '24 hours' THEN 1.0
            WHEN cp.created_at > NOW() - INTERVAL '3 days' THEN 0.95
            WHEN cp.created_at > NOW() - INTERVAL '7 days' THEN 0.85
            WHEN cp.created_at > NOW() - INTERVAL '30 days' THEN 0.50
            ELSE 0.30
          END)::NUMERIC, 2)
      END AS deal_score,
      -- Deal score label (7-tier spectrum)
      CASE
        WHEN COALESCE(cp.asking_price, cp.current_value) IS NULL OR COALESCE(cp.asking_price, cp.current_value) <= 0 THEN NULL
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= 25 THEN 'plus_3'
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= 15 THEN 'plus_2'
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= 5 THEN 'plus_1'
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= -5 THEN 'fair'
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= -15 THEN 'minus_1'
        WHEN ((cp.median_price - COALESCE(cp.asking_price, cp.current_value)) / cp.median_price * 100) >= -25 THEN 'minus_2'
        ELSE 'minus_3'
      END AS deal_score_label,
      -- Basic heat score
      (CASE WHEN cp.sale_status IN ('live', 'active') THEN 30 ELSE 0 END +
       CASE WHEN cp.sale_date IS NOT NULL AND cp.sale_date > NOW() - INTERVAL '7 days' THEN 25 ELSE 0 END +
       CASE WHEN cp.created_at > NOW() - INTERVAL '48 hours' THEN 5 ELSE 0 END
      )::NUMERIC(5,2) AS heat_score,
      CASE
        WHEN (CASE WHEN cp.sale_status IN ('live', 'active') THEN 30 ELSE 0 END +
              CASE WHEN cp.sale_date IS NOT NULL AND cp.sale_date > NOW() - INTERVAL '7 days' THEN 25 ELSE 0 END +
              CASE WHEN cp.created_at > NOW() - INTERVAL '48 hours' THEN 5 ELSE 0 END) >= 80 THEN 'volcanic'
        WHEN (CASE WHEN cp.sale_status IN ('live', 'active') THEN 30 ELSE 0 END +
              CASE WHEN cp.sale_date IS NOT NULL AND cp.sale_date > NOW() - INTERVAL '7 days' THEN 25 ELSE 0 END +
              CASE WHEN cp.created_at > NOW() - INTERVAL '48 hours' THEN 5 ELSE 0 END) >= 60 THEN 'fire'
        WHEN (CASE WHEN cp.sale_status IN ('live', 'active') THEN 30 ELSE 0 END +
              CASE WHEN cp.sale_date IS NOT NULL AND cp.sale_date > NOW() - INTERVAL '7 days' THEN 25 ELSE 0 END +
              CASE WHEN cp.created_at > NOW() - INTERVAL '48 hours' THEN 5 ELSE 0 END) >= 40 THEN 'hot'
        WHEN (CASE WHEN cp.sale_status IN ('live', 'active') THEN 30 ELSE 0 END +
              CASE WHEN cp.sale_date IS NOT NULL AND cp.sale_date > NOW() - INTERVAL '7 days' THEN 25 ELSE 0 END +
              CASE WHEN cp.created_at > NOW() - INTERVAL '48 hours' THEN 5 ELSE 0 END) >= 20 THEN 'warm'
        ELSE 'cold'
      END AS heat_score_label,
      cp.comp_count AS input_count
    FROM comp_prices cp
  ),
  -- Insert the estimates
  inserted AS (
    INSERT INTO nuke_estimates (
      vehicle_id, estimated_value, value_low, value_high, confidence_score,
      price_tier, confidence_interval_pct, signal_weights,
      deal_score, deal_score_label, heat_score, heat_score_label,
      model_version, input_count, calculated_at, is_stale
    )
    SELECT
      vehicle_id, estimated_value, value_low, value_high, confidence_score,
      price_tier, confidence_interval_pct, signal_weights,
      deal_score, deal_score_label, heat_score, heat_score_label,
      'v1-bulk', input_count, NOW(), false
    FROM estimates
    ON CONFLICT (vehicle_id) DO NOTHING
    RETURNING vehicle_id
  ),
  -- Denormalize to vehicles
  denorm AS (
    UPDATE vehicles v SET
      nuke_estimate = e.estimated_value,
      nuke_estimate_confidence = e.confidence_score,
      deal_score = e.deal_score,
      heat_score = e.heat_score,
      valuation_calculated_at = NOW()
    FROM estimates e
    WHERE v.id = e.vehicle_id
      AND e.vehicle_id IN (SELECT vehicle_id FROM inserted)
  )
  SELECT COUNT(*) INTO v_computed FROM inserted;

  RETURN QUERY SELECT v_computed, v_errors, p_offset;
END;
$function$

;
CREATE OR REPLACE FUNCTION public.compute_shadow_comp_base(p_vehicle_ids uuid[], p_as_of timestamp with time zone[], p_run_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET statement_timeout TO '120s'
 SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  IF array_length(p_vehicle_ids,1) > 100 THEN RAISE EXCEPTION 'max 100 per call'; END IF;
  INSERT INTO shadow_comp_base AS s (vehicle_id, as_of, base_hammer, n_comps, platforms, run_id)
  SELECT x.vid, x.asof, c.med, c.n, c.pl, p_run_id
  FROM unnest(p_vehicle_ids, p_as_of) x(vid, asof)
  JOIN vehicles v ON v.id = x.vid
  CROSS JOIN LATERAL (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY h) med, count(*)::int n,
           to_jsonb(array_agg(DISTINCT platform)) pl
    FROM (SELECT DISTINCT ON (sp.auction_event_id) sp.platform, sp.hammer_price h
          FROM (SELECT c.id FROM vehicles c WHERE lower(c.make) = lower(v.make) AND lower(c.model) = lower(v.model)
                  AND c.year BETWEEN v.year - 3 AND v.year + 3 AND c.id <> v.id) cv
          JOIN shadow_sale_prices sp ON sp.vehicle_id = cv.id
          WHERE sp.sold_at < x.asof AND sp.currency_code = 'USD' AND sp.price_basis = 'hammer'
          ORDER BY sp.auction_event_id) cs) c
  ON CONFLICT (vehicle_id, as_of) DO UPDATE SET base_hammer=excluded.base_hammer, n_comps=excluded.n_comps,
    platforms=excluded.platforms, run_id=excluded.run_id, computed_at=now();
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $function$

;
CREATE OR REPLACE FUNCTION public.compute_shadow_estimates(p_model_version text, p_run_id uuid, p_vehicle_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET statement_timeout TO '120s'
 SET search_path TO 'public'
AS $function$
DECLARE n int; m record;
BEGIN
  IF array_length(p_vehicle_ids,1) > 500 THEN RAISE EXCEPTION 'max 500 per call'; END IF;
  SELECT * INTO m FROM shadow_valuation_models WHERE model_version = p_model_version;
  INSERT INTO nuke_estimates_shadow AS s (vehicle_id, model_version, as_of, base_value, base_comp_method, evidence_multiplier,
         shadow_value, shadow_low, shadow_high, n_sources, citations, run_id)
  SELECT f.vehicle_id, p_model_version, f.as_of, ne.estimated_value, ne.comp_method, x.mult,
         ne.estimated_value * x.mult,
         ne.estimated_value * x.mult * exp((m.interval_quantiles -> x.b ->> 0)::numeric),
         ne.estimated_value * x.mult * exp((m.interval_quantiles -> x.b ->> 1)::numeric),
         f.n_sources, f.citations, p_run_id
  FROM evidence_features_current f
  JOIN nuke_estimates ne ON ne.vehicle_id = f.vehicle_id
       AND ne.estimated_value > 0 AND NOT coalesce(ne.is_circular, false) AND ne.comp_method IS DISTINCT FROM 'self_price_fallback'
  CROSS JOIN LATERAL (SELECT
       exp(coalesce((m.coefficients->>'intercept')::numeric, 0)
         + coalesce((m.coefficients->>'f_condition')::numeric, 0) * coalesce(f.f_condition, 0)
         + coalesce((m.coefficients->>'f_originality')::numeric, 0) * coalesce(f.f_originality, 0)
         + coalesce((m.coefficients->>'f_documented_work')::numeric, 0) * coalesce(f.f_documented_work, 0)
         + coalesce((m.coefficients->>'f_records')::numeric, 0) * coalesce(f.f_records, 0)
         + coalesce((m.coefficients->>'f_ownership')::numeric, 0) * coalesce(f.f_ownership, 0)
         + coalesce((m.coefficients->>'f_identity')::numeric, 0) * coalesce(f.f_identity, 0)) AS mult,
       least(coalesce(f.n_sources, 0), 3)::text AS b) x
  WHERE f.vehicle_id = ANY(p_vehicle_ids)
  ON CONFLICT (vehicle_id, model_version) DO UPDATE SET as_of=excluded.as_of, base_value=excluded.base_value,
    base_comp_method=excluded.base_comp_method, evidence_multiplier=excluded.evidence_multiplier, shadow_value=excluded.shadow_value,
    shadow_low=excluded.shadow_low, shadow_high=excluded.shadow_high, n_sources=excluded.n_sources, citations=excluded.citations,
    run_id=excluded.run_id, computed_at=now();
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $function$

;
CREATE OR REPLACE FUNCTION public.compute_vehicle_value(p_vehicle_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  img_count int := 0;
  approved_img_count int := 0;
  tag_count int := 0;
  recent_events int := 0;
  receipts_total numeric := 0;
  verified_owner boolean := false;
  contrib_count int := 0;
  public_flag boolean := true;
  completeness numeric := 0;
  score numeric := 0;
begin
  select count(*), count(*) filter (where coalesce(is_approved, true))
    into img_count, approved_img_count
  from public.vehicle_images
  where vehicle_id = p_vehicle_id;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='image_tags') then
    select count(*) into tag_count
    from public.image_tags t
    join public.vehicle_images vi on vi.id = t.image_id
    where vi.vehicle_id = p_vehicle_id;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='timeline_events') then
    select count(*) into recent_events
    from public.timeline_events
    where vehicle_id = p_vehicle_id
      and created_at >= now() - interval '30 days';
  else
    recent_events := 0;
  end if;

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='receipts') then
    select coalesce(sum(total_amount), 0) into receipts_total
    from public.receipts
    where scope_type = 'vehicle'
      and scope_id::text = p_vehicle_id::text
      and coalesce(processing_status, 'parsed') in ('parsed','validated','saved');
  else
    receipts_total := 0;
  end if;

  select coalesce(is_public, true) into public_flag
  from public.vehicles v where v.id = p_vehicle_id;

  select (
    (case when (v.make is not null and v.make <> '') then 1 else 0 end) +
    (case when (v.model is not null and v.model <> '') then 1 else 0 end) +
    (case when v.year is not null then 1 else 0 end) +
    (case when (v.vin is not null and v.vin <> '') then 1 else 0 end) +
    (case when (v.color is not null and v.color <> '') then 1 else 0 end) +
    (case when (v.engine_size is not null) then 1 else 0 end) +
    (case when (v.transmission is not null and v.transmission <> '') then 1 else 0 end)
  ) / 7.0
  into completeness
  from public.vehicles v where v.id = p_vehicle_id;

  score := 0;
  score := score + LEAST(40, COALESCE(ln(GREATEST(2, approved_img_count)) * 20, 0));
  score := score + LEAST(15, (tag_count / 50.0) * 15);
  score := score + LEAST(15, (recent_events / 10.0) * 15);
  score := score + LEAST(15, (receipts_total / 5000.0) * 15);
  if verified_owner then score := score + 10; end if;
  score := score + LEAST(5, contrib_count);
  if public_flag then score := score + 5; end if;
  score := score + LEAST(10, GREATEST(0, completeness * 10));

  update public.vehicles set value_score = round(score::numeric, 2),
    value_breakdown = jsonb_build_object(
      'approved_images', approved_img_count,
      'tags', tag_count,
      'recent_events_30d', recent_events,
      'receipts_total', receipts_total,
      'verified_owner', verified_owner,
      'contributors', contrib_count,
      'public', public_flag,
      'completeness', completeness,
      'computed_at', now()
    )
  where id = p_vehicle_id;

  return score;
end $function$

;
CREATE OR REPLACE FUNCTION public.find_bat_comps(p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 2, p_limit integer DEFAULT 200, p_skip_wide_fallback boolean DEFAULT false)
 RETURNS TABLE(listing_id uuid, vehicle_id uuid, sale_price integer, bid_count integer, sale_date date, bat_listing_url text, v_year integer, v_make text, v_model text, v_engine_size text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_engine     text;
  v_trans      text;
  v_drive      text;
  v_mileage    integer;
  v_trim       text;
  v_body       text;
  result_count integer;
BEGIN
  -- Try to resolve vehicle attributes from a matching vehicle for better scoring
  -- Pick the first vehicle matching these params to get its attributes
  SELECT v.engine_type, v.transmission, v.drivetrain, v.mileage, v.trim, v.body_style
  INTO v_engine, v_trans, v_drive, v_mileage, v_trim, v_body
  FROM vehicles v
  WHERE lower(v.make) LIKE '%' || lower(p_make) || '%'
    AND (p_model IS NULL OR lower(v.model) LIKE '%' || lower(p_model) || '%')
    AND (p_year IS NULL OR v.year = p_year)
    AND v.engine_type IS NOT NULL
  LIMIT 1;

  -- Use scored comps to get BaT listings ranked by similarity
  RETURN QUERY
  SELECT
    bl.id AS listing_id,
    s.vehicle_id,
    s.sale_price::integer,
    bl.bid_count,
    s.sold_date::date AS sale_date,
    bl.bat_listing_url,
    s.yr AS v_year,
    s.mk AS v_make,
    s.mdl AS v_model,
    v2.engine_size AS v_engine_size
  FROM get_comps_scored(
    p_make         := p_make,
    p_model        := p_model,
    p_year         := p_year,
    p_year_range   := p_year_range,
    p_engine_type  := v_engine,
    p_transmission := v_trans,
    p_drivetrain   := v_drive,
    p_mileage      := v_mileage,
    p_trim         := v_trim,
    p_body_style   := v_body,
    p_limit        := p_limit
  ) s
  JOIN bat_listings bl ON bl.vehicle_id = s.vehicle_id
  JOIN vehicles v2 ON v2.id = s.vehicle_id
  WHERE bl.sale_price > 0;

  GET DIAGNOSTICS result_count = ROW_COUNT;

  -- If we got no results from scored path and not skipping fallback, try wider
  IF result_count = 0 AND NOT p_skip_wide_fallback THEN
    RETURN QUERY
    SELECT bl.id,
           bl.vehicle_id,
           bl.sale_price,
           bl.bid_count,
           bl.sale_date,
           bl.bat_listing_url,
           v2.year,
           v2.make,
           v2.model,
           v2.engine_size
    FROM bat_listings bl
    INNER JOIN vehicles v2 ON v2.id = bl.vehicle_id
    WHERE bl.sale_price > 0
      AND lower(v2.make) LIKE '%' || lower(p_make) || '%'
      AND (p_model IS NULL OR lower(v2.model) LIKE '%' || lower(p_model) || '%')
      AND (p_year IS NULL OR (v2.year BETWEEN p_year - p_year_range * 2 AND p_year + p_year_range * 2))
    ORDER BY bl.sale_date DESC NULLS LAST
    LIMIT p_limit;
  END IF;
END;
$function$

;
CREATE OR REPLACE FUNCTION public.get_auction_comps(p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '8s'
AS $function$
BEGIN
  RETURN QUERY
  WITH raw AS (
    SELECT v.id, v.year, v.make, v.model, v.trim, v.vin, ae.winning_bid, v.mileage, v.color,
           v.primary_image_url, v.location, ae.source_url, ae.source, ae.auction_end_date,
           ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on
    FROM vehicles v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (p_year_min IS NULL OR v.year >= p_year_min)
      AND (p_year_max IS NULL OR v.year <= p_year_max)
      AND ae.winning_bid > 0
      AND ae.outcome = 'sold'
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ), conv AS (
    SELECT r.*, fx.rate, fx.rate_date, fx.source AS fx_src,
           CASE WHEN r.cur IS NULL THEN r.winning_bid ELSE round(r.winning_bid * fx.rate, 2) END AS price_usd
    FROM raw r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  )
  SELECT c.id, c.year, c.make, c.model, c.trim, c.vin, c.price_usd, c.mileage, c.color,
         c.primary_image_url, c.location, c.source_url, c.source, c.auction_end_date,
         c.winning_bid, c.cur, c.rate, c.rate_date,
         CASE WHEN c.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE c.fx_src END
  FROM conv c
  WHERE (c.cur IS NULL OR c.rate IS NOT NULL)
    AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
    AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ORDER BY c.auction_end_date DESC NULLS LAST
  LIMIT p_limit;
END;
$function$

;
CREATE OR REPLACE FUNCTION public.get_auction_comps(p_basis price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '8s'
AS $function$
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  RETURN QUERY
  WITH raw AS (
    SELECT v.id, v.year, v.make, v.model, v.trim, v.vin, (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) AS winning_bid, v.mileage, v.color,
           v.primary_image_url, v.location, ae.source_url, ae.source, ae.auction_end_date,
           ae.currency_code AS cur, (ae.auction_end_date AT TIME ZONE 'UTC')::date AS fx_on
    FROM vehicles v
    JOIN auction_events ae ON ae.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model))
      AND (p_year_min IS NULL OR v.year >= p_year_min)
      AND (p_year_max IS NULL OR v.year <= p_year_max)
      AND (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) > 0
      AND ae.outcome = 'sold'
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ), conv AS (
    SELECT r.*, fx.rate, fx.rate_date, fx.source AS fx_src,
           CASE WHEN r.cur IS NULL THEN r.winning_bid ELSE round(r.winning_bid * fx.rate, 2) END AS price_usd
    FROM raw r
    LEFT JOIN LATERAL (SELECT f.rate, f.rate_date, f.source FROM public.fx_usd_rate(r.cur, r.fx_on) f) fx ON r.cur IS NOT NULL
  )
  SELECT c.id, c.year, c.make, c.model, c.trim, c.vin, c.price_usd, c.mileage, c.color,
         c.primary_image_url, c.location, c.source_url, c.source, c.auction_end_date,
         c.winning_bid, c.cur, c.rate, c.rate_date,
         CASE WHEN c.cur IS NULL THEN 'unconverted: currency_code unknown, amount read as reported' ELSE c.fx_src END,
         p_basis::text
  FROM conv c
  WHERE (c.cur IS NULL OR c.rate IS NOT NULL)
    AND (p_min_price IS NULL OR c.price_usd >= p_min_price)
    AND (p_max_price IS NULL OR c.price_usd <= p_max_price)
  ORDER BY c.auction_end_date DESC NULLS LAST
  LIMIT p_limit;
END;
$function$

;
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
  SELECT COUNT(*), ROUND(AVG((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))::numeric), MIN((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END)), MAX((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))
  INTO project_count, project_avg, project_min, project_max
  FROM vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND (CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END) > 0 AND (CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END) < 20000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  -- Driver tier: $20K-$50K
  SELECT COUNT(*), ROUND(AVG((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))::numeric), MIN((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END)), MAX((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))
  INTO driver_count, driver_avg, driver_min, driver_max
  FROM vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND (CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END) BETWEEN 20000 AND 50000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  -- Restomod tier: $50K-$100K
  SELECT COUNT(*), ROUND(AVG((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))::numeric), MIN((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END)), MAX((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))
  INTO restomod_count, restomod_avg, restomod_min, restomod_max
  FROM vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND (CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END) BETWEEN 50000 AND 100000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  -- Show tier: $100K+
  SELECT COUNT(*), ROUND(AVG((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))::numeric), MIN((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END)), MAX((CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END))
  INTO show_count, show_avg, show_min, show_max
  FROM vehicles
  WHERE year BETWEEN p_year - 3 AND p_year + 3
    AND LOWER(make) = LOWER(p_make)
    AND LOWER(model) LIKE model_pattern
    AND (CASE WHEN coalesce(sale_price_currency, 'USD') = 'USD' THEN sale_price ELSE sale_price_usd END) > 100000 AND NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price);

  RETURN jsonb_build_object(
    'project',  jsonb_build_object('count', COALESCE(project_count, 0),  'avg', project_avg,  'min', project_min,  'max', project_max),
    'driver',   jsonb_build_object('count', COALESCE(driver_count, 0),   'avg', driver_avg,   'min', driver_min,   'max', driver_max),
    'restomod', jsonb_build_object('count', COALESCE(restomod_count, 0), 'avg', restomod_avg, 'min', restomod_min, 'max', restomod_max),
    'show',     jsonb_build_object('count', COALESCE(show_count, 0),     'avg', show_avg,     'min', show_min,     'max', show_max)
  );
END;
$function$

;
CREATE OR REPLACE FUNCTION public.get_comps_combined(p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_year       integer;
  v_year_range integer;
  v_engine     text;
  v_trans      text;
  v_drive      text;
  v_mileage    integer;
  v_trim       text;
  v_body       text;
BEGIN
  -- Compute year and range from min/max
  IF p_year_min IS NOT NULL AND p_year_max IS NOT NULL THEN
    v_year := (p_year_min + p_year_max) / 2;
    v_year_range := GREATEST((p_year_max - p_year_min) / 2, 1);
  ELSIF p_year_min IS NOT NULL THEN
    v_year := p_year_min + 5;
    v_year_range := 5;
  ELSIF p_year_max IS NOT NULL THEN
    v_year := p_year_max - 5;
    v_year_range := 5;
  END IF;

  -- Try to resolve vehicle attributes if we have an exclude_vehicle_id (i.e. the subject)
  IF p_exclude_vehicle_id IS NOT NULL THEN
    SELECT v.engine_type, v.transmission, v.drivetrain, v.mileage, v.trim, v.body_style
    INTO v_engine, v_trans, v_drive, v_mileage, v_trim, v_body
    FROM vehicles v WHERE v.id = p_exclude_vehicle_id;
  END IF;

  RETURN QUERY
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    s.sale_price_native, s.currency_code, s.fx_rate, s.fx_rate_date, s.fx_source
  FROM get_comps_scored(
    p_make         := p_make,
    p_model        := p_model,
    p_year         := v_year,
    p_year_range   := COALESCE(v_year_range, 5),
    p_engine_type  := v_engine,
    p_transmission := v_trans,
    p_drivetrain   := v_drive,
    p_mileage      := v_mileage,
    p_trim         := v_trim,
    p_body_style   := v_body,
    p_min_price    := p_min_price,
    p_max_price    := p_max_price,
    p_exclude_vehicle_id := p_exclude_vehicle_id,
    p_limit        := p_limit
  ) s;
END;
$function$

;
CREATE OR REPLACE FUNCTION public.get_comps_combined(p_basis price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_year       integer;
  v_year_range integer;
  v_engine     text;
  v_trans      text;
  v_drive      text;
  v_mileage    integer;
  v_trim       text;
  v_body       text;
BEGIN
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  -- Compute year and range from min/max
  IF p_year_min IS NOT NULL AND p_year_max IS NOT NULL THEN
    v_year := (p_year_min + p_year_max) / 2;
    v_year_range := GREATEST((p_year_max - p_year_min) / 2, 1);
  ELSIF p_year_min IS NOT NULL THEN
    v_year := p_year_min + 5;
    v_year_range := 5;
  ELSIF p_year_max IS NOT NULL THEN
    v_year := p_year_max - 5;
    v_year_range := 5;
  END IF;

  -- Try to resolve vehicle attributes if we have an exclude_vehicle_id (i.e. the subject)
  IF p_exclude_vehicle_id IS NOT NULL THEN
    SELECT v.engine_type, v.transmission, v.drivetrain, v.mileage, v.trim, v.body_style
    INTO v_engine, v_trans, v_drive, v_mileage, v_trim, v_body
    FROM vehicles v WHERE v.id = p_exclude_vehicle_id;
  END IF;

  RETURN QUERY
  SELECT
    s.vehicle_id, s.yr, s.mk, s.mdl, s.tr, s.vi,
    s.sale_price, s.miles, s.clr, s.image_url, s.loc,
    s.listing_url, s.platform, s.sold_date, s.source_type,
    s.sale_price_native, s.currency_code, s.fx_rate, s.fx_rate_date, s.fx_source, s.price_basis
  FROM get_comps_scored(
    p_basis        := p_basis,
    p_make         := p_make,
    p_model        := p_model,
    p_year         := v_year,
    p_year_range   := COALESCE(v_year_range, 5),
    p_engine_type  := v_engine,
    p_transmission := v_trans,
    p_drivetrain   := v_drive,
    p_mileage      := v_mileage,
    p_trim         := v_trim,
    p_body_style   := v_body,
    p_min_price    := p_min_price,
    p_max_price    := p_max_price,
    p_exclude_vehicle_id := p_exclude_vehicle_id,
    p_limit        := p_limit
  ) s;
END;
$function$

;
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
      COALESCE(v.sale_price_currency, v.currency_code) AS cur, COALESCE(v.sale_date, v.bat_sale_date) AS fx_on,
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
$function$

;
CREATE OR REPLACE FUNCTION public.get_comps_scored(p_basis price_basis_t, p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 5, p_engine_type text DEFAULT NULL::text, p_transmission text DEFAULT NULL::text, p_drivetrain text DEFAULT NULL::text, p_mileage integer DEFAULT NULL::integer, p_trim text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_min_price numeric DEFAULT NULL::numeric, p_max_price numeric DEFAULT NULL::numeric, p_exclude_vehicle_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(vehicle_id uuid, yr integer, mk text, mdl text, tr text, vi text, sale_price numeric, miles integer, clr text, image_url text, loc text, listing_url text, platform text, sold_date timestamp with time zone, source_type text, similarity_score numeric, score_breakdown jsonb, sale_price_native numeric, currency_code text, fx_rate numeric, fx_rate_date date, fx_source text, price_basis text)
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
  IF p_basis IS NULL OR p_basis = 'unknown' THEN
    RAISE EXCEPTION 'price basis required: pass p_basis = hammer | gross_incl_premium | net_to_owner (bases are never mixed)';
  END IF;
  ref_trans    := classify_transmission(p_transmission);
  ref_cyls     := extract_cylinder_count(p_engine_type);
  ref_eng_cfg  := extract_engine_config(p_engine_type);
  ref_drive    := classify_drivetrain(p_drivetrain);

  RETURN QUERY
  WITH auction_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) AS price, v.mileage, v.color,
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
      AND (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price WHEN 'net_to_owner' THEN ae.net_to_owner END) > 0
      AND ae.outcome = 'sold'
      AND NOT (COALESCE(ae.raw_data, '{}'::jsonb) ? 'duplicate_of')
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
  ),
  vehicle_cands AS (
    SELECT
      v.id, v.year, v.make, v.model, v.trim, v.vin,
      (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) AS price, v.mileage, v.color,
      v.primary_image_url, v.location, ve.source_url,
      ve.source_platform AS source,
      COALESCE(ve.sold_at, ve.ended_at) AS auction_end_date,
      'vehicle_event'::text AS src_type,
      NULL::text AS cur, COALESCE(ve.sold_at, ve.ended_at)::date AS fx_on,
      v.engine_type AS v_engine, v.transmission AS v_trans,
      v.drivetrain AS v_drive, v.body_style AS v_body
    FROM vehicles v
    JOIN vehicle_events ve ON ve.vehicle_id = v.id
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL OR lower(v.model) = lower(p_model) OR lower(v.model) LIKE '%' || lower(p_model) || '%' OR lower(p_model) LIKE '%' || lower(v.model) || '%')
      AND (p_year IS NULL OR v.year BETWEEN p_year - LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50) AND p_year + LEAST(GREATEST(COALESCE(p_year_range, 5), 0), 50))
      AND ve.event_status = 'sold'
      AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted'
      AND (CASE p_basis WHEN 'hammer' THEN ve.hammer_price WHEN 'gross_incl_premium' THEN ve.gross_price WHEN 'net_to_owner' THEN ve.net_to_owner END) > 0
      AND v.deleted_at IS NULL
      AND (p_exclude_vehicle_id IS NULL OR v.id != p_exclude_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM auction_events ae2
        WHERE ae2.vehicle_id = v.id AND ae2.outcome = 'sold' AND (CASE p_basis WHEN 'hammer' THEN ae2.hammer_price WHEN 'gross_incl_premium' THEN ae2.gross_price WHEN 'net_to_owner' THEN ae2.net_to_owner END) > 0
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
    s.price_native::numeric AS sale_price_native, s.cur AS currency_code, s.fx_rate, s.fx_rate_date, s.fx_source, p_basis::text
  FROM scored s
  ORDER BY
    (s.s_year + s.s_model + s.s_engine_cyl + s.s_engine_cfg + s.s_trans + s.s_drivetrain + s.s_mileage + s.s_body + s.s_trim) DESC,
    s.sold_date DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.auto_classify_vehicle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_make text;
  v_make_id uuid;
BEGIN
  IF NEW.year IS NOT NULL AND NEW.era IS NULL THEN
    NEW.era := CASE
      WHEN NEW.year < 1946 THEN 'pre-war'
      WHEN NEW.year < 1960 THEN 'post-war'
      WHEN NEW.year < 1973 THEN 'classic'
      WHEN NEW.year < 1985 THEN 'malaise'
      WHEN NEW.year < 2000 THEN 'modern-classic'
      WHEN NEW.year < 2015 THEN 'modern'
      ELSE 'contemporary'
    END;
  END IF;

  IF NEW.make IS NOT NULL AND (
       TG_OP = 'INSERT' OR NEW.canonical_make_id IS NULL
       OR NEW.make IS DISTINCT FROM OLD.make OR NEW.canonical_make_id IS DISTINCT FROM OLD.canonical_make_id) THEN
    v_make := lower(btrim(NEW.make));
    SELECT cm.id INTO v_make_id
    FROM canonical_makes cm
    WHERE lower(cm.display_name) = v_make
       OR lower(cm.canonical_name) = v_make
       OR v_make = ANY (SELECT lower(a) FROM unnest(cm.aliases) AS a)
    ORDER BY lower(cm.display_name) = v_make DESC, lower(cm.canonical_name) = v_make DESC, cm.id
    LIMIT 1;
    IF v_make_id IS NOT NULL THEN
      NEW.canonical_make_id := v_make_id;
    ELSIF TG_OP = 'UPDATE' AND NEW.make IS DISTINCT FROM OLD.make
          AND NEW.canonical_make_id IS NOT DISTINCT FROM OLD.canonical_make_id THEN
      NEW.canonical_make_id := NULL;
    END IF;
  END IF;

  IF NEW.segment_id IS NULL AND NEW.make IS NOT NULL THEN
    SELECT vs.id INTO NEW.segment_id
    FROM vehicle_segments vs
    WHERE
      (vs.slug = 'jdm' AND NEW.make IN ('Toyota','Honda','Nissan','Mazda','Subaru','Mitsubishi','Datsun','Lexus','Acura','Infiniti','Suzuki','Isuzu'))
      OR (vs.slug = 'air-cooled-porsche' AND NEW.make = 'Porsche' AND NEW.year < 1999 AND NEW.model ~* '911|930|964|993|356|914|912')
      OR (vs.slug = 'water-cooled-porsche' AND NEW.make = 'Porsche' AND NEW.model ~* '996|997|991|992|924|944|928|968|Boxster|Cayman|Cayenne|Panamera|Taycan|Macan|718')
      OR (vs.slug = 'muscle-car' AND NEW.make IN ('Chevrolet','Ford','Dodge','Plymouth','Pontiac','AMC','Oldsmobile','Buick','Mercury') AND NEW.model ~* 'Camaro|Mustang|Challenger|Charger|Cuda|Barracuda|GTO|Firebird|Trans Am|Chevelle|Nova|Corvette|Mach 1|Boss|Shelby|Road Runner|GTX|Super Bee|Coronet|442|Cutlass|GSX|Cougar|AMX|Javelin')
      OR (vs.slug = 'supercar' AND (NEW.make IN ('Lamborghini','Bugatti','Pagani','Koenigsegg','McLaren','Rimac') OR (NEW.make = 'Ferrari' AND NEW.model ~* 'F40|F50|Enzo|LaFerrari|288 GTO|250 GTO')))
      OR (vs.slug = 'truck' AND NEW.make IN ('Chevrolet','Ford','Dodge','GMC','Toyota','Ram','International') AND NEW.model ~* 'C10|C20|C30|K10|K20|K5|F-100|F-150|F-250|Pickup|Power Wagon|3100|Sierra|Hilux|Tacoma|S10|Ranger')
      OR (vs.slug = 'off-road' AND ((NEW.make = 'Jeep' AND NEW.model ~* 'CJ|Wrangler|Willys') OR (NEW.make = 'Toyota' AND NEW.model ~* 'Land Cruiser|FJ40|FJ45|FJ55|FJ60|4Runner') OR (NEW.make = 'Land Rover') OR (NEW.make = 'Ford' AND NEW.model ~* 'Bronco')))
      OR (vs.slug = 'euro' AND NEW.make IN ('Alfa Romeo','Fiat','Lancia','Peugeot','Citroen','Renault','Saab','Volvo','Opel'))
      OR (vs.slug = 'luxury' AND NEW.make IN ('Rolls-Royce','Bentley','Maybach','Aston Martin'))
      OR (vs.slug = 'sports-car' AND (NEW.make IN ('Lotus','TVR','Morgan','Caterham','Austin-Healey') OR (NEW.make = 'Jaguar' AND NEW.model ~* 'E-Type|XK|XJS|F-Type') OR (NEW.make = 'MG') OR (NEW.make = 'Triumph' AND NEW.model ~* 'TR|Spitfire|GT6')))
      OR (vs.slug = 'corvette' AND NEW.make = 'Chevrolet' AND NEW.model ~* 'Corvette')
      OR (vs.slug = 'mustang' AND NEW.make = 'Ford' AND NEW.model ~* 'Mustang')
      OR (vs.slug = 'camaro' AND NEW.make = 'Chevrolet' AND NEW.model ~* 'Camaro')
      OR (vs.slug = 'bronco' AND NEW.make = 'Ford' AND NEW.model ~* 'Bronco')
      OR (vs.slug = 'defender' AND NEW.make = 'Land Rover' AND NEW.model ~* 'Defender|Series')
      OR (vs.slug = 'g-wagon' AND NEW.make = 'Mercedes-Benz' AND NEW.model ~* 'G-Class|G-Wagon|G500|G550|G63|240GD|280GE|300GD|460|461|463')
      OR (vs.slug = 'e30' AND NEW.make = 'BMW' AND NEW.model ~* 'E30|325i|325is|318i|M3' AND NEW.year BETWEEN 1982 AND 1994)
      OR (vs.slug = 'e36' AND NEW.make = 'BMW' AND NEW.model ~* 'E36|318|323|325|328|M3' AND NEW.year BETWEEN 1992 AND 1999)
      OR (vs.slug = 'e46' AND NEW.make = 'BMW' AND NEW.model ~* 'E46|323|325|328|330|M3' AND NEW.year BETWEEN 1998 AND 2006)
      OR (vs.slug = 'skyline' AND NEW.make = 'Nissan' AND NEW.model ~* 'Skyline|GT-R|GTR')
      OR (vs.slug = 'miata' AND NEW.make = 'Mazda' AND NEW.model ~* 'MX-5|Miata')
      OR (vs.slug = 'supra' AND NEW.make = 'Toyota' AND NEW.model ~* 'Supra')
      OR (vs.slug = 'rx7' AND NEW.make = 'Mazda' AND NEW.model ~* 'RX-7|RX7')
      OR (vs.slug = 'nsx' AND NEW.make IN ('Acura','Honda') AND NEW.model ~* 'NSX')
      OR (vs.slug = 'w123' AND NEW.make = 'Mercedes-Benz' AND NEW.model ~* '240D|300D|300TD|280E' AND NEW.year BETWEEN 1976 AND 1985)
      OR (vs.slug = 'w124' AND NEW.make = 'Mercedes-Benz' AND NEW.model ~* '300E|300CE|E320|E420|E500|500E' AND NEW.year BETWEEN 1985 AND 1996)
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.resync_vehicle_canonical_make(p_lo uuid, p_hi uuid, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer CONSTANT text := 'resync_vehicle_canonical_make';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_changed integer := 0;
  v_result jsonb;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 10000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 10 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  IF p_lo IS NULL OR p_hi IS NULL OR p_lo >= p_hi THEN
    RAISE EXCEPTION '%: need p_lo < p_hi', c_writer;
  END IF;
  IF ('x' || substr(replace(p_hi::text, '-', ''), 1, 8))::bit(32)::bigint
     - ('x' || substr(replace(p_lo::text, '-', ''), 1, 8))::bit(32)::bigint > 67108864 THEN
    RAISE EXCEPTION '%: a range covers at most 1/64 of the uuid space', c_writer;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.make_resync (vehicle_id uuid, make text, was uuid, resolved uuid) ON COMMIT DROP;
  TRUNCATE pg_temp.make_resync;
  INSERT INTO pg_temp.make_resync
  SELECT v.id, v.make, v.canonical_make_id, r.id
  FROM public.vehicles v
  LEFT JOIN LATERAL (
    SELECT cm.id
    FROM public.canonical_makes cm
    WHERE lower(cm.display_name) = lower(btrim(v.make))
       OR lower(cm.canonical_name) = lower(btrim(v.make))
       OR lower(btrim(v.make)) = ANY (SELECT lower(a) FROM unnest(cm.aliases) AS a)
    ORDER BY lower(cm.display_name) = lower(btrim(v.make)) DESC, lower(cm.canonical_name) = lower(btrim(v.make)) DESC, cm.id
    LIMIT 1) r ON true
  WHERE v.id >= p_lo AND v.id < p_hi AND nullif(btrim(v.make), '') IS NOT NULL;

  SELECT jsonb_build_object(
    'range', jsonb_build_array(p_lo, p_hi), 'apply', p_apply, 'read', count(*),
    'null_but_resolves', count(*) FILTER (WHERE was IS NULL AND resolved IS NOT NULL),
    'other_make', count(*) FILTER (WHERE was IS NOT NULL AND resolved IS NOT NULL AND was <> resolved),
    'set_but_unresolved', count(*) FILTER (WHERE was IS NOT NULL AND resolved IS NULL),
    'samples', coalesce((SELECT jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'make', make, 'was', was, 'resolved', resolved))
                         FROM (SELECT * FROM pg_temp.make_resync WHERE resolved IS NOT NULL AND was IS DISTINCT FROM resolved
                               ORDER BY vehicle_id LIMIT 5) s), '[]'::jsonb))
  INTO v_result FROM pg_temp.make_resync;

  IF p_apply THEN
    PERFORM set_config('app.writer', c_writer, true);
    WITH upd AS (
      UPDATE public.vehicles v SET canonical_make_id = m.resolved
        FROM pg_temp.make_resync m
       WHERE v.id = m.vehicle_id AND m.resolved IS NOT NULL AND m.was IS DISTINCT FROM m.resolved
         AND v.canonical_make_id IS NOT DISTINCT FROM m.was AND v.make IS NOT DISTINCT FROM m.make
      RETURNING v.id, m.was, m.resolved, m.make
    )
    INSERT INTO public.superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
    SELECT 'vehicles', u.id, jsonb_build_object('field', 'canonical_make_id', 'value', u.was, 'replacement', u.resolved, 'make', u.make),
           c_writer, jsonb_build_object('rule', 'auto_classify_vehicle make resolution (display_name, canonical_name, alias)'),
           'canonical_make_id re-resolved from the vehicle''s make text'
    FROM upd u;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  END IF;

  RETURN v_result || jsonb_build_object('changed', v_changed);
END;
$function$
;
update public.vehicles v set canonical_make_id=b.old_canonical_make_id from public.backup_rm_fix2_v1_20261024_makes b where v.id=b.vehicle_id;
delete from public.canonical_make_era_rules where run_id='rm_fix2_v1_20261024';
-- new canonical_makes rows and citations are left in place (no vehicles point at them after this revert); remove with:
-- delete from public.canonical_make_citations where run_id='rm_fix2_v1_20261024'; delete from public.canonical_makes where canonical_name in ('MERCEDES-DMG','AMERICAN UNDERSLUNG','AMERICAN LAFRANCE','AMERICAN EAGLE');

