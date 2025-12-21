-- RPC Function for User Vehicle Relationships
-- Optimized single-query approach that avoids PostgREST relationship ambiguity
-- Replaces nested queries that break when multiple FKs exist (e.g., vehicle_id + suggested_vehicle_id)
-- Created: January 25, 2025

CREATE OR REPLACE FUNCTION public.get_user_vehicle_relationships(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    -- User uploaded vehicles (user_id or uploaded_by matches)
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
    ),
    
    -- Discovered vehicles with relationships (user-specific + public scraper vehicles)
    'discovered_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'relationship_type', COALESCE(dv.relationship_type, 'interested'),
          'discovery_source', v.discovery_source,
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
      FROM (
        -- User-specific discovered vehicles
        SELECT DISTINCT v.id, COALESCE(dv.relationship_type, 'interested') as relationship_type
        FROM discovered_vehicles dv
        JOIN vehicles v ON v.id = dv.vehicle_id
        WHERE dv.user_id = p_user_id
          AND dv.is_active = true
        
        UNION
        
        -- Public scraper vehicles (Mecum, Barrett-Jackson, etc.) - visible to all users
        SELECT DISTINCT v.id, 'interested' as relationship_type
        FROM vehicles v
        WHERE v.profile_origin = 'url_scraper'
          AND v.discovery_source LIKE '%agent_extraction%'
          AND v.is_public = true
          AND v.id NOT IN (
            SELECT vehicle_id FROM discovered_vehicles WHERE user_id = p_user_id
          )
      ) combined
      JOIN vehicles v ON v.id = combined.id
    ),
    
    -- Verified ownerships
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

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_vehicle_relationships(UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.get_user_vehicle_relationships IS 
'Returns all vehicle relationships for a user in a single optimized query. Avoids PostgREST relationship ambiguity issues by using explicit JOINs instead of nested selects.';

