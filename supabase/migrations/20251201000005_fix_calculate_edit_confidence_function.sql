-- ==========================================================================
-- FIX calculate_edit_confidence FUNCTION - AMBIGUOUS organization_id
-- ==========================================================================
-- Problem: Function uses JOIN that creates ambiguous column reference
-- Solution: Use subquery instead of JOIN
-- ==========================================================================

CREATE OR REPLACE FUNCTION calculate_edit_confidence(
  p_user_id UUID,
  p_vehicle_id UUID,
  p_field_name TEXT,
  p_source TEXT DEFAULT 'user_input'
)
RETURNS JSONB AS $$
DECLARE
  v_associations JSONB;
  v_confidence INTEGER := 50; -- Base confidence
  v_factors JSONB := '{}'::jsonb;
  v_is_owner BOOLEAN := false;
  v_is_uploader BOOLEAN := false;
  v_has_org_access BOOLEAN := false;
  v_has_vehicle_contribution BOOLEAN := false;
  v_org_count INTEGER := 0;
  v_professional_role BOOLEAN := false;
BEGIN
  -- Get user associations
  SELECT get_user_associations(p_user_id, p_vehicle_id) INTO v_associations;

  -- Check ownership/uploader status
  SELECT 
    EXISTS(SELECT 1 FROM vehicles WHERE id = p_vehicle_id AND uploaded_by = p_user_id),
    EXISTS(SELECT 1 FROM vehicles WHERE id = p_vehicle_id AND user_id = p_user_id),
    EXISTS(SELECT 1 FROM vehicles WHERE id = p_vehicle_id AND owner_id = p_user_id)
  INTO v_is_uploader, v_is_owner, v_is_owner;

  IF v_is_uploader OR v_is_owner THEN
    v_confidence := v_confidence + 30; -- High boost for ownership
    v_factors := v_factors || jsonb_build_object('ownership_boost', 30);
  END IF;

  -- Check vehicle contributions
  IF EXISTS (
    SELECT 1 FROM vehicle_contributors vc
    WHERE vc.vehicle_id = p_vehicle_id
      AND vc.user_id = p_user_id
      AND vc.status = 'active'
  ) THEN
    v_has_vehicle_contribution := true;
    v_confidence := v_confidence + 15;
    v_factors := v_factors || jsonb_build_object('contribution_boost', 15);
  END IF;

  -- Check organization access (FIXED: use subquery instead of JOIN)
  SELECT COUNT(*) INTO v_org_count
  FROM organization_vehicles ov
  WHERE ov.vehicle_id = p_vehicle_id
    AND ov.status = 'active'
    AND EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = ov.organization_id
        AND oc.user_id = p_user_id
        AND oc.status = 'active'
    );

  IF v_org_count > 0 THEN
    v_has_org_access := true;
    v_confidence := v_confidence + 20; -- Boost for organizational connection
    v_factors := v_factors || jsonb_build_object('org_access_boost', 20, 'org_count', v_org_count);
  END IF;

  -- Check for professional roles
  SELECT EXISTS (
    SELECT 1 FROM organization_contributors oc
    WHERE oc.user_id = p_user_id
      AND oc.status = 'active'
      AND oc.role IN ('owner', 'manager', 'professional')
  ) INTO v_professional_role;

  IF v_professional_role THEN
    v_confidence := v_confidence + 10;
    v_factors := v_factors || jsonb_build_object('professional_role_boost', 10);
  END IF;

  -- Source-based adjustments
  CASE p_source
    WHEN 'vin_decoder' THEN
      v_confidence := v_confidence + 5;
      v_factors := v_factors || jsonb_build_object('source_boost', 5, 'source_type', 'vin_decoder');
    WHEN 'bat_import' THEN
      v_confidence := v_confidence + 10;
      v_factors := v_factors || jsonb_build_object('source_boost', 10, 'source_type', 'bat_import');
    WHEN 'professional_verification' THEN
      v_confidence := v_confidence + 15;
      v_factors := v_factors || jsonb_build_object('source_boost', 15, 'source_type', 'professional_verification');
    ELSE
      v_factors := v_factors || jsonb_build_object('source_boost', 0, 'source_type', p_source);
  END CASE;

  -- Cap confidence at 100
  IF v_confidence > 100 THEN
    v_confidence := 100;
  END IF;

  -- Return confidence score and factors
  RETURN json_build_object(
    'confidence_score', v_confidence,
    'factors', v_factors,
    'associations', v_associations,
    'calculated_at', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION calculate_edit_confidence IS 'Calculate confidence score (0-100) for a vehicle edit based on user associations, ownership, and source. Fixed to use subqueries instead of JOINs to avoid ambiguous organization_id references.';

