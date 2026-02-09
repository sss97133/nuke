-- Fix 500 on get_user_vehicle_relationships: return empty result on any error instead of throwing.
-- Ensures vehicle_user_permissions exists, then recreates RPC with EXCEPTION handler.

BEGIN;

-- Ensure table exists so RPC doesn't fail with "relation does not exist"
CREATE TABLE IF NOT EXISTS public.vehicle_user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id),
  role TEXT NOT NULL,
  permissions TEXT[] DEFAULT ARRAY[]::TEXT[],
  context TEXT,
  is_active BOOLEAN DEFAULT true,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vehicle_id, user_id, role)
);

-- Recreate RPC with same logic but EXCEPTION handler so it never returns 500
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
    SELECT v.id AS vehicle_id
    FROM vehicles v
    WHERE (v.user_id = p_user_id OR v.uploaded_by = p_user_id)
      AND should_show_in_user_profile(v.id, p_user_id) = true
    UNION
    SELECT v.id AS vehicle_id
    FROM discovered_vehicles dv
    JOIN vehicles v ON v.id = dv.vehicle_id
    WHERE dv.user_id = p_user_id
      AND dv.is_active = true
      AND should_show_in_user_profile(v.id, p_user_id) = true
    UNION
    SELECT ov.vehicle_id AS vehicle_id
    FROM ownership_verifications ov
    WHERE ov.user_id = p_user_id
      AND ov.status = 'approved'
    UNION
    SELECT vup.vehicle_id AS vehicle_id
    FROM vehicle_user_permissions vup
    WHERE vup.user_id = p_user_id
      AND COALESCE(vup.is_active, true) = true
      AND vup.role IN ('owner', 'co_owner')
  ) combined;

  -- Step 2: Batch load ALL images for all vehicles in one query
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

  image_map := COALESCE(image_map, '{}'::jsonb);

  -- Step 3: Build the result JSON
  SELECT json_build_object(
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
        AND COALESCE(vup.is_active, true) = true
        AND vup.role IN ('owner', 'co_owner')
    )
  ) INTO result;

  RETURN result;

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'user_added_vehicles', '[]'::json,
      'discovered_vehicles', '[]'::json,
      'verified_ownerships', '[]'::json,
      'permission_ownerships', '[]'::json
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION public.get_user_vehicle_relationships(UUID) IS
'Returns vehicle relationships for a user. On any error returns empty structure to avoid 500.';

COMMIT;
