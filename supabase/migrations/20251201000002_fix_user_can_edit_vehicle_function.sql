-- ==========================================================================
-- FIX user_can_edit_vehicle FUNCTION - AMBIGUOUS organization_id
-- ==========================================================================
-- Problem: Function uses JOIN that creates ambiguous column reference
-- Solution: Use subquery instead of JOIN
-- ==========================================================================

CREATE OR REPLACE FUNCTION user_can_edit_vehicle(
  p_vehicle_id UUID,
  p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_can_edit BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = p_vehicle_id
      AND (
        v.uploaded_by = p_user_id
        OR v.user_id = p_user_id
        OR v.owner_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v.id
            AND vc.user_id = p_user_id
            AND vc.status = 'active'
            AND vc.can_edit = true
        )
        OR EXISTS (
          SELECT 1 FROM vehicle_contributor_roles vcr
          WHERE vcr.vehicle_id = v.id
            AND vcr.user_id = p_user_id
            AND vcr.role IN ('owner', 'restorer', 'contributor', 'moderator')
            AND (vcr.end_date IS NULL OR vcr.end_date > CURRENT_DATE)
        )
        OR EXISTS (
          SELECT 1 FROM organization_vehicles ov
          WHERE ov.vehicle_id = v.id
            AND EXISTS (
              SELECT 1 FROM organization_contributors oc
              WHERE oc.organization_id = ov.organization_id
                AND oc.user_id = p_user_id
                AND oc.status = 'active'
                AND oc.role IN ('owner', 'manager', 'employee')
            )
        )
      )
  ) INTO v_can_edit;
  
  RETURN COALESCE(v_can_edit, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION user_can_edit_vehicle IS 'Check if user has permission to edit a vehicle (checks all permission sources). Fixed to use subqueries instead of JOINs to avoid ambiguous organization_id references.';

