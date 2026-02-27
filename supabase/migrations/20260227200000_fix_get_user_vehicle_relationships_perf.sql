-- Fix: get_user_vehicle_relationships — eliminate per-row should_show_in_user_profile() calls
--
-- Root cause: should_show_in_user_profile(v.id, p_user_id) was being called once per
-- vehicle row, each time executing 7 sequential queries. With 250 vehicles = 1,750+ queries
-- → 2-minute statement timeout for any user with a real collection.
--
-- Fix: replace per-row function calls with set-based CTEs. The visibility logic is
-- simplified to: "show everything the user uploaded or is related to" — this is a
-- personal garage view, not a public profile filter.

CREATE OR REPLACE FUNCTION public.get_user_vehicle_relationships(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result JSON;
  all_vehicle_ids UUID[];
  image_map JSONB;
BEGIN
  -- Step 1: Collect all relevant vehicle IDs in one set-based query (no per-row calls)
  SELECT ARRAY_AGG(DISTINCT vehicle_id)
  INTO all_vehicle_ids
  FROM (
    SELECT v.id AS vehicle_id
    FROM vehicles v
    WHERE v.user_id = p_user_id OR v.uploaded_by = p_user_id
    UNION
    SELECT dv.vehicle_id
    FROM discovered_vehicles dv
    WHERE dv.user_id = p_user_id AND dv.is_active = true
    UNION
    SELECT ov.vehicle_id
    FROM ownership_verifications ov
    WHERE ov.user_id = p_user_id AND ov.status = 'approved'
    UNION
    SELECT vup.vehicle_id
    FROM vehicle_user_permissions vup
    WHERE vup.user_id = p_user_id
      AND COALESCE(vup.is_active, true) = true
      AND vup.role IN ('owner', 'co_owner')
  ) combined;

  IF all_vehicle_ids IS NULL OR array_length(all_vehicle_ids, 1) = 0 THEN
    RETURN json_build_object(
      'user_added_vehicles', '[]'::json,
      'discovered_vehicles', '[]'::json,
      'verified_ownerships', '[]'::json,
      'permission_ownerships', '[]'::json
    );
  END IF;

  -- Step 2: Batch load ALL images in one query (limit to 1 image per vehicle for perf)
  SELECT jsonb_object_agg(vehicle_id::text, image_array)
  INTO image_map
  FROM (
    SELECT
      vehicle_id,
      jsonb_agg(
        jsonb_build_object(
          'image_url', image_url,
          'is_primary', is_primary,
          'variants', variants
        ) ORDER BY is_primary DESC NULLS LAST
      ) AS image_array
    FROM vehicle_images
    WHERE vehicle_id = ANY(all_vehicle_ids)
    GROUP BY vehicle_id
  ) grouped;

  image_map := COALESCE(image_map, '{}'::jsonb);

  -- Step 3: Build result JSON — all filters are set-based (no per-row function calls)
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
      WHERE dv.user_id = p_user_id AND dv.is_active = true
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
      WHERE ov.user_id = p_user_id AND ov.status = 'approved'
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
END;
$$;
