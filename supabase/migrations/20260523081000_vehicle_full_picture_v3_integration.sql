-- 20260523081000_vehicle_full_picture_v3_integration.sql
--
-- Worth Engine calibration — Criterion 1 (method convergence).
--
-- Adds compute_active_minutes_burst_total(vehicle_id, burst_gap_minutes) that runs
-- the burst-clustering algorithm across ALL dates for a vehicle (per-day, then sum,
-- so the 480/day cap is enforced per-day, not globally squashed).
--
-- Refactors vehicle_full_picture() to:
--   1. Compute a v3_burst_USD figure alongside v1_clamped + v2_photocount
--   2. Pick the tightest two-of-three convergence pair for the range
--   3. Rate confidence based on how many of the 3 methods converge within 30%
--   4. Keep all warnings + 5×market check intact
--
-- The v3 method is the most conservative (lowest) — by adding it as a third
-- triangulation, we get a clearer picture of when v1 inflates from scattered
-- multi-hour photo spans that included idle time (lunch, parts runs, errands).
--
-- See: docs/library/working/working-papers/2026-05-23_worth-engine-calibration-spec.md

-- ── helper: per-vehicle total of burst-clustered active minutes ──────────────

CREATE OR REPLACE FUNCTION public.compute_active_minutes_burst_total(
  p_vehicle_id        UUID,
  p_burst_gap_minutes INT DEFAULT 30
) RETURNS BIGINT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_total BIGINT := 0;
  v_day_total INT;
  v_date DATE;
BEGIN
  FOR v_date IN
    SELECT DISTINCT taken_at::date
      FROM vehicle_images
     WHERE vehicle_id = p_vehicle_id
       AND taken_at IS NOT NULL
  LOOP
    v_day_total := compute_active_minutes_burst(p_vehicle_id, v_date, p_burst_gap_minutes);
    v_total := v_total + COALESCE(v_day_total, 0);
  END LOOP;
  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.compute_active_minutes_burst_total(UUID, INT) IS
'Worth Engine v3: per-day burst-cluster active minutes summed across all photo dates for a vehicle. Per-day 480 cap is enforced inside the inner function, so this returns a defensible all-time active-labor minutes estimate.';

GRANT EXECUTE ON FUNCTION public.compute_active_minutes_burst_total(UUID, INT) TO anon, authenticated;

-- ── refactor: vehicle_full_picture with 3-way convergence ────────────────────

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
  v_total_min_clamped BIGINT;
  v_burst_total_min BIGINT;
  v_shop_rate NUMERIC := 160;       -- Boulder City NV default; see shop_overhead_floor_per_hour for per-shop
  v_quality_factor NUMERIC := 0.92; -- average quality, market default
  v_v1_clamped NUMERIC;
  v_v2_photocount NUMERIC;
  v_v3_burst NUMERIC;
  v_methods JSONB;
  v_method_values NUMERIC[];
  v_min_pair_low NUMERIC;
  v_min_pair_high NUMERIC;
  v_min_divergence_pct NUMERIC := NULL;
  v_convergence_count INT := 0;     -- how many method pairs converge within 30%
  v_pushes JSONB;
  v_market_history JSONB;
  v_doc_parts_cost NUMERIC;
  v_payments_out NUMERIC;
  v_latest_market_mid NUMERIC;
  v_warnings TEXT[] := ARRAY[]::TEXT[];
  v_confidence TEXT;
BEGIN
  SELECT id, year, make, model, color, vin, owner_id, discovery_source
    INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','vehicle not found'); END IF;

  SELECT count(*) INTO v_atom_count FROM vehicle_observations WHERE vehicle_id = p_vehicle_id;
  SELECT count(*), MIN(taken_at)::date, MAX(taken_at)::date INTO v_image_count, v_first_photo, v_last_photo
    FROM vehicle_images WHERE vehicle_id = p_vehicle_id;
  SELECT count(*), COALESCE(SUM(LEAST(duration_minutes, 480)), 0) INTO v_session_count, v_total_min_clamped
    FROM work_sessions WHERE vehicle_id = p_vehicle_id;

  v_burst_total_min := compute_active_minutes_burst_total(p_vehicle_id, 30);

  v_v1_clamped    := (v_total_min_clamped::NUMERIC / 60) * v_shop_rate * v_quality_factor;
  v_v2_photocount := (v_image_count::NUMERIC * 10 / 60) * v_shop_rate * v_quality_factor;
  v_v3_burst      := (v_burst_total_min::NUMERIC / 60) * v_shop_rate * v_quality_factor;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('specialty', specialty, 'first', first_date, 'last', last_date, 'sessions', session_count, 'photos', photo_count, 'span_days', span_days) ORDER BY photo_count DESC), '[]'::jsonb) INTO v_pushes
  FROM (SELECT * FROM detect_pushes(p_vehicle_id) LIMIT 5) p;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', estimated_at::date, 'low', value_low, 'mid', value_mid, 'high', value_high, 'methodology', methodology) ORDER BY estimated_at), '[]'::jsonb) INTO v_market_history
  FROM vehicle_market_estimates WHERE vehicle_id = p_vehicle_id;

  SELECT COALESCE(SUM(total_parts_cost), 0) INTO v_doc_parts_cost FROM work_sessions WHERE vehicle_id = p_vehicle_id;
  SELECT COALESCE(SUM(amount_usd), 0) INTO v_payments_out FROM payment_events WHERE scope_id = p_vehicle_id AND direction = 'out';
  SELECT value_mid INTO v_latest_market_mid FROM vehicle_market_estimates WHERE vehicle_id = p_vehicle_id ORDER BY estimated_at DESC LIMIT 1;

  -- ── Criterion 4: warn if any method > 5x market value ──────────────────
  IF v_latest_market_mid IS NOT NULL AND v_latest_market_mid > 0 THEN
    IF v_v1_clamped > v_latest_market_mid * 5 THEN
      v_warnings := array_append(v_warnings, format('v1_clamped (%s) exceeds 5×market_value (%s) — likely photo-span inflation', round(v_v1_clamped,0), round(v_latest_market_mid * 5, 0)));
    END IF;
    IF v_v2_photocount > v_latest_market_mid * 5 THEN
      v_warnings := array_append(v_warnings, format('v2_photo_count (%s) exceeds 5×market_value (%s)', round(v_v2_photocount,0), round(v_latest_market_mid * 5, 0)));
    END IF;
    IF v_v3_burst > v_latest_market_mid * 5 THEN
      v_warnings := array_append(v_warnings, format('v3_burst (%s) exceeds 5×market_value (%s)', round(v_v3_burst,0), round(v_latest_market_mid * 5, 0)));
    END IF;
  ELSIF v_v1_clamped > 0 OR v_v2_photocount > 0 OR v_v3_burst > 0 THEN
    v_warnings := array_append(v_warnings, 'no_market_value_baseline_so_5x_check_skipped');
  END IF;

  -- ── Criterion 1: 3-way method convergence ──────────────────────────────
  -- For each pair (v1,v2),(v1,v3),(v2,v3), count as convergent if delta ≤ 30% of smaller value.
  -- The "range" is the tightest convergent pair; if no pair converges, use min/max across all 3.
  v_method_values := ARRAY[v_v1_clamped, v_v2_photocount, v_v3_burst];

  IF v_v1_clamped > 0 AND v_v2_photocount > 0 THEN
    IF abs(v_v1_clamped - v_v2_photocount) <= LEAST(v_v1_clamped, v_v2_photocount) * 0.3 THEN
      v_convergence_count := v_convergence_count + 1;
    END IF;
  END IF;
  IF v_v1_clamped > 0 AND v_v3_burst > 0 THEN
    IF abs(v_v1_clamped - v_v3_burst) <= LEAST(v_v1_clamped, v_v3_burst) * 0.3 THEN
      v_convergence_count := v_convergence_count + 1;
    END IF;
  END IF;
  IF v_v2_photocount > 0 AND v_v3_burst > 0 THEN
    IF abs(v_v2_photocount - v_v3_burst) <= LEAST(v_v2_photocount, v_v3_burst) * 0.3 THEN
      v_convergence_count := v_convergence_count + 1;
    END IF;
  END IF;

  -- Range = tightest two methods (most conservative bracket where signal agrees)
  -- If no pair converges, fall back to full min/max with a warning
  SELECT MIN(p_low), MAX(p_high) INTO v_min_pair_low, v_min_pair_high
  FROM (
    VALUES
      (LEAST(v_v1_clamped, v_v2_photocount), GREATEST(v_v1_clamped, v_v2_photocount), abs(v_v1_clamped - v_v2_photocount) / NULLIF(LEAST(v_v1_clamped, v_v2_photocount), 0)),
      (LEAST(v_v1_clamped, v_v3_burst),      GREATEST(v_v1_clamped, v_v3_burst),      abs(v_v1_clamped - v_v3_burst)      / NULLIF(LEAST(v_v1_clamped, v_v3_burst), 0)),
      (LEAST(v_v2_photocount, v_v3_burst),   GREATEST(v_v2_photocount, v_v3_burst),   abs(v_v2_photocount - v_v3_burst)   / NULLIF(LEAST(v_v2_photocount, v_v3_burst), 0))
  ) AS pairs(p_low, p_high, p_div)
  WHERE p_div IS NOT NULL AND p_div <= 0.3;

  IF v_min_pair_low IS NULL THEN
    -- No convergent pair — bracket the full spread
    v_min_pair_low  := LEAST(v_v1_clamped, v_v2_photocount, v_v3_burst);
    v_min_pair_high := GREATEST(v_v1_clamped, v_v2_photocount, v_v3_burst);
    IF v_v1_clamped > 0 OR v_v2_photocount > 0 OR v_v3_burst > 0 THEN
      v_warnings := array_append(v_warnings, format('no_two_methods_converge_within_30pct (v1=%s, v2=%s, v3=%s)', round(v_v1_clamped,0), round(v_v2_photocount,0), round(v_v3_burst,0)));
    END IF;
  END IF;

  v_methods := jsonb_build_object(
    'v1_time_span_clamped_USD', round(v_v1_clamped, 2),
    'v2_photo_count_USD',       round(v_v2_photocount, 2),
    'v3_burst_active_USD',      round(v_v3_burst, 2),
    'convergent_pair_count',    v_convergence_count,
    'range_low_USD',            round(v_min_pair_low, 2),
    'range_high_USD',           round(v_min_pair_high, 2)
  );

  -- ── Criterion 2: confidence rollup — now driven by convergence ─────────
  -- High = 2+ methods agree AND no warnings
  -- Moderate = 1 pair agrees OR 1 warning
  -- Low = no pairs agree OR multiple warnings
  v_confidence := CASE
    WHEN v_atom_count = 0 THEN 'zero_data'
    WHEN v_convergence_count >= 2 AND COALESCE(array_length(v_warnings, 1), 0) = 0 THEN 'high_three_way_convergence'
    WHEN v_convergence_count >= 1 AND COALESCE(array_length(v_warnings, 1), 0) <= 1 THEN 'moderate_one_pair_converges'
    WHEN v_convergence_count = 0 AND COALESCE(array_length(v_warnings, 1), 0) >= 2 THEN 'low_no_convergence_multiple_warnings'
    WHEN v_convergence_count = 0 THEN 'low_no_method_convergence'
    ELSE 'moderate_mixed_signal'
  END;

  RETURN jsonb_build_object(
    'vehicle', jsonb_build_object('id', v_vehicle.id, 'year', v_vehicle.year, 'make', v_vehicle.make, 'model', v_vehicle.model, 'color', v_vehicle.color, 'vin', v_vehicle.vin),
    'substrate', jsonb_build_object(
      'atoms', v_atom_count,
      'images', v_image_count,
      'first_photo', v_first_photo,
      'last_photo', v_last_photo,
      'work_sessions', v_session_count,
      'total_min_clamped', v_total_min_clamped,
      'burst_active_min', v_burst_total_min
    ),
    'inferred_value', v_methods,
    'documented_costs', jsonb_build_object('parts', v_doc_parts_cost, 'payments_out', v_payments_out, 'total_documented', v_doc_parts_cost + v_payments_out),
    'market_value_trajectory', v_market_history,
    'latest_market_mid_USD', v_latest_market_mid,
    'pushes', v_pushes,
    'open_substrate_gaps', CASE WHEN v_payments_out = 0 THEN jsonb_build_array('no_payment_events_yet','purchase_price_unknown') ELSE '[]'::jsonb END,
    'warnings', COALESCE(to_jsonb(v_warnings), '[]'::jsonb),
    'confidence', v_confidence,
    'methodology_note', 'v1=duration_minutes(LEAST 480/day)·$160·0.92; v2=images·10min·$160·0.92; v3=burst-clustered active min (30min gap)·$160·0.92. Range = tightest pair converging ≤30%; falls back to full spread + warning otherwise.'
  );
END;
$$;

COMMENT ON FUNCTION public.vehicle_full_picture(UUID) IS
'Worth Engine canonical readout. 3-way method triangulation (v1 time-span / v2 photo-count / v3 burst-active), 5×market warning, convergence-driven confidence rating. Single call powers DayCard, vehicle profile, and worth-proof UI.';
