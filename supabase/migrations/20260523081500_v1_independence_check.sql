-- 20260523081500_v1_independence_check.sql
--
-- Worth Engine: detect when v1 was derived from v3 (via backfill_work_sessions_from_photos)
-- and exclude v1-v3 from convergence pairs in that case. Otherwise we'd report a
-- "convergent pair" that's actually just the same number twice.
--
-- A vehicle's v1 is considered INDEPENDENT when at least one work_session has
-- session_type != 'baseline_backfill'. Sessions logged by the user, by a shop
-- import, or enriched by build-day.mjs (which sets session_type to 'general',
-- 'restoration', etc.) all count as independent signal.
--
-- If 100% of work_sessions are baseline_backfill, v1 is treated as
-- "derived_from_v3" — still surfaced in the output so the UI can show the
-- baseline_backfill flag, but excluded from the v1-v3 convergence check.

CREATE OR REPLACE FUNCTION public.vehicle_full_picture(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_vehicle RECORD;
  v_atom_count INT;
  v_image_count INT;
  v_first_photo DATE;
  v_last_photo DATE;
  v_session_count INT;
  v_session_count_independent INT;
  v_total_min_clamped BIGINT;
  v_burst_total_min BIGINT;
  v_shop_rate NUMERIC := 160;
  v_quality_factor NUMERIC := 0.92;
  v_v1_clamped NUMERIC;
  v_v2_photocount NUMERIC;
  v_v3_burst NUMERIC;
  v_v1_available BOOLEAN;
  v_v1_independent BOOLEAN;
  v_v2_available BOOLEAN;
  v_v3_available BOOLEAN;
  v_available_count INT := 0;
  v_v2_v3_ratio NUMERIC;
  v_methods JSONB;
  v_min_pair_low NUMERIC;
  v_min_pair_high NUMERIC;
  v_convergence_count INT := 0;
  v_pushes JSONB;
  v_market_history JSONB;
  v_doc_parts_cost NUMERIC;
  v_payments_out NUMERIC;
  v_latest_market_mid NUMERIC;
  v_warnings TEXT[] := ARRAY[]::TEXT[];
  v_existence_confidence TEXT;
  v_magnitude_confidence TEXT;
BEGIN
  SELECT id, year, make, model, color, vin, owner_id, discovery_source
    INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','vehicle not found'); END IF;

  SELECT count(*) INTO v_atom_count FROM vehicle_observations WHERE vehicle_id = p_vehicle_id;
  SELECT count(*), MIN(taken_at)::date, MAX(taken_at)::date INTO v_image_count, v_first_photo, v_last_photo
    FROM vehicle_images WHERE vehicle_id = p_vehicle_id;

  -- Total + independent session count (independent = not baseline_backfill)
  SELECT count(*), COALESCE(SUM(LEAST(duration_minutes, 480)), 0),
         count(*) FILTER (WHERE session_type IS DISTINCT FROM 'baseline_backfill')
    INTO v_session_count, v_total_min_clamped, v_session_count_independent
    FROM work_sessions WHERE vehicle_id = p_vehicle_id;

  v_burst_total_min := compute_active_minutes_burst_total(p_vehicle_id, 30);

  v_v1_clamped    := (v_total_min_clamped::NUMERIC / 60) * v_shop_rate * v_quality_factor;
  v_v2_photocount := (v_image_count::NUMERIC * 10 / 60) * v_shop_rate * v_quality_factor;
  v_v3_burst      := (v_burst_total_min::NUMERIC / 60) * v_shop_rate * v_quality_factor;

  v_v1_available   := v_session_count > 0;
  v_v1_independent := v_session_count_independent > 0;
  v_v2_available   := v_image_count > 0;
  v_v3_available   := v_burst_total_min > 0;

  v_available_count :=
    CASE WHEN v_v1_independent THEN 1 ELSE 0 END +  -- only count independent v1
    CASE WHEN v_v2_available THEN 1 ELSE 0 END +
    CASE WHEN v_v3_available THEN 1 ELSE 0 END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('specialty', specialty, 'first', first_date, 'last', last_date, 'sessions', session_count, 'photos', photo_count, 'span_days', span_days) ORDER BY photo_count DESC), '[]'::jsonb) INTO v_pushes
  FROM (SELECT * FROM detect_pushes(p_vehicle_id) LIMIT 5) p;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', estimated_at::date, 'low', value_low, 'mid', value_mid, 'high', value_high, 'methodology', methodology) ORDER BY estimated_at), '[]'::jsonb) INTO v_market_history
  FROM vehicle_market_estimates WHERE vehicle_id = p_vehicle_id;

  SELECT COALESCE(SUM(total_parts_cost), 0) INTO v_doc_parts_cost FROM work_sessions WHERE vehicle_id = p_vehicle_id;
  SELECT COALESCE(SUM(amount_usd), 0) INTO v_payments_out FROM payment_events WHERE scope_id = p_vehicle_id AND direction = 'out';
  SELECT value_mid INTO v_latest_market_mid FROM vehicle_market_estimates WHERE vehicle_id = p_vehicle_id ORDER BY estimated_at DESC LIMIT 1;

  IF v_latest_market_mid IS NOT NULL AND v_latest_market_mid > 0 THEN
    IF v_v1_independent AND v_v1_clamped > v_latest_market_mid * 5 THEN
      v_warnings := array_append(v_warnings, format('v1_clamped (%s) exceeds 5×market_value (%s)', round(v_v1_clamped,0), round(v_latest_market_mid * 5, 0)));
    END IF;
    IF v_v2_available AND v_v2_photocount > v_latest_market_mid * 5 THEN
      v_warnings := array_append(v_warnings, format('v2_photo_count (%s) exceeds 5×market_value (%s)', round(v_v2_photocount,0), round(v_latest_market_mid * 5, 0)));
    END IF;
    IF v_v3_available AND v_v3_burst > v_latest_market_mid * 5 THEN
      v_warnings := array_append(v_warnings, format('v3_burst (%s) exceeds 5×market_value (%s)', round(v_v3_burst,0), round(v_latest_market_mid * 5, 0)));
    END IF;
  ELSIF v_available_count > 0 THEN
    v_warnings := array_append(v_warnings, 'no_market_value_baseline_so_5x_check_skipped');
  END IF;

  IF v_v2_available AND v_v3_available AND v_v3_burst > 0 THEN
    v_v2_v3_ratio := v_v2_photocount / v_v3_burst;
  END IF;

  -- Pairwise convergence — v1 only counts when independent
  IF v_v1_independent AND v_v2_available THEN
    IF abs(v_v1_clamped - v_v2_photocount) <= LEAST(v_v1_clamped, v_v2_photocount) * 0.3 THEN
      v_convergence_count := v_convergence_count + 1;
    END IF;
  END IF;
  IF v_v1_independent AND v_v3_available THEN
    IF abs(v_v1_clamped - v_v3_burst) <= LEAST(v_v1_clamped, v_v3_burst) * 0.3 THEN
      v_convergence_count := v_convergence_count + 1;
    END IF;
  END IF;
  IF v_v2_available AND v_v3_available THEN
    IF abs(v_v2_photocount - v_v3_burst) <= LEAST(v_v2_photocount, v_v3_burst) * 0.3 THEN
      v_convergence_count := v_convergence_count + 1;
    END IF;
  END IF;

  -- Range
  IF v_v2_available AND v_v3_available THEN
    v_min_pair_low  := v_v3_burst;
    v_min_pair_high := v_v2_photocount;
  ELSIF v_v3_available THEN
    v_min_pair_low  := v_v3_burst;
    v_min_pair_high := v_v3_burst;
  ELSIF v_v2_available THEN
    v_min_pair_low  := v_v2_photocount;
    v_min_pair_high := v_v2_photocount;
  ELSE
    v_min_pair_low  := 0;
    v_min_pair_high := 0;
  END IF;

  v_existence_confidence := CASE
    WHEN v_atom_count = 0 AND v_image_count = 0 THEN 'zero'
    WHEN v_atom_count > 100 OR v_image_count > 500 THEN 'high'
    WHEN v_atom_count > 10  OR v_image_count > 50  THEN 'moderate'
    ELSE 'low'
  END;

  v_magnitude_confidence := CASE
    WHEN NOT v_v2_available AND NOT v_v3_available THEN 'no_methods'
    WHEN v_v2_available AND v_v3_available AND v_v2_v3_ratio < 1.5 THEN 'tight'
    WHEN v_v2_available AND v_v3_available AND v_v2_v3_ratio <= 3   THEN 'bracketed'
    WHEN v_v2_available AND v_v3_available                          THEN 'wide_bracket'
    ELSE 'single_method'
  END;

  v_methods := jsonb_build_object(
    'v1_time_span_clamped_USD',  round(v_v1_clamped, 2),
    'v2_photo_count_USD',        round(v_v2_photocount, 2),
    'v3_burst_active_USD',       round(v_v3_burst, 2),
    'v1_available',              v_v1_available,
    'v1_independent',            v_v1_independent,
    'v2_available',              v_v2_available,
    'v3_available',              v_v3_available,
    'available_method_count',    v_available_count,
    'baseline_backfill_sessions', v_session_count - v_session_count_independent,
    'v2_v3_ratio',               round(COALESCE(v_v2_v3_ratio, 0), 2),
    'convergent_pair_count',     v_convergence_count,
    'range_low_USD',             round(v_min_pair_low, 2),
    'range_high_USD',            round(v_min_pair_high, 2)
  );

  RETURN jsonb_build_object(
    'vehicle', jsonb_build_object('id', v_vehicle.id, 'year', v_vehicle.year, 'make', v_vehicle.make, 'model', v_vehicle.model, 'color', v_vehicle.color, 'vin', v_vehicle.vin),
    'substrate', jsonb_build_object(
      'atoms', v_atom_count, 'images', v_image_count,
      'first_photo', v_first_photo, 'last_photo', v_last_photo,
      'work_sessions', v_session_count,
      'work_sessions_independent', v_session_count_independent,
      'total_min_clamped', v_total_min_clamped,
      'burst_active_min', v_burst_total_min
    ),
    'inferred_value', v_methods,
    'documented_costs', jsonb_build_object('parts', v_doc_parts_cost, 'payments_out', v_payments_out, 'total_documented', v_doc_parts_cost + v_payments_out),
    'market_value_trajectory', v_market_history,
    'latest_market_mid_USD', v_latest_market_mid,
    'pushes', v_pushes,
    'open_substrate_gaps', CASE
      WHEN v_session_count_independent = 0 AND v_image_count > 0 THEN jsonb_build_array('no_payment_events_yet','purchase_price_unknown','enrich_baseline_sessions_with_build_day')
      WHEN v_payments_out = 0 THEN jsonb_build_array('no_payment_events_yet','purchase_price_unknown')
      ELSE '[]'::jsonb
    END,
    'warnings', COALESCE(to_jsonb(v_warnings), '[]'::jsonb),
    'existence_confidence', v_existence_confidence,
    'magnitude_confidence', v_magnitude_confidence,
    'methodology_note', 'v1=duration_minutes(LEAST 480/day)·$160·0.92 — counts as independent only when session_type != baseline_backfill. v2=images·10min·$160·0.92 (optimistic). v3=burst-clustered active min·$160·0.92 (conservative). baseline_backfill sessions are v3 stored as work_sessions; build-day.mjs replaces them with enriched independent sessions.'
  );
END;
$$;
