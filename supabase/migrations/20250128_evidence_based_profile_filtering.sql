-- Evidence-Based Profile Filtering
-- Purpose: Only show vehicles in user profiles where they have a strong claim
-- Problem: First user has 100 vehicles because they're uploaded_by, but many shouldn't be there
-- Solution: Filter based on evidence hierarchy (title > ownership > org responsibility > active contribution > discovery)

-- Function to determine if vehicle should show in user's personal profile
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

-- Update get_user_vehicle_relationships to use evidence-based filtering
CREATE OR REPLACE FUNCTION public.get_user_vehicle_relationships(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    -- User uploaded vehicles (only if they should be in profile)
    'user_added_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle', row_to_json(v.*),
          'images', (
            SELECT COALESCE(json_agg(
              json_build_object(
                'image_url', vi.image_url,
                'is_primary', vi.is_primary,
                'variants', vi.variants
              )
            ), '[]'::json)
            FROM vehicle_images vi
            WHERE vi.vehicle_id = v.id
          )
        )
      ), '[]'::json)
      FROM vehicles v
      WHERE (v.user_id = p_user_id OR v.uploaded_by = p_user_id)
        AND should_show_in_user_profile(v.id, p_user_id) = true
    ),
    
    -- Discovered vehicles with relationships (only if they should be in profile)
    'discovered_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'relationship_type', COALESCE(dv.relationship_type, 'interested'),
          'vehicle', row_to_json(v.*),
          'images', (
            SELECT COALESCE(json_agg(
              json_build_object(
                'image_url', vi.image_url,
                'is_primary', vi.is_primary,
                'variants', vi.variants
              )
            ), '[]'::json)
            FROM vehicle_images vi
            WHERE vi.vehicle_id = v.id
          )
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
          'images', (
            SELECT COALESCE(json_agg(
              json_build_object(
                'image_url', vi.image_url,
                'is_primary', vi.is_primary,
                'variants', vi.variants
              )
            ), '[]'::json)
            FROM vehicle_images vi
            WHERE vi.vehicle_id = v.id
          )
        )
      ), '[]'::json)
      FROM ownership_verifications ov
      JOIN vehicles v ON v.id = ov.vehicle_id
      WHERE ov.user_id = p_user_id
        AND ov.status = 'approved'
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION public.get_user_vehicle_relationships IS 
'Returns all vehicle relationships for a user, filtered by evidence-based profile filtering. Only shows vehicles where user has strong claim (title, ownership, org responsibility, active contribution, or discovery without org link).';

