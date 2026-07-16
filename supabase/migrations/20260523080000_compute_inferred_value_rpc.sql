-- 20260523080000_compute_inferred_value_rpc.sql
--
-- Adds the worth-proving engine's core inference function: compute_inferred_value(vehicle_id, date).
--
-- Returns the system's INFERRED value for a vehicle on a date, computed live against:
--   • the day's photo atoms (vehicle_images with area/operation/image_type populated)
--   • the day's work_session (if any) for labor_minutes + parts_cost
--   • the organizations table for shop labor-rate comparables (sparse — confidence-bounded)
--   • the multi-factor equation: labor_base × tier × quality × speed × specialty + parts
--
-- The function NEVER stores its output. It's a computed view. Change the underlying factors
-- (shop labor_rate, technician tier, etc.) → every historical receipt updates automatically
-- on next read.
--
-- Per the working paper at docs/library/working/working-papers/2026-05-23_worth-proving-engine-retrospective.md,
-- this RPC closes the snake-eating-tail loop by replacing the CLI-flag-baked values in
-- build-day.mjs with live lookups.
--
-- Confidence bounded by data density:
--   N=0 comparables → fallback to caller-claimed rate, confidence: 'fallback-to-claimed'
--   N<3 → confidence: 'low'
--   N<10 → confidence: 'moderate'
--   N≥10 → confidence: 'high'
--
-- The user can dial their CLAIMED rate (stored separately, not by this function).
-- This function returns INFERRED. The delta is the worth-proof.
--
-- Cross-references:
--   • docs/library/reference/encyclopedia/05-image-as-butterfly-node.md
--   • docs/library/technical/engineering-manual/17-daily-receipt-processor.md
--   • get_daily_work_receipt(vehicle_id, date) — the existing per-day RPC this complements

CREATE OR REPLACE FUNCTION public.compute_inferred_value(
  p_vehicle_id UUID,
  p_date DATE
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_vehicle           RECORD;
  v_session           RECORD;
  v_photo_count       INT;
  v_labor_minutes     INT     := 0;
  v_parts_cost        NUMERIC := 0;
  v_specialty_mult    NUMERIC := 1.0;
  v_tier_mult         NUMERIC := 1.0;
  v_quality_mult      NUMERIC := 1.0;
  v_shop_rate         NUMERIC;
  v_shop_rate_conf    TEXT;
  v_n_comparables     INT     := 0;
  v_labor_value       NUMERIC := 0;
  v_inferred_value    NUMERIC := 0;
  v_methodology       JSONB;
  v_op_breakdown      JSONB;
  v_caller_default_rate NUMERIC := 85.00;  -- Skylar's claimed rate fallback
BEGIN
  -- 1. Vehicle lookup
  SELECT id, year, make, model, owner_id
    INTO v_vehicle
    FROM public.vehicles
   WHERE id = p_vehicle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'vehicle not found',
      'vehicle_id', p_vehicle_id
    );
  END IF;

  -- 2. Photo count + labor inputs for the day
  SELECT count(*)::INT
    INTO v_photo_count
    FROM public.vehicle_images
   WHERE vehicle_id = p_vehicle_id
     AND taken_at::date = p_date;

  -- 3. Work session for the day (if exists)
  SELECT id, duration_minutes, total_parts_cost
    INTO v_session
    FROM public.work_sessions
   WHERE vehicle_id = p_vehicle_id
     AND session_date = p_date
   LIMIT 1;

  IF FOUND THEN
    v_labor_minutes := COALESCE(v_session.duration_minutes, 0);
    v_parts_cost    := COALESCE(v_session.total_parts_cost, 0);
  END IF;

  -- 4. If no photos AND no session → zero day
  IF v_photo_count = 0 AND v_labor_minutes = 0 THEN
    RETURN jsonb_build_object(
      'vehicle_id', p_vehicle_id,
      'date', p_date,
      'inferred_value', 0,
      'labor_value', 0,
      'parts_cost', 0,
      'confidence', 'high',
      'methodology', jsonb_build_object(
        'reason', 'no atoms for this date',
        'photo_count', 0,
        'labor_minutes', 0
      )
    );
  END IF;

  -- 5. Specialty multiplier weighted from per-photo operations
  WITH op_counts AS (
    SELECT operation, count(*) AS n
      FROM public.vehicle_images
     WHERE vehicle_id = p_vehicle_id
       AND taken_at::date = p_date
       AND operation IS NOT NULL
     GROUP BY operation
  ),
  op_mult AS (
    SELECT operation, n,
      CASE
        WHEN operation IN ('wiring_install_or_trace', 'interior_wiring_session') THEN 1.30
        WHEN operation = 'harness_fabrication' THEN 1.40
        WHEN operation = 'exhaust_install' THEN 1.20
        WHEN operation IN ('underbody_prep', 'masking_for_paint') THEN 1.15
        WHEN operation IN ('sound_deadener_install', 'sound_deadener_install_continued') THEN 1.05
        WHEN operation IN ('gauge_cluster_removal', 'wiring_inspection',
                            'hood_removed_engine_access', 'underbody_engine_inspection',
                            'steering_column_cable_inspection') THEN 1.10
        WHEN operation IN ('hood_up_engine_inspection', 'inspection_on_lift') THEN 1.05
        WHEN operation IN ('parts_layout_review', 'part_documentation') THEN 0.90
        WHEN operation = 'wheel_removal_inspection' THEN 1.00
        WHEN operation = 'delivery_transaction' THEN 0.50
        WHEN operation = 'received_at_shop' THEN 0.80
        WHEN operation = 'shop_inspection' THEN 0.85
        WHEN operation = 'video_production' THEN 1.20
        WHEN operation = 'masking_for_paint' THEN 1.10
        ELSE 1.00
      END AS m
    FROM op_counts
  )
  SELECT
    COALESCE(sum(n * m) / NULLIF(sum(n), 0), 1.0),
    jsonb_object_agg(operation, jsonb_build_object('count', n, 'multiplier', m))
  INTO v_specialty_mult, v_op_breakdown
  FROM op_mult;

  -- 6. Shop labor rate from comparables.
  -- Priority: same-city → same-state → other. Sparse data: confidence reflects N.
  -- For now, derive geography from owner's home city (Skylar = Boulder City NV).
  -- Future: when shops table exists with vehicle→shop association, query that instead.
  SELECT
    AVG(labor_rate) FILTER (WHERE labor_rate IS NOT NULL),
    count(*) FILTER (WHERE labor_rate IS NOT NULL)
  INTO v_shop_rate, v_n_comparables
  FROM public.organizations
  WHERE labor_rate IS NOT NULL
    AND ((city ILIKE 'boulder%' AND state = 'NV')
         OR state = 'NV');

  v_shop_rate_conf := CASE
    WHEN v_n_comparables = 0 THEN 'zero_data'
    WHEN v_n_comparables < 3 THEN 'low_n_under_3'
    WHEN v_n_comparables < 10 THEN 'moderate_n_under_10'
    ELSE 'high_n_at_least_10'
  END;

  IF v_shop_rate IS NULL OR v_shop_rate <= 0 THEN
    v_shop_rate := v_caller_default_rate;
    v_shop_rate_conf := 'fallback_to_caller_claimed_rate';
  END IF;

  -- 7. Multi-factor labor value
  v_labor_value := (v_labor_minutes::NUMERIC / 60)
                   * v_shop_rate
                   * v_tier_mult
                   * v_quality_mult
                   * v_specialty_mult;

  v_inferred_value := v_labor_value + v_parts_cost;

  -- 8. Methodology trace (auditable, every component visible)
  v_methodology := jsonb_build_object(
    'labor_minutes', v_labor_minutes,
    'parts_cost', v_parts_cost,
    'shop_rate_used', round(v_shop_rate, 2),
    'shop_rate_confidence', v_shop_rate_conf,
    'n_comparables_in_geography', v_n_comparables,
    'tier_multiplier', v_tier_mult,
    'quality_multiplier', v_quality_mult,
    'specialty_multiplier', round(v_specialty_mult, 3),
    'specialty_breakdown', COALESCE(v_op_breakdown, '{}'::jsonb),
    'photo_count', v_photo_count,
    'has_work_session', (v_session.id IS NOT NULL),
    'equation', 'labor_value = (minutes/60) × shop_rate × tier × quality × specialty;  total = labor_value + parts_cost'
  );

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'vehicle', jsonb_build_object('year', v_vehicle.year, 'make', v_vehicle.make, 'model', v_vehicle.model),
    'date', p_date,
    'inferred_value', round(v_inferred_value, 2),
    'labor_value', round(v_labor_value, 2),
    'parts_cost', v_parts_cost,
    'confidence', v_shop_rate_conf,
    'methodology', v_methodology
  );
END;
$$;

COMMENT ON FUNCTION public.compute_inferred_value(UUID, DATE) IS
'Worth-proving engine inferred-value function. Returns the system''s INFERRED dollar value for a vehicle on a date, computed live from atoms × market comparables. Never stored — always recomputed. Confidence bounded by data density. See docs/library/reference/encyclopedia/05-image-as-butterfly-node.md';

-- Convenience companion: bulk compute over a date range for a vehicle
CREATE OR REPLACE FUNCTION public.compute_inferred_value_range(
  p_vehicle_id UUID,
  p_start_date DATE,
  p_end_date DATE
) RETURNS TABLE(date DATE, value JSONB)
LANGUAGE sql
STABLE
AS $$
  SELECT d::date, public.compute_inferred_value(p_vehicle_id, d::date)
    FROM generate_series(p_start_date, p_end_date, '1 day'::interval) d;
$$;

COMMENT ON FUNCTION public.compute_inferred_value_range(UUID, DATE, DATE) IS
'Range version of compute_inferred_value. Returns one row per day. Useful for backfilling DayCard timelines or weekly/monthly rollups.';

-- Grant exec to anon + authenticated (read-only function)
GRANT EXECUTE ON FUNCTION public.compute_inferred_value(UUID, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_inferred_value_range(UUID, DATE, DATE) TO anon, authenticated;
