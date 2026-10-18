-- Missing valuation evidence is unknown, not a zero-dollar estimate or change.
-- Preserve the existing invoker, arguments, date grain and grants. No data writes.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

CREATE OR REPLACE FUNCTION public.market_value_delta(
  p_vehicle_id UUID, p_from_date DATE, p_to_date DATE
) RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  SELECT value_mid INTO v_before FROM public.vehicle_market_estimates
   WHERE vehicle_id=p_vehicle_id AND estimated_at::date <= p_from_date
   ORDER BY estimated_at DESC LIMIT 1;
  SELECT value_mid INTO v_after FROM public.vehicle_market_estimates
   WHERE vehicle_id=p_vehicle_id AND estimated_at::date <= p_to_date
   ORDER BY estimated_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'vehicle_id',p_vehicle_id,'from_date',p_from_date,'to_date',p_to_date,
    'value_before',v_before,'value_after',v_after,'delta',v_after-v_before,
    'has_data',(v_before IS NOT NULL AND v_after IS NOT NULL)
  );
END;
$$;

COMMIT;
