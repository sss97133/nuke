-- 20260523081100_vehicle_full_picture_skip_absent_methods.sql
--
-- Worth Engine fix: v1=$0 when work_sessions is empty was being treated as
-- "method that disagrees with v2/v3" → forced no-convergence for every vehicle
-- that hasn't had a daily rollup run yet (which is most of them).
--
-- Correct behavior: a method is "available" only when its underlying substrate
-- exists. v1 is unavailable when work_sessions count = 0. v2 is unavailable
-- when images = 0. v3 is unavailable when burst_active_min = 0.
--
-- Convergence is then computed only across available methods. A single available
-- method gets "low_single_method" confidence (no triangulation possible).
-- Two available methods that converge get "moderate_two_method_convergence".
-- Three available methods with 2+ convergent pairs get "high_three_way_convergence".

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
  v_shop_rate NUMERIC := 160;
  v_quality_factor NUMERIC := 0.92;
  v_v1_clamped NUMERIC;
  v_v2_photocount NUMERIC;
  v_v3_burst NUMERIC;
  v_v1_available BOOLEAN;
  v_v2_available BOOLEAN;
  v_v3_available BOOLEAN;
  v_available_count INT := 0;
  v_methods JSONB;
  v_min_pair_low NUMERIC;
  v_min_pair_high NUMERIC;
  v_convergence_count INT := 0;
  v_max_possible_pairs INT;
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

  -- Availability gates — a method needs substrate to count
  v_v1_available := v_session_count > 0;
  v_v2_available := v_image_count > 0;
  v_v3_available := v_burst_total_min > 0;

  v_available_count :=
    CASE WHEN v_v1_available THEN 1 ELSE 0 END +
    CASE WHEN v_v2_available THEN 1 ELSE 0 END +
    CASE WHEN v_v3_available THEN 1 ELSE 0 END;

  v_max_possible_pairs := CASE v_available_count WHEN 3 THEN 3 WHEN 2 THEN 1 ELSE 0 END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('specialty', specialty, 'first', first_date, 'last', last_date, 'sessions', session_count, 'photos', photo_count, 'span_days', span_days) ORDER BY photo_count DESC), '[]'::jsonb) INTO v_pushes
  FROM (SELECT * FROM detect_pushes(p_vehicle_id) LIMIT 5) p;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', estimated_at::date, 'low', value_low, 'mid', value_mid, 'high', value_high, 'methodology', methodology) ORDER BY estimated_at), '[]'::jsonb) INTO v_market_history
  FROM vehicle_market_estimates WHERE vehicle_id = p_vehicle_id;

  SELECT COALESCE(SUM(total_parts_cost), 0) INTO v_doc_parts_cost FROM work_sessions WHERE vehicle_id = p_vehicle_id;
  SELECT COALESCE(SUM(amount_usd), 0) INTO v_payments_out FROM payment_events WHERE scope_id = p_vehicle_id AND direction = 'out';
  SELECT value_mid INTO v_latest_market_mid FROM vehicle_market_estimates WHERE vehicle_id = p_vehicle_id ORDER BY estimated_at DESC LIMIT 1;

  -- 5×market warnings only against available methods
  IF v_latest_market_mid IS NOT NULL AND v_latest_market_mid > 0 THEN
    IF v_v1_available AND v_v1_clamped > v_latest_market_mid * 5 THEN
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

  -- Pairwise convergence among AVAILABLE methods only
  IF v_v1_available AND v_v2_available THEN
    IF abs(v_v1_clamped - v_v2_photocount) <= LEAST(v_v1_clamped, v_v2_photocount) * 0.3 THEN
      v_convergence_count := v_convergence_count + 1;
    END IF;
  END IF;
  IF v_v1_available AND v_v3_available THEN
    IF abs(v_v1_clamped - v_v3_burst) <= LEAST(v_v1_clamped, v_v3_burst) * 0.3 THEN
      v_convergence_count := v_convergence_count + 1;
    END IF;
  END IF;
  IF v_v2_available AND v_v3_available THEN
    IF abs(v_v2_photocount - v_v3_burst) <= LEAST(v_v2_photocount, v_v3_burst) * 0.3 THEN
      v_convergence_count := v_convergence_count + 1;
    END IF;
  END IF;

  -- Range = tightest convergent pair among available methods
  SELECT MIN(p_low), MAX(p_high) INTO v_min_pair_low, v_min_pair_high
  FROM (
    SELECT
      LEAST(v_v1_clamped, v_v2_photocount) AS p_low,
      GREATEST(v_v1_clamped, v_v2_photocount) AS p_high,
      abs(v_v1_clamped - v_v2_photocount) / NULLIF(LEAST(v_v1_clamped, v_v2_photocount), 0) AS p_div
    WHERE v_v1_available AND v_v2_available
    UNION ALL
    SELECT LEAST(v_v1_clamped, v_v3_burst), GREATEST(v_v1_clamped, v_v3_burst),
      abs(v_v1_clamped - v_v3_burst) / NULLIF(LEAST(v_v1_clamped, v_v3_burst), 0)
    WHERE v_v1_available AND v_v3_available
    UNION ALL
    SELECT LEAST(v_v2_photocount, v_v3_burst), GREATEST(v_v2_photocount, v_v3_burst),
      abs(v_v2_photocount - v_v3_burst) / NULLIF(LEAST(v_v2_photocount, v_v3_burst), 0)
    WHERE v_v2_available AND v_v3_available
  ) AS pairs
  WHERE p_div IS NOT NULL AND p_div <= 0.3;

  -- No convergent pair → fall back to range across available methods
  IF v_min_pair_low IS NULL THEN
    SELECT MIN(val), MAX(val) INTO v_min_pair_low, v_min_pair_high
    FROM (
      SELECT v_v1_clamped AS val WHERE v_v1_available
      UNION ALL SELECT v_v2_photocount WHERE v_v2_available
      UNION ALL SELECT v_v3_burst WHERE v_v3_available
    ) AS available_methods;

    IF v_available_count >= 2 THEN
      v_warnings := array_append(v_warnings, format(
        'no_available_methods_converge_within_30pct (v1=%s%s, v2=%s%s, v3=%s%s)',
        round(v_v1_clamped,0), CASE WHEN v_v1_available THEN '' ELSE '(unavailable)' END,
        round(v_v2_photocount,0), CASE WHEN v_v2_available THEN '' ELSE '(unavailable)' END,
        round(v_v3_burst,0), CASE WHEN v_v3_available THEN '' ELSE '(unavailable)' END
      ));
    END IF;
  END IF;

  v_methods := jsonb_build_object(
    'v1_time_span_clamped_USD', round(v_v1_clamped, 2),
    'v2_photo_count_USD',       round(v_v2_photocount, 2),
    'v3_burst_active_USD',      round(v_v3_burst, 2),
    'v1_available',             v_v1_available,
    'v2_available',             v_v2_available,
    'v3_available',             v_v3_available,
    'available_method_count',   v_available_count,
    'max_possible_pairs',       v_max_possible_pairs,
    'convergent_pair_count',    v_convergence_count,
    'range_low_USD',            round(COALESCE(v_min_pair_low, 0), 2),
    'range_high_USD',           round(COALESCE(v_min_pair_high, 0), 2)
  );

  -- Confidence model:
  --   3 methods + ≥2 convergent pairs + 0 warnings  → high_three_way_convergence
  --   2 methods + 1 convergent pair + 0 warnings    → moderate_two_method_convergence
  --   1 method available                            → low_single_method_no_triangulation
  --   Any methods but no convergent pair            → low_no_convergence
  --   0 methods                                     → zero_data
  v_confidence := CASE
    WHEN v_available_count = 0 THEN 'zero_data'
    WHEN v_available_count = 1 THEN 'low_single_method_no_triangulation'
    WHEN v_available_count = 3 AND v_convergence_count >= 2 AND COALESCE(array_length(v_warnings, 1), 0) = 0 THEN 'high_three_way_convergence'
    WHEN v_available_count >= 2 AND v_convergence_count >= 1 AND COALESCE(array_length(v_warnings, 1), 0) <= 1 THEN 'moderate_pair_converges'
    WHEN v_convergence_count = 0 THEN 'low_no_method_convergence'
    ELSE 'moderate_mixed_signal'
  END;

  RETURN jsonb_build_object(
    'vehicle', jsonb_build_object('id', v_vehicle.id, 'year', v_vehicle.year, 'make', v_vehicle.make, 'model', v_vehicle.model, 'color', v_vehicle.color, 'vin', v_vehicle.vin),
    'substrate', jsonb_build_object(
      'atoms', v_atom_count, 'images', v_image_count,
      'first_photo', v_first_photo, 'last_photo', v_last_photo,
      'work_sessions', v_session_count,
      'total_min_clamped', v_total_min_clamped,
      'burst_active_min', v_burst_total_min
    ),
    'inferred_value', v_methods,
    'documented_costs', jsonb_build_object('parts', v_doc_parts_cost, 'payments_out', v_payments_out, 'total_documented', v_doc_parts_cost + v_payments_out),
    'market_value_trajectory', v_market_history,
    'latest_market_mid_USD', v_latest_market_mid,
    'pushes', v_pushes,
    'open_substrate_gaps', CASE
      WHEN v_session_count = 0 AND v_image_count > 0 THEN jsonb_build_array('no_payment_events_yet','purchase_price_unknown','no_work_sessions_run_rollup')
      WHEN v_payments_out = 0 THEN jsonb_build_array('no_payment_events_yet','purchase_price_unknown')
      ELSE '[]'::jsonb
    END,
    'warnings', COALESCE(to_jsonb(v_warnings), '[]'::jsonb),
    'confidence', v_confidence,
    'methodology_note', 'v1=duration_minutes(LEAST 480/day)·$160·0.92; v2=images·10min·$160·0.92; v3=burst-clustered active min (30min gap)·$160·0.92. Convergence computed only across available methods. Range = tightest convergent pair; falls back to full available spread + warning otherwise.'
  );
END;
$$;

COMMENT ON FUNCTION public.vehicle_full_picture(UUID) IS
'Worth Engine canonical readout. 3-way method triangulation (v1 time-span / v2 photo-count / v3 burst-active), availability-gated convergence, 5×market warning, convergence-driven confidence rating.';
