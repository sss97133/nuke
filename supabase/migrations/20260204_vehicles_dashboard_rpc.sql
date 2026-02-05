-- Vehicles Dashboard RPC Functions
-- Producer-focused dashboard - lightweight version for performance
-- Focused on owned/verified vehicles only (no client work scan initially)

DROP FUNCTION IF EXISTS get_user_vehicles_dashboard(UUID);

-- Main Dashboard RPC - Performance-optimized version
-- Only fetches owned vehicles - client work done separately
CREATE OR REPLACE FUNCTION get_user_vehicles_dashboard(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  my_vehicles_json JSONB;
  business_fleets_json JSONB;
BEGIN
  -- My vehicles: owned or verified (using existing indexes)
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
      'interaction_score', 0,
      'last_activity_date', NULL,
      'event_count', 0,
      'image_count', 0
    ) as row_data,
    COALESCE(ov.created_at, vup.created_at, v.created_at) as acquisition_date
    FROM vehicles v
    LEFT JOIN ownership_verifications ov ON ov.vehicle_id = v.id
      AND ov.user_id = p_user_id AND ov.status = 'approved'
    LEFT JOIN vehicle_user_permissions vup ON vup.vehicle_id = v.id
      AND vup.user_id = p_user_id AND vup.is_active = true
      AND vup.role IN ('owner', 'co_owner')
    WHERE ov.id IS NOT NULL OR vup.id IS NOT NULL
    LIMIT 100
  ) sub;

  -- Business fleets (limit 10 businesses)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'business_id', b.id,
      'business_name', b.business_name,
      'vehicle_count', (
        SELECT COUNT(*) FROM business_vehicle_fleet bvf
        WHERE bvf.business_id = b.id AND bvf.status = 'active'
      ),
      'vehicles', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'vehicle_id', v.id,
            'year', v.year,
            'make', v.make,
            'model', v.model,
            'fleet_role', bvf.fleet_role,
            'confidence_score', (
              (CASE WHEN v.vin IS NOT NULL AND LENGTH(TRIM(v.vin)) >= 11 THEN 15 ELSE 0 END) +
              (CASE WHEN v.year IS NOT NULL THEN 5 ELSE 0 END) +
              (CASE WHEN v.make IS NOT NULL THEN 5 ELSE 0 END) +
              (CASE WHEN v.model IS NOT NULL THEN 5 ELSE 0 END) +
              (CASE WHEN v.mileage IS NOT NULL THEN 5 ELSE 0 END) +
              (CASE WHEN v.color IS NOT NULL THEN 5 ELSE 0 END)
            ),
            'interaction_score', 0
          )
        ), '[]'::jsonb)
        FROM business_vehicle_fleet bvf
        JOIN vehicles v ON v.id = bvf.vehicle_id
        WHERE bvf.business_id = b.id AND bvf.status = 'active'
        LIMIT 50
      )
    )
  ), '[]'::jsonb)
  INTO business_fleets_json
  FROM businesses b
  WHERE EXISTS (
    SELECT 1 FROM business_user_roles bur
    WHERE bur.business_id = b.id AND bur.user_id = p_user_id AND bur.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM business_ownership bo
    WHERE bo.business_id = b.id AND bo.owner_id = p_user_id AND bo.status = 'active'
  )
  LIMIT 10;

  result := jsonb_build_object(
    'my_vehicles', my_vehicles_json,
    'client_vehicles', '[]'::jsonb,
    'business_fleets', business_fleets_json,
    'summary', jsonb_build_object(
      'total_my_vehicles', jsonb_array_length(my_vehicles_json),
      'total_client_vehicles', 0,
      'total_business_vehicles', (
        SELECT COALESCE(SUM((elem->>'vehicle_count')::int), 0)
        FROM jsonb_array_elements(business_fleets_json) elem
      ),
      'recent_activity_30d', 0
    )
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION get_user_vehicles_dashboard(UUID) TO authenticated;
