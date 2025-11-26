-- ==========================================================================
-- FIX AMBIGUOUS organization_id ERROR AND ADD USER ASSOCIATION LOGGING
-- ==========================================================================
-- Problem: RLS policy has ambiguous column reference "organization_id"
-- Solution: Rewrite JOIN to use subquery, add user association logging
-- ==========================================================================

-- ==========================================================================
-- 1. FIX AMBIGUOUS COLUMN REFERENCE IN RLS POLICY
-- ==========================================================================

-- Drop the existing policy
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
  'Comprehensive vehicle update policy with fixed ambiguous column references. Checks all permission sources: uploaded_by, user_id, owner_id, vehicle_contributors, vehicle_contributor_roles, and organization membership';

-- ==========================================================================
-- 2. ENHANCE vehicle_edit_audit TO CAPTURE USER ASSOCIATIONS
-- ==========================================================================

-- Add columns to vehicle_edit_audit (the underlying table) for user associations
ALTER TABLE vehicle_edit_audit
ADD COLUMN IF NOT EXISTS user_associations JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS confidence_score INTEGER,
ADD COLUMN IF NOT EXISTS confidence_factors JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS source TEXT,
ADD COLUMN IF NOT EXISTS change_reason TEXT;

COMMENT ON COLUMN vehicle_edit_audit.user_associations IS 'User associations at time of modification: organizations, vehicle relationships, roles, etc.';
COMMENT ON COLUMN vehicle_edit_audit.confidence_score IS 'Calculated confidence score (0-100) based on user associations and verification sources';
COMMENT ON COLUMN vehicle_edit_audit.confidence_factors IS 'Breakdown of confidence calculation factors';
COMMENT ON COLUMN vehicle_edit_audit.source IS 'Source of the edit: inline_edit, bat_import, vin_decoder, etc.';

-- Create index for confidence queries
CREATE INDEX IF NOT EXISTS idx_edit_audit_confidence ON vehicle_edit_audit(confidence_score DESC);

-- ==========================================================================
-- 3. FUNCTION TO GET USER ASSOCIATIONS AT TIME OF MODIFICATION
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

  -- Check if user's organizations have vehicle relationships
  SELECT COALESCE(json_agg(
    json_build_object(
      'organization_id', ov.organization_id,
      'organization_name', b.business_name,
      'relationship_type', ov.relationship_type,
      'status', ov.status
    )
  ), '[]'::json) INTO v_associations
  FROM organization_vehicles ov
  JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
  LEFT JOIN businesses b ON b.id = ov.organization_id
  WHERE ov.vehicle_id = p_vehicle_id
    AND oc.user_id = p_user_id
    AND oc.status = 'active'
    AND ov.status = 'active';

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

COMMENT ON FUNCTION get_user_associations IS 'Get all user associations (organizations, vehicle relationships, roles) at a point in time for confidence scoring';

-- ==========================================================================
-- 4. FUNCTION TO CALCULATE CONFIDENCE SCORE BASED ON USER ASSOCIATIONS
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

  -- Check organization access
  SELECT COUNT(*) INTO v_org_count
  FROM organization_vehicles ov
  JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
  WHERE ov.vehicle_id = p_vehicle_id
    AND oc.user_id = p_user_id
    AND oc.status = 'active'
    AND ov.status = 'active';

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

COMMENT ON FUNCTION calculate_edit_confidence IS 'Calculate confidence score (0-100) for a vehicle edit based on user associations, ownership, and source';

-- ==========================================================================
-- 5. ENHANCED log_vehicle_edit FUNCTION WITH ASSOCIATIONS AND CONFIDENCE
-- ==========================================================================

-- Drop existing function if it exists (there's a trigger function with same name)
DROP FUNCTION IF EXISTS log_vehicle_edit(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION log_vehicle_edit(
  p_vehicle_id UUID,
  p_field_name TEXT,
  p_old_value TEXT,
  p_new_value TEXT,
  p_user_id UUID,
  p_source TEXT DEFAULT 'inline_edit',
  p_change_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_edit_id UUID;
  v_associations JSONB;
  v_confidence_data JSONB;
  v_confidence_score INTEGER;
  v_confidence_factors JSONB;
BEGIN
  -- Get user associations at time of modification
  SELECT get_user_associations(p_user_id, p_vehicle_id) INTO v_associations;

  -- Calculate confidence score
  SELECT calculate_edit_confidence(p_user_id, p_vehicle_id, p_field_name, p_source) INTO v_confidence_data;
  
  v_confidence_score := (v_confidence_data->>'confidence_score')::INTEGER;
  v_confidence_factors := v_confidence_data->'factors';

  -- Insert into edit audit table (underlying table) with associations and confidence
  INSERT INTO vehicle_edit_audit (
    vehicle_id,
    editor_id,
    field_name,
    old_value,
    new_value,
    change_type,
    edit_reason,
    source,
    user_associations,
    confidence_score,
    confidence_factors
  ) VALUES (
    p_vehicle_id,
    p_user_id,
    p_field_name,
    p_old_value,
    p_new_value,
    'update',
    p_change_reason,
    p_source,
    v_associations,
    v_confidence_score,
    v_confidence_factors
  )
  RETURNING id INTO v_edit_id;
  
  RETURN v_edit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_vehicle_edit(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) IS 'Enhanced logging function that captures user associations and calculates confidence scores for vehicle edits';

-- ==========================================================================
-- 6. TRIGGER TO AUTO-LOG EDITS WITH ASSOCIATIONS (OPTIONAL)
-- ==========================================================================

-- Create trigger function to automatically log edits
CREATE OR REPLACE FUNCTION auto_log_vehicle_edit()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_field_name TEXT;
  v_old_value TEXT;
  v_new_value TEXT;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN NEW; -- Skip logging if no user
  END IF;

  -- Log changes for each modified field
  -- This is a simplified version - in practice, you'd want to compare OLD and NEW
  -- and only log actual changes
  
  -- For now, we'll rely on the application calling log_vehicle_edit explicitly
  -- This trigger can be enhanced later if needed
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================================================
-- 7. UPDATE vehicle_edit_history VIEW TO INCLUDE NEW COLUMNS
-- ==========================================================================

-- Drop and recreate the view with new columns
DROP VIEW IF EXISTS vehicle_edit_history;

CREATE VIEW vehicle_edit_history AS
SELECT 
  vea.id,
  vea.vehicle_id,
  v.year || ' ' || v.make || ' ' || v.model AS vehicle_name,
  vea.editor_id,
  p.username AS editor_username,
  p.full_name AS editor_name,
  vea.field_name,
  vea.old_value,
  vea.new_value,
  vea.change_type,
  vea.edit_reason,
  vea.created_at,
  -- New columns for confidence and associations
  vea.source,
  vea.confidence_score,
  vea.confidence_factors,
  vea.user_associations,
  CASE 
    WHEN vea.confidence_score >= 80 THEN 'high'
    WHEN vea.confidence_score >= 60 THEN 'medium'
    ELSE 'low'
  END as confidence_level
FROM vehicle_edit_audit vea
LEFT JOIN vehicles v ON v.id = vea.vehicle_id
LEFT JOIN profiles p ON p.id = vea.editor_id
ORDER BY vea.created_at DESC;

COMMENT ON VIEW vehicle_edit_history IS 'Edit history view with confidence scores and user associations for verification';

GRANT SELECT ON vehicle_edit_history TO authenticated;
GRANT SELECT ON vehicle_edit_history TO anon;

-- ==========================================================================
-- 7b. CREATE ENHANCED VIEW FOR CONFIDENCE-BASED QUERIES
-- ==========================================================================

CREATE OR REPLACE VIEW vehicle_edit_history_with_confidence AS
SELECT 
  veh.*,
  v.year,
  v.make,
  v.model
FROM vehicle_edit_history veh
JOIN vehicles v ON v.id = veh.vehicle_id
ORDER BY veh.created_at DESC;

COMMENT ON VIEW vehicle_edit_history_with_confidence IS 'Enhanced edit history with confidence scores and vehicle details';

GRANT SELECT ON vehicle_edit_history_with_confidence TO authenticated;

-- ==========================================================================
-- 8. GRANT PERMISSIONS
-- ==========================================================================

GRANT EXECUTE ON FUNCTION get_user_associations TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_edit_confidence TO authenticated;
GRANT EXECUTE ON FUNCTION log_vehicle_edit(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;

