-- ==========================================================================
-- FIX VEHICLE EDIT PERMISSIONS
-- ==========================================================================
-- Problem: Multiple conflicting RLS policies and table confusion
-- Solution: Clean slate with one clear policy
-- ==========================================================================

-- ==========================================================================
-- 1. DROP ALL CONFLICTING UPDATE POLICIES
-- ==========================================================================

DROP POLICY IF EXISTS "Any authenticated user can edit vehicles" ON vehicles;
DROP POLICY IF EXISTS "Only owners and contributors can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "vehicles_update_by_contributors" ON vehicles;
DROP POLICY IF EXISTS "Simple vehicle update policy" ON vehicles;
DROP POLICY IF EXISTS "authenticated_users_can_update_vehicles" ON vehicles;
DROP POLICY IF EXISTS "Authenticated users can update any vehicle" ON vehicles;
DROP POLICY IF EXISTS "vehicles_admin_owner_update" ON vehicles;
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;

-- ==========================================================================
-- 2. CREATE ONE COMPREHENSIVE UPDATE POLICY
-- ==========================================================================

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
    -- User is an organization member with vehicle access
    EXISTS (
      SELECT 1
      FROM organization_vehicles ov
      JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id = vehicles.id
        AND oc.user_id = auth.uid()
        AND oc.status = 'active'
        AND oc.role IN ('owner', 'manager', 'employee')
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
      JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id = vehicles.id
        AND oc.user_id = auth.uid()
        AND oc.status = 'active'
        AND oc.role IN ('owner', 'manager', 'employee')
    )
  );

COMMENT ON POLICY "vehicles_comprehensive_update_policy" ON vehicles IS 
  'Comprehensive vehicle update policy checking all permission sources: uploaded_by, user_id, owner_id, vehicle_contributors, vehicle_contributor_roles, and organization membership';

-- ==========================================================================
-- 3. ADD PERMISSION COLUMNS TO vehicle_contributors (IF NOT EXISTS)
-- ==========================================================================

-- Add can_edit column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_contributors' AND column_name = 'can_edit'
  ) THEN
    ALTER TABLE vehicle_contributors ADD COLUMN can_edit BOOLEAN DEFAULT true;
  END IF;
END $$;

-- Add can_delete column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_contributors' AND column_name = 'can_delete'
  ) THEN
    ALTER TABLE vehicle_contributors ADD COLUMN can_delete BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Add can_approve column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_contributors' AND column_name = 'can_approve'
  ) THEN
    ALTER TABLE vehicle_contributors ADD COLUMN can_approve BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Add can_sell column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_contributors' AND column_name = 'can_sell'
  ) THEN
    ALTER TABLE vehicle_contributors ADD COLUMN can_sell BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Add organization_id if it doesn't exist (for org-scoped collaborators)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_contributors' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE vehicle_contributors ADD COLUMN organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ==========================================================================
-- 4. SYNC OLD DATA TO NEW TABLE (if needed)
-- ==========================================================================

-- Copy contributor roles from old table to new table if they don't exist
INSERT INTO vehicle_contributors (
  vehicle_id,
  user_id,
  role,
  status,
  created_at
)
SELECT 
  vcr.vehicle_id,
  vcr.user_id,
  vcr.role,
  'active' as status,
  COALESCE(vcr.created_at, NOW()) as created_at
FROM vehicle_contributor_roles vcr
WHERE NOT EXISTS (
  SELECT 1
  FROM vehicle_contributors vc
  WHERE vc.vehicle_id = vcr.vehicle_id
    AND vc.user_id = vcr.user_id
)
AND (vcr.end_date IS NULL OR vcr.end_date > CURRENT_DATE)
ON CONFLICT DO NOTHING;

-- Update permission flags based on role
UPDATE vehicle_contributors
SET 
  can_edit = true,
  can_delete = CASE WHEN role IN ('owner', 'co_owner') THEN true ELSE false END,
  can_approve = CASE WHEN role IN ('owner', 'co_owner', 'moderator') THEN true ELSE false END,
  can_sell = CASE WHEN role IN ('owner', 'co_owner', 'manager') THEN true ELSE false END
WHERE can_edit IS NULL;

-- ==========================================================================
-- 5. CREATE HELPER FUNCTION FOR PERMISSION CHECKS
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
          JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
          WHERE ov.vehicle_id = v.id
            AND oc.user_id = p_user_id
            AND oc.status = 'active'
            AND oc.role IN ('owner', 'manager', 'employee')
        )
      )
  ) INTO v_can_edit;
  
  RETURN COALESCE(v_can_edit, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION user_can_edit_vehicle IS 'Check if user has permission to edit a vehicle (checks all permission sources)';

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION user_can_edit_vehicle TO authenticated;

-- ==========================================================================
-- 6. DIAGNOSTIC VIEW FOR DEBUGGING
-- ==========================================================================

CREATE OR REPLACE VIEW vehicle_permissions_debug AS
SELECT 
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  v.vin,
  v.uploaded_by,
  v.user_id,
  v.owner_id,
  -- Contributors (unified)
  (
    SELECT json_agg(json_build_object(
      'user_id', vc.user_id,
      'role', vc.role,
      'status', vc.status
    ))
    FROM vehicle_contributors vc
    WHERE vc.vehicle_id = v.id
  ) as contributors,
  -- Old contributor roles
  (
    SELECT json_agg(json_build_object(
      'user_id', vcr.user_id,
      'role', vcr.role
    ))
    FROM vehicle_contributor_roles vcr
    WHERE vcr.vehicle_id = v.id
      AND (vcr.end_date IS NULL OR vcr.end_date > CURRENT_DATE)
  ) as old_contributor_roles,
  -- Organization access
  (
    SELECT json_agg(json_build_object(
      'org_id', ov.organization_id,
      'org_name', b.business_name,
      'members', (
        SELECT json_agg(json_build_object('user_id', oc.user_id, 'role', oc.role))
        FROM organization_contributors oc
        WHERE oc.organization_id = ov.organization_id
          AND oc.status = 'active'
      )
    ))
    FROM organization_vehicles ov
    JOIN businesses b ON b.id = ov.organization_id
    WHERE ov.vehicle_id = v.id
      AND ov.status = 'active'
  ) as org_access
FROM vehicles v
ORDER BY v.created_at DESC;

COMMENT ON VIEW vehicle_permissions_debug IS 'Debug view showing all permission paths for vehicles';
GRANT SELECT ON vehicle_permissions_debug TO authenticated;

