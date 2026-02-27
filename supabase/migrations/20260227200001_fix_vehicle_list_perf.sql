-- Fix: vehicle/list page performance
--
-- Problems found:
-- 1. vehicles.user_id has no index (3 duplicate indexes on uploaded_by, zero on user_id)
-- 2. get_user_vehicle_relationships builds an image_map from 19,451 vehicle_images rows
--    even though vehicles.primary_image_url already has the primary image URL
-- 3. get_user_vehicles_dashboard has a LATERAL image count per vehicle + COALESCE(is_public,true)
--    which prevents index use
--
-- Fix: add user_id index + rewrite both functions to use primary_image_url directly

-- 1. Add missing index on vehicles.user_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_user_id_auth
  ON vehicles (user_id);

-- 2. get_user_vehicle_relationships: use primary_image_url, skip image_map entirely
CREATE OR REPLACE FUNCTION public.get_user_vehicle_relationships(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'user_added_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'user_id', v.user_id,
            'uploaded_by', v.uploaded_by, 'discovery_url', v.discovery_url,
            'discovery_source', v.discovery_source, 'profile_origin', v.profile_origin,
            'status', v.status, 'is_public', v.is_public,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url,
              'is_primary', true,
              'variants', NULL
            ))
            ELSE '[]'::json
          END
        )
        ORDER BY v.created_at DESC
      ), '[]'::json)
      FROM vehicles v
      WHERE v.user_id = p_user_id OR v.uploaded_by = p_user_id
    ),
    'discovered_vehicles', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'relationship_type', COALESCE(dv.relationship_type, 'interested'),
          'discovery_source', dv.discovery_source,
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'status', v.status, 'is_public', v.is_public,
            'discovery_url', v.discovery_url, 'discovery_source', v.discovery_source,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url, 'is_primary', true, 'variants', NULL
            ))
            ELSE '[]'::json
          END
        )
        ORDER BY v.created_at DESC
      ), '[]'::json)
      FROM discovered_vehicles dv
      JOIN vehicles v ON v.id = dv.vehicle_id
      WHERE dv.user_id = p_user_id AND dv.is_active = true
    ),
    'verified_ownerships', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'vehicle_id', ov.vehicle_id,
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'status', v.status, 'is_public', v.is_public,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url, 'is_primary', true, 'variants', NULL
            ))
            ELSE '[]'::json
          END
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
          'vehicle', json_build_object(
            'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model,
            'vin', v.vin, 'color', v.color, 'mileage', v.mileage,
            'created_at', v.created_at, 'status', v.status, 'is_public', v.is_public,
            'primary_image_url', v.primary_image_url
          ),
          'images', CASE
            WHEN v.primary_image_url IS NOT NULL
            THEN json_build_array(json_build_object(
              'image_url', v.primary_image_url, 'is_primary', true, 'variants', NULL
            ))
            ELSE '[]'::json
          END
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

-- 3. get_user_vehicles_dashboard: replace LATERAL image count with primary_image_url,
--    fix COALESCE(is_public, true) anti-pattern
CREATE OR REPLACE FUNCTION public.get_user_vehicles_dashboard(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result JSONB;
  my_vehicles_json JSONB;
  public_vehicles_json JSONB;
  business_fleets_json JSONB;
BEGIN
  -- My vehicles: owned or permission-based
  SELECT COALESCE(jsonb_agg(row_data ORDER BY acquisition_date DESC), '[]'::jsonb)
  INTO my_vehicles_json
  FROM (
    SELECT jsonb_build_object(
      'vehicle_id', v.id,
      'year', v.year,
      'make', v.make,
      'model', v.model,
      'vin', v.vin,
      'acquisition_date', COALESCE(ov.created_at, vup.created_at, v.created_at),
      'ownership_role', COALESCE(
        CASE WHEN ov.id IS NOT NULL THEN 'verified_owner' ELSE NULL END,
        vup.role,
        'owner'
      ),
      'current_value', v.current_value,
      'purchase_price', v.purchase_price,
      'confidence_score', (
        (CASE WHEN v.vin IS NOT NULL AND LENGTH(TRIM(v.vin)) >= 11 THEN 15 ELSE 0 END) +
        (CASE WHEN v.year IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.make IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.model IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.mileage IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.color IS NOT NULL THEN 5 ELSE 0 END)
      ),
      'image_count', 0,
      'primary_image_url', v.primary_image_url
    ) AS row_data,
    COALESCE(ov.created_at, vup.created_at, v.created_at) AS acquisition_date
    FROM vehicles v
    LEFT JOIN ownership_verifications ov
      ON ov.vehicle_id = v.id AND ov.user_id = p_user_id AND ov.status = 'approved'
    LEFT JOIN vehicle_user_permissions vup
      ON vup.vehicle_id = v.id AND vup.user_id = p_user_id
      AND COALESCE(vup.is_active, true) = true AND vup.role IN ('owner', 'co_owner')
    WHERE ov.id IS NOT NULL OR vup.id IS NOT NULL
    LIMIT 100
  ) sub;

  -- Public vehicles: use is_public index, avoid COALESCE anti-pattern
  SELECT COALESCE(jsonb_agg(row_data ORDER BY v_created DESC), '[]'::jsonb)
  INTO public_vehicles_json
  FROM (
    SELECT jsonb_build_object(
      'vehicle_id', v.id,
      'year', v.year,
      'make', v.make,
      'model', v.model,
      'current_value', v.current_value,
      'primary_image_url', v.primary_image_url
    ) AS row_data,
    v.created_at AS v_created
    FROM vehicles v
    WHERE (v.is_public = true OR v.is_public IS NULL)
    ORDER BY v.created_at DESC
    LIMIT 50
  ) sub;

  -- Business fleets (simple — no vehicle image joins)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'business_id', b.id,
    'business_name', b.name
  )), '[]'::jsonb)
  INTO business_fleets_json
  FROM businesses b
  WHERE EXISTS (
    SELECT 1 FROM business_user_roles bur
    WHERE bur.business_id = b.id AND bur.user_id = p_user_id AND bur.is_active = true
  )
  LIMIT 10;

  result := jsonb_build_object(
    'my_vehicles', COALESCE(my_vehicles_json, '[]'::jsonb),
    'public_vehicles', COALESCE(public_vehicles_json, '[]'::jsonb),
    'client_vehicles', '[]'::jsonb,
    'business_fleets', COALESCE(business_fleets_json, '[]'::jsonb),
    'summary', jsonb_build_object(
      'total_my_vehicles', jsonb_array_length(COALESCE(my_vehicles_json, '[]'::jsonb)),
      'total_public_vehicles', jsonb_array_length(COALESCE(public_vehicles_json, '[]'::jsonb)),
      'total_client_vehicles', 0,
      'total_business_vehicles', 0,
      'recent_activity_30d', 0
    )
  );

  RETURN result;
END;
$$;
