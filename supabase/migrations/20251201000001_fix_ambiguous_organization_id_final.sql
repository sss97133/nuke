-- ==========================================================================
-- FIX AMBIGUOUS organization_id ERROR - FINAL FIX
-- ==========================================================================
-- Problem: RLS policy has ambiguous column reference "organization_id"
-- when JOINing organization_vehicles and organization_contributors
-- Solution: Use explicit subqueries instead of JOINs
-- ==========================================================================

-- Drop the existing policy if it exists
DROP POLICY IF EXISTS "vehicles_comprehensive_update_policy" ON vehicles;

-- Recreate with explicit subqueries to avoid ambiguity
CREATE POLICY "vehicles_comprehensive_update_policy"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (
    -- User is the uploader (original creator)
    auth.uid() = uploaded_by
    OR
    -- User is set as user_id (legacy field)
    auth.uid() = user_id
    OR
    -- User is set as owner_id (legacy field)
    auth.uid() = owner_id
    OR
    -- User is in vehicle_contributors with edit permission
    EXISTS (
      SELECT 1
      FROM vehicle_contributors vc
      WHERE vc.vehicle_id = vehicles.id
        AND vc.user_id = auth.uid()
        AND vc.status = 'active'
        AND vc.can_edit = true
    )
    OR
    -- User is in vehicle_contributor_roles (legacy table for backwards compatibility)
    EXISTS (
      SELECT 1
      FROM vehicle_contributor_roles vcr
      WHERE vcr.vehicle_id = vehicles.id
        AND vcr.user_id = auth.uid()
        AND vcr.role IN ('owner', 'restorer', 'contributor', 'moderator')
        AND (vcr.end_date IS NULL OR vcr.end_date > CURRENT_DATE)
    )
    OR
    -- User is an organization member with vehicle access (FIXED: use subquery to avoid ambiguity)
    EXISTS (
      SELECT 1
      FROM organization_vehicles ov
      WHERE ov.vehicle_id = vehicles.id
        AND EXISTS (
          SELECT 1
          FROM organization_contributors oc
          WHERE oc.organization_id = ov.organization_id
            AND oc.user_id = auth.uid()
            AND oc.status = 'active'
            AND oc.role IN ('owner', 'manager', 'employee')
        )
    )
  )
  WITH CHECK (
    -- Same checks for updates
    auth.uid() = uploaded_by
    OR auth.uid() = user_id
    OR auth.uid() = owner_id
    OR EXISTS (
      SELECT 1
      FROM vehicle_contributors vc
      WHERE vc.vehicle_id = vehicles.id
        AND vc.user_id = auth.uid()
        AND vc.status = 'active'
        AND vc.can_edit = true
    )
    OR EXISTS (
      SELECT 1
      FROM vehicle_contributor_roles vcr
      WHERE vcr.vehicle_id = vehicles.id
        AND vcr.user_id = auth.uid()
        AND vcr.role IN ('owner', 'restorer', 'contributor', 'moderator')
        AND (vcr.end_date IS NULL OR vcr.end_date > CURRENT_DATE)
    )
    OR EXISTS (
      SELECT 1
      FROM organization_vehicles ov
      WHERE ov.vehicle_id = vehicles.id
        AND EXISTS (
          SELECT 1
          FROM organization_contributors oc
          WHERE oc.organization_id = ov.organization_id
            AND oc.user_id = auth.uid()
            AND oc.status = 'active'
            AND oc.role IN ('owner', 'manager', 'employee')
        )
    )
  );

COMMENT ON POLICY "vehicles_comprehensive_update_policy" ON vehicles IS 
  'Comprehensive vehicle update policy with fixed ambiguous column references. Uses subqueries instead of JOINs to avoid organization_id ambiguity.';

