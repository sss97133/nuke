-- =====================================================
-- ROI PRIMITIVES (SPEND -> VALUE DELTA)
-- =====================================================
-- Uses:
-- - spend_attributions (outflows)
-- - vehicle_price_history (value series) when available
-- - timeline_events.value_impact when available (event-level estimate)
--
-- Produces:
-- - get_vehicle_roi_summary(vehicle_id)
-- - get_work_order_roi_summary(work_order_id)
--
-- Date: 2025-12-14

BEGIN;

-- ==========================
-- 1) VEHICLE ROI SUMMARY
-- ==========================

CREATE OR REPLACE FUNCTION public.get_vehicle_roi_summary(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_has_vph BOOLEAN;
  v_spend_cents BIGINT;
  v_spend_usd NUMERIC(15,2);
  v_value_now NUMERIC(12,2);
  v_value_30d NUMERIC(12,2);
  v_value_delta_30d NUMERIC(12,2);
  v_event_value_impact NUMERIC(12,2);
  v_roi_30d NUMERIC(12,4);
BEGIN
  v_has_vph := (to_regclass('public.vehicle_price_history') IS NOT NULL);

  -- Spend: sum attributed outflows (receipt totals, etc.)
  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_spend_cents
  FROM public.spend_attributions
  WHERE vehicle_id = p_vehicle_id
    AND direction = 'outflow';

  v_spend_usd := (v_spend_cents::numeric / 100.0)::numeric(15,2);

  -- Current value (prefer vehicles.current_value; fallback to last price history)
  SELECT v.current_value::numeric INTO v_value_now
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;

  IF v_value_now IS NULL AND v_has_vph THEN
    SELECT vph.value::numeric INTO v_value_now
    FROM public.vehicle_price_history vph
    WHERE vph.vehicle_id = p_vehicle_id
    ORDER BY vph.as_of DESC
    LIMIT 1;
  END IF;

  -- Value 30d ago (from price history only)
  IF v_has_vph THEN
    SELECT vph.value::numeric INTO v_value_30d
    FROM public.vehicle_price_history vph
    WHERE vph.vehicle_id = p_vehicle_id
      AND vph.as_of <= NOW() - INTERVAL '30 days'
    ORDER BY vph.as_of DESC
    LIMIT 1;
  ELSE
    v_value_30d := NULL;
  END IF;

  v_value_delta_30d := CASE
    WHEN v_value_now IS NULL OR v_value_30d IS NULL THEN NULL
    ELSE (v_value_now - v_value_30d)
  END;

  -- Event-level value impact (best-effort; from timeline_events.value_impact)
  SELECT COALESCE(SUM(te.value_impact), 0)
    INTO v_event_value_impact
  FROM public.timeline_events te
  WHERE te.vehicle_id = p_vehicle_id
    AND te.value_impact IS NOT NULL;

  v_roi_30d := CASE
    WHEN v_spend_usd IS NULL OR v_spend_usd <= 0 OR v_value_delta_30d IS NULL THEN NULL
    ELSE (v_value_delta_30d / v_spend_usd)
  END;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'spend', jsonb_build_object(
      'attributed_spend_cents', v_spend_cents,
      'attributed_spend_usd', v_spend_usd
    ),
    'value', jsonb_build_object(
      'current_value_usd', v_value_now,
      'value_30d_ago_usd', v_value_30d,
      'delta_30d_usd', v_value_delta_30d
    ),
    'roi', jsonb_build_object(
      'roi_30d', v_roi_30d,
      'event_value_impact_sum', v_event_value_impact
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_vehicle_roi_summary IS 'Returns spend vs value delta ROI summary for a vehicle (30d delta from vehicle_price_history if available).';

-- ==========================
-- 2) WORK ORDER ROI SUMMARY
-- ==========================

CREATE OR REPLACE FUNCTION public.get_work_order_roi_summary(p_work_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_vehicle_id UUID;
  v_spend_cents BIGINT;
  v_spend_usd NUMERIC(15,2);
  v_value_impact NUMERIC(12,2);
  v_roi NUMERIC(12,4);
BEGIN
  SELECT wo.vehicle_id INTO v_vehicle_id
  FROM public.work_orders wo
  WHERE wo.id = p_work_order_id;

  -- Spend attributed directly to this work order
  SELECT COALESCE(SUM(sa.amount_cents), 0)
    INTO v_spend_cents
  FROM public.spend_attributions sa
  WHERE sa.work_order_id = p_work_order_id
    AND sa.direction = 'outflow';

  v_spend_usd := (v_spend_cents::numeric / 100.0)::numeric(15,2);

  -- Value impact: sum timeline_events.value_impact where linked to this work_order_id
  SELECT COALESCE(SUM(te.value_impact), 0)
    INTO v_value_impact
  FROM public.timeline_events te
  WHERE te.work_order_id = p_work_order_id
    AND te.value_impact IS NOT NULL;

  v_roi := CASE
    WHEN v_spend_usd <= 0 THEN NULL
    ELSE (v_value_impact / v_spend_usd)
  END;

  RETURN jsonb_build_object(
    'work_order_id', p_work_order_id,
    'vehicle_id', v_vehicle_id,
    'spend', jsonb_build_object(
      'attributed_spend_cents', v_spend_cents,
      'attributed_spend_usd', v_spend_usd
    ),
    'value', jsonb_build_object(
      'value_impact_usd', v_value_impact
    ),
    'roi', jsonb_build_object(
      'roi_from_value_impact', v_roi
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_work_order_roi_summary IS 'Returns spend vs value_impact ROI summary for a work order (requires timeline_events.work_order_id links).';

COMMIT;


