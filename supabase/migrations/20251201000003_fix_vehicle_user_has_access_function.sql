-- ==========================================================================
-- FIX vehicle_user_has_access FUNCTION - AMBIGUOUS organization_id
-- ==========================================================================
-- Problem: Function uses JOIN that creates ambiguous column reference
-- Solution: Use subquery instead of JOIN
-- ==========================================================================

CREATE OR REPLACE FUNCTION vehicle_user_has_access(p_vehicle_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_perm BOOLEAN := false;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  -- Direct vehicle-level permissions
  SELECT true INTO has_perm
  FROM vehicle_user_permissions vup
  WHERE vup.vehicle_id = p_vehicle_id
    AND vup.user_id = p_user_id
    AND COALESCE(vup.is_active, true) = true
    AND vup.role = ANY (ARRAY['owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member']::text[])
  LIMIT 1;

  IF has_perm THEN
    RETURN true;
  END IF;

  -- Vehicle contributors table (legacy collaborators)
  SELECT true INTO has_perm
  FROM vehicle_contributors vc
  WHERE vc.vehicle_id = p_vehicle_id
    AND vc.user_id = p_user_id
    AND COALESCE(vc.status, 'active') = 'active'
    AND vc.role = ANY (ARRAY['owner','co_owner','restorer','moderator','consigner','mechanic','appraiser','photographer','sales_agent']::text[])
  LIMIT 1;

  IF has_perm THEN
    RETURN true;
  END IF;

  -- Organization contributors linked to this vehicle (FIXED: use subquery instead of JOIN)
  SELECT true INTO has_perm
  FROM organization_vehicles ov
  WHERE ov.vehicle_id = p_vehicle_id
    AND EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = ov.organization_id
        AND oc.user_id = p_user_id
        AND oc.status = 'active'
        AND oc.role = ANY (ARRAY['owner','co_founder','board_member','manager','employee','technician','contractor','moderator','contributor','photographer']::text[])
    )
  LIMIT 1;

  IF has_perm THEN
    RETURN true;
  END IF;

  -- Verified ownership records
  SELECT true INTO has_perm
  FROM ownership_verifications ov
  WHERE ov.vehicle_id = p_vehicle_id
    AND ov.user_id = p_user_id
    AND ov.status = 'approved'
  LIMIT 1;

  RETURN COALESCE(has_perm, false);
END;
$$;

COMMENT ON FUNCTION vehicle_user_has_access IS 'Check if user has access to a vehicle. Fixed to use subqueries instead of JOINs to avoid ambiguous organization_id references.';

