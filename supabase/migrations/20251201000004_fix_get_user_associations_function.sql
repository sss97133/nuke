-- ==========================================================================
-- FIX get_user_associations FUNCTION - AMBIGUOUS organization_id
-- ==========================================================================
-- Problem: Function uses JOIN that creates ambiguous column reference
-- Solution: Use subquery instead of JOIN
-- ==========================================================================

CREATE OR REPLACE FUNCTION get_user_associations(p_user_id UUID, p_vehicle_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_associations JSONB := '{}'::jsonb;
  v_org_associations JSONB;
  v_vehicle_contributions JSONB;
  v_vehicle_ownership JSONB;
BEGIN
  -- Get organization associations
  SELECT COALESCE(json_agg(
    json_build_object(
      'organization_id', oc.organization_id,
      'organization_name', b.business_name,
      'role', oc.role,
      'status', oc.status,
      'joined_at', oc.created_at
    )
  ), '[]'::json) INTO v_org_associations
  FROM organization_contributors oc
  LEFT JOIN businesses b ON b.id = oc.organization_id
  WHERE oc.user_id = p_user_id
    AND oc.status = 'active';

  -- Get vehicle-specific contributions/relationships
  SELECT COALESCE(json_agg(
    json_build_object(
      'relationship_type', vc.role,
      'status', vc.status,
      'can_edit', vc.can_edit,
      'can_delete', vc.can_delete,
      'created_at', vc.created_at
    )
  ), '[]'::json) INTO v_vehicle_contributions
  FROM vehicle_contributors vc
  WHERE vc.vehicle_id = p_vehicle_id
    AND vc.user_id = p_user_id
    AND vc.status = 'active';

  -- Check if user is vehicle owner/uploader
  SELECT json_build_object(
    'is_uploader', EXISTS(SELECT 1 FROM vehicles WHERE id = p_vehicle_id AND uploaded_by = p_user_id),
    'is_user_id', EXISTS(SELECT 1 FROM vehicles WHERE id = p_vehicle_id AND user_id = p_user_id),
    'is_owner_id', EXISTS(SELECT 1 FROM vehicles WHERE id = p_vehicle_id AND owner_id = p_user_id)
  ) INTO v_vehicle_ownership
  FROM vehicles
  WHERE id = p_vehicle_id;

  -- Check if user's organizations have vehicle relationships (FIXED: use subquery instead of JOIN)
  SELECT COALESCE(json_agg(
    json_build_object(
      'organization_id', ov.organization_id,
      'organization_name', b.business_name,
      'relationship_type', ov.relationship_type,
      'status', ov.status
    )
  ), '[]'::json) INTO v_associations
  FROM organization_vehicles ov
  LEFT JOIN businesses b ON b.id = ov.organization_id
  WHERE ov.vehicle_id = p_vehicle_id
    AND ov.status = 'active'
    AND EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = ov.organization_id
        AND oc.user_id = p_user_id
        AND oc.status = 'active'
    );

  -- Build comprehensive associations object
  RETURN json_build_object(
    'organizations', COALESCE(v_org_associations, '[]'::json),
    'vehicle_contributions', COALESCE(v_vehicle_contributions, '[]'::json),
    'vehicle_ownership', v_vehicle_ownership,
    'organization_vehicle_links', COALESCE(v_associations, '[]'::json),
    'timestamp', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_user_associations IS 'Get all user associations (organizations, vehicle relationships, roles) at a point in time for confidence scoring. Fixed to use subqueries instead of JOINs to avoid ambiguous organization_id references.';

