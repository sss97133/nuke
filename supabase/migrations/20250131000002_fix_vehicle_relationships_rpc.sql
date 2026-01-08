-- Fix: Ensure should_show_in_user_profile function exists
-- Fix: Ensure get_user_vehicle_relationships RPC exists with permission_ownerships
-- This migration ensures both functions exist even if previous migrations weren't applied

-- Step 1: Create should_show_in_user_profile if it doesn't exist
CREATE OR REPLACE FUNCTION should_show_in_user_profile(
  p_vehicle_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_has_title_ownership BOOLEAN;
  v_is_direct_owner BOOLEAN;
  v_is_org_responsible BOOLEAN;
  v_has_active_contribution BOOLEAN;
  v_is_just_uploader BOOLEAN;
  v_has_org_link BOOLEAN;
  v_is_discovered BOOLEAN;
BEGIN
  -- 1. Title ownership (strongest - always show)
  SELECT EXISTS (
    SELECT 1 FROM ownership_verifications
    WHERE vehicle_id = p_vehicle_id
      AND user_id = p_user_id
      AND status = 'approved'
  ) INTO v_has_title_ownership;
  
  IF v_has_title_ownership THEN
    RETURN true;
  END IF;
  
  -- 2. Direct ownership (strong - show)
  SELECT EXISTS (
    SELECT 1 FROM vehicles
    WHERE id = p_vehicle_id
      AND user_id = p_user_id
  ) INTO v_is_direct_owner;
  
  IF v_is_direct_owner THEN
    RETURN true;
  END IF;
  
  -- 3. Organization responsible party (strong - show)
  SELECT EXISTS (
    SELECT 1 FROM organization_vehicles
    WHERE vehicle_id = p_vehicle_id
      AND responsible_party_user_id = p_user_id
      AND status = 'active'
  ) INTO v_is_org_responsible;
  
  IF v_is_org_responsible THEN
    RETURN true;
  END IF;
  
  -- 4. Check if vehicle is linked to organization (weakens personal claim)
  SELECT EXISTS (
    SELECT 1 FROM organization_vehicles
    WHERE vehicle_id = p_vehicle_id
      AND status = 'active'
      AND (auto_tagged = true OR relationship_type IN ('owner', 'in_stock', 'work_location'))
  ) INTO v_has_org_link;
  
  -- 5. Active contribution (images or timeline events in last 90 days)
  SELECT EXISTS (
    SELECT 1 FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND user_id = p_user_id
      AND created_at > NOW() - INTERVAL '90 days'
    UNION
    SELECT 1 FROM timeline_events
    WHERE vehicle_id = p_vehicle_id
      AND user_id = p_user_id
      AND created_at > NOW() - INTERVAL '90 days'
  ) INTO v_has_active_contribution;
  
  -- 6. Just first uploader (weak - don't show if org-linked)
  SELECT EXISTS (
    SELECT 1 FROM vehicles
    WHERE id = p_vehicle_id
      AND uploaded_by = p_user_id
      AND (user_id IS NULL OR user_id != p_user_id)
  ) INTO v_is_just_uploader;
  
  -- 7. Discovered vehicle (weak - only show if no org link)
  SELECT EXISTS (
    SELECT 1 FROM discovered_vehicles
    WHERE vehicle_id = p_vehicle_id
      AND user_id = p_user_id
      AND is_active = true
  ) INTO v_is_discovered;
  
  -- Decision logic:
  -- If vehicle is org-linked AND user is just uploader → don't show (belongs to org)
  IF v_has_org_link AND v_is_just_uploader AND NOT v_has_active_contribution THEN
    RETURN false;
  END IF;
  
  -- If user has active contribution → show (they're working on it)
  IF v_has_active_contribution THEN
    RETURN true;
  END IF;
  
  -- If user discovered it and no org link → show (they found it)
  IF v_is_discovered AND NOT v_has_org_link THEN
    RETURN true;
  END IF;
  
  -- If user is just uploader with no org link → show (they discovered it)
  IF v_is_just_uploader AND NOT v_has_org_link THEN
    RETURN true;
  END IF;
  
  -- Default: don't show (no strong claim)
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION should_show_in_user_profile IS 
'Determines if a vehicle should appear in a user''s personal profile based on evidence hierarchy. Only shows vehicles where user has strong claim (title, ownership, org responsibility, active contribution, or discovery without org link).';

-- Step 2: Create optimized get_user_vehicle_relationships with permission_ownerships
CREATE OR REPLACE FUNCTION public.get_user_vehicle_relationships(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
  all_vehicle_ids UUID[];
  image_map JSONB;
BEGIN
  -- Step 1: Collect all vehicle IDs that will be returned
  SELECT ARRAY_AGG(DISTINCT vehicle_id)
  INTO all_vehicle_ids
  FROM (
    -- Vehicles uploaded by user
    SELECT v.id AS vehicle_id
    FROM vehicles v
    WHERE (v.user_id = p_user_id OR v.uploaded_by = p_user_id)
      AND should_show_in_user_profile(v.id, p_user_id) = true
    
    UNION
    
    -- Discovered vehicles
    SELECT v.id AS vehicle_id
    FROM discovered_vehicles dv
    JOIN vehicles v ON v.id = dv.vehicle_id
    WHERE dv.user_id = p_user_id
      AND dv.is_active = true
      AND should_show_in_user_profile(v.id, p_user_id) = true
    
    UNION
    
    -- Verified ownerships
    SELECT ov.vehicle_id AS vehicle_id
    FROM ownership_verifications ov
    WHERE ov.user_id = p_user_id
      AND ov.status = 'approved'
    
    UNION
    
    -- Permission-based ownerships
    SELECT vup.vehicle_id AS vehicle_id
    FROM vehicle_user_permissions vup
    WHERE vup.user_id = p_user_id
      AND vup.is_active = true
      AND vup.role IN ('owner', 'co_owner')
  ) combined;

  -- Step 2: Batch load ALL images for all vehicles in one query
  -- This avoids N+1 query problem (one subquery per vehicle)
  IF all_vehicle_ids IS NOT NULL AND array_length(all_vehicle_ids, 1) > 0 THEN
    SELECT jsonb_object_agg(
      vehicle_id::text,
      image_array
    )
    INTO image_map
    FROM (
      SELECT 
        vehicle_id,
        jsonb_agg(
          jsonb_build_object(
            'image_url', image_url,
            'is_primary', is_primary,
            'variants', variants
          )
        ) as image_array
      FROM vehicle_images
      WHERE vehicle_id = ANY(all_vehicle_ids)
      GROUP BY vehicle_id
    ) grouped;
  END IF;

  -- Default to empty object if no images
  image_map := COALESCE(image_map, '{}'::jsonb);

  -- Step 3: Build the result JSON using the pre-loaded image map
  SELECT json_build_object(
    -- User uploaded vehicles
    'user_added_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle', row_to_json(v.*),
          'images', COALESCE((image_map->v.id::text)::json, '[]'::json)
        )
      ), '[]'::json)
      FROM vehicles v
      WHERE (v.user_id = p_user_id OR v.uploaded_by = p_user_id)
        AND should_show_in_user_profile(v.id, p_user_id) = true
    ),
    
    -- Discovered vehicles with relationships
    'discovered_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'relationship_type', COALESCE(dv.relationship_type, 'interested'),
          'discovery_source', dv.discovery_source,
          'vehicle', row_to_json(v.*),
          'images', COALESCE((image_map->v.id::text)::json, '[]'::json)
        )
      ), '[]'::json)
      FROM discovered_vehicles dv
      JOIN vehicles v ON v.id = dv.vehicle_id
      WHERE dv.user_id = p_user_id
        AND dv.is_active = true
        AND should_show_in_user_profile(v.id, p_user_id) = true
    ),
    
    -- Verified ownerships (always show - strongest claim)
    'verified_ownerships', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle_id', ov.vehicle_id,
          'vehicle', row_to_json(v.*),
          'images', COALESCE((image_map->v.id::text)::json, '[]'::json)
        )
      ), '[]'::json)
      FROM ownership_verifications ov
      JOIN vehicles v ON v.id = ov.vehicle_id
      WHERE ov.user_id = p_user_id
        AND ov.status = 'approved'
    ),
    
    -- Permission-based ownerships (FIX: was missing!)
    'permission_ownerships', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle_id', vup.vehicle_id,
          'role', vup.role,
          'vehicle', row_to_json(v.*),
          'images', COALESCE((image_map->v.id::text)::json, '[]'::json)
        )
      ), '[]'::json)
      FROM vehicle_user_permissions vup
      JOIN vehicles v ON v.id = vup.vehicle_id
      WHERE vup.user_id = p_user_id
        AND vup.is_active = true
        AND vup.role IN ('owner', 'co_owner')
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION public.get_user_vehicle_relationships IS 
'Returns all vehicle relationships for a user in a single optimized query. Uses batch image loading to avoid N+1 queries. Includes permission_ownerships that frontend expects.';

-- Ensure indexes exist for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_id ON vehicle_images(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id ON vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_uploaded_by ON vehicles(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_user_active ON discovered_vehicles(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ownership_verifications_user_status ON ownership_verifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_user_active_role ON vehicle_user_permissions(user_id, is_active, role) WHERE is_active = true AND role IN ('owner', 'co_owner');

