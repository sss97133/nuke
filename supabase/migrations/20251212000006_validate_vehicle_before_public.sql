-- Vehicle "go live" gate for the vehicle profile form.
-- This function is called by edge functions (process-import-queue, auto-backfill-and-activate, scripts)
-- and must exist with the exact named argument p_vehicle_id.
--
-- Returns keys:
-- - can_go_live
-- - quality_score
-- - image_count
-- - issues
-- - recommendation

CREATE OR REPLACE FUNCTION public.validate_vehicle_before_public(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle RECORD;
  v_image_count INTEGER := 0;
  v_issue_list JSONB := '[]'::JSONB;
  v_quality_score INTEGER := 0;
  v_can_go_live BOOLEAN := false;
  v_recommendation TEXT := NULL;
BEGIN
  SELECT * INTO v_vehicle FROM public.vehicles WHERE id = p_vehicle_id;
  IF v_vehicle IS NULL THEN
    RETURN jsonb_build_object(
      'can_go_live', false,
      'quality_score', 0,
      'image_count', 0,
      'issues', jsonb_build_array(jsonb_build_object('type','error','message','Vehicle not found')),
      'recommendation', 'vehicle_missing'
    );
  END IF;

  -- Images
  SELECT COUNT(*) INTO v_image_count FROM public.vehicle_images WHERE vehicle_id = p_vehicle_id;
  IF v_image_count = 0 THEN
    v_issue_list := v_issue_list || jsonb_build_object('type','error','message','No images');
  END IF;

  -- VIN (optional for some sources, but required to go live in your current quality scoring system)
  IF v_vehicle.vin IS NULL OR length(v_vehicle.vin) < 10 OR v_vehicle.vin LIKE 'VIVA-%' THEN
    v_issue_list := v_issue_list || jsonb_build_object('type','error','message','Missing/placeholder VIN');
  END IF;

  -- Basic identity
  IF v_vehicle.year IS NULL OR v_vehicle.make IS NULL OR v_vehicle.model IS NULL THEN
    v_issue_list := v_issue_list || jsonb_build_object('type','error','message','Missing year/make/model');
  END IF;

  -- Compute quality score if the system exists
  BEGIN
    v_quality_score := public.calculate_vehicle_quality_score(p_vehicle_id);
  EXCEPTION WHEN undefined_function THEN
    v_quality_score := 0;
  END;

  v_can_go_live := jsonb_array_length(v_issue_list) = 0 AND v_quality_score >= 60;

  IF NOT v_can_go_live THEN
    v_recommendation := CASE
      WHEN jsonb_array_length(v_issue_list) > 0 THEN 'fix_issues'
      ELSE 'improve_quality_score'
    END;
  END IF;

  RETURN jsonb_build_object(
    'can_go_live', v_can_go_live,
    'quality_score', v_quality_score,
    'image_count', v_image_count,
    'issues', v_issue_list,
    'recommendation', v_recommendation
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_vehicle_before_public(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_vehicle_before_public(UUID) TO authenticated;


