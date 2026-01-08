-- Optimize get_user_vehicle_relationships RPC function
-- Fix: Add missing permission_ownerships field that frontend expects
-- Performance: Batch load images instead of nested subqueries per vehicle
-- Created: January 31, 2025

CREATE OR REPLACE FUNCTION public.get_user_vehicle_relationships(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
  all_vehicle_ids UUID[];
  image_map JSONB;
BEGIN
  -- Step 1: Collect all vehicle IDs that will be returned
  SELECT ARRAY_AGG(DISTINCT v.id)
  INTO all_vehicle_ids
  FROM (
    -- Vehicles uploaded by user
    SELECT v.id
    FROM vehicles v
    WHERE (v.user_id = p_user_id OR v.uploaded_by = p_user_id)
      AND should_show_in_user_profile(v.id, p_user_id) = true
    
    UNION
    
    -- Discovered vehicles
    SELECT v.id
    FROM discovered_vehicles dv
    JOIN vehicles v ON v.id = dv.vehicle_id
    WHERE dv.user_id = p_user_id
      AND dv.is_active = true
      AND should_show_in_user_profile(v.id, p_user_id) = true
    
    UNION
    
    -- Verified ownerships
    SELECT ov.vehicle_id
    FROM ownership_verifications ov
    WHERE ov.user_id = p_user_id
      AND ov.status = 'approved'
    
    UNION
    
    -- Permission-based ownerships
    SELECT vup.vehicle_id
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
          'images', COALESCE(image_map->v.id::text, '[]'::json)
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
          'images', COALESCE(image_map->v.id::text, '[]'::json)
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
          'images', COALESCE(image_map->v.id::text, '[]'::json)
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
          'images', COALESCE(image_map->v.id::text, '[]'::json)
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

