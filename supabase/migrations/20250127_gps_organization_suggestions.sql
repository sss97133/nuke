-- GPS-Based Organization Suggestions
-- Function to find suggested organizations for vehicles based on GPS coordinates

CREATE OR REPLACE FUNCTION find_suggested_organizations_for_vehicle(
  p_vehicle_id UUID,
  p_max_distance_meters INTEGER DEFAULT 500
)
RETURNS TABLE (
  organization_id UUID,
  business_name TEXT,
  distance_meters NUMERIC,
  confidence_score NUMERIC,
  image_count INTEGER,
  relationship_type TEXT
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  vehicle_coords RECORD;
BEGIN
  -- Get all GPS coordinates from vehicle images
  FOR vehicle_coords IN
    SELECT DISTINCT
      latitude,
      longitude
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
  LOOP
    -- Find nearby organizations for each coordinate
    RETURN QUERY
    SELECT 
      b.id AS organization_id,
      b.business_name,
      ST_Distance(
        ST_MakePoint(b.longitude, b.latitude)::geography,
        ST_MakePoint(vehicle_coords.longitude, vehicle_coords.latitude)::geography
      ) AS distance_meters,
      GREATEST(0, LEAST(100, (1 - (ST_Distance(
        ST_MakePoint(b.longitude, b.latitude)::geography,
        ST_MakePoint(vehicle_coords.longitude, vehicle_coords.latitude)::geography
      ) / p_max_distance_meters::NUMERIC)) * 100)) AS confidence_score,
      (
        SELECT COUNT(*)
        FROM vehicle_images vi
        WHERE vi.vehicle_id = p_vehicle_id
          AND vi.latitude IS NOT NULL
          AND vi.longitude IS NOT NULL
          AND ST_DWithin(
            ST_MakePoint(b.longitude, b.latitude)::geography,
            ST_MakePoint(vi.longitude, vi.latitude)::geography,
            p_max_distance_meters
          )
      ) AS image_count,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM organization_contributors oc
          WHERE oc.organization_id = b.id
            AND oc.user_id = (SELECT user_id FROM vehicles WHERE id = p_vehicle_id LIMIT 1)
            AND oc.status = 'active'
        ) THEN 'work_location'
        ELSE 'service_provider'
      END AS relationship_type
    FROM businesses b
    WHERE b.latitude IS NOT NULL
      AND b.longitude IS NOT NULL
      AND ST_DWithin(
        ST_MakePoint(b.longitude, b.latitude)::geography,
        ST_MakePoint(vehicle_coords.longitude, vehicle_coords.latitude)::geography,
        p_max_distance_meters
      )
    ORDER BY distance_meters ASC;
  END LOOP;
  
  -- Deduplicate and aggregate results
  RETURN QUERY
  SELECT DISTINCT ON (organization_id)
    organization_id,
    business_name,
    MIN(distance_meters) OVER (PARTITION BY organization_id) AS distance_meters,
    MAX(confidence_score) OVER (PARTITION BY organization_id) AS confidence_score,
    SUM(image_count) OVER (PARTITION BY organization_id) AS image_count,
    relationship_type
  FROM (
    SELECT 
      b.id AS organization_id,
      b.business_name,
      ST_Distance(
        ST_MakePoint(b.longitude, b.latitude)::geography,
        ST_MakePoint(vi.longitude, vi.latitude)::geography
      ) AS distance_meters,
      GREATEST(0, LEAST(100, (1 - (ST_Distance(
        ST_MakePoint(b.longitude, b.latitude)::geography,
        ST_MakePoint(vi.longitude, vi.latitude)::geography
      ) / p_max_distance_meters::NUMERIC)) * 100)) AS confidence_score,
      1 AS image_count,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM organization_contributors oc
          WHERE oc.organization_id = b.id
            AND oc.user_id = (SELECT user_id FROM vehicles WHERE id = p_vehicle_id LIMIT 1)
            AND oc.status = 'active'
        ) THEN 'work_location'
        ELSE 'service_provider'
      END AS relationship_type
    FROM vehicle_images vi
    CROSS JOIN businesses b
    WHERE vi.vehicle_id = p_vehicle_id
      AND vi.latitude IS NOT NULL
      AND vi.longitude IS NOT NULL
      AND b.latitude IS NOT NULL
      AND b.longitude IS NOT NULL
      AND ST_DWithin(
        ST_MakePoint(b.longitude, b.latitude)::geography,
        ST_MakePoint(vi.longitude, vi.latitude)::geography,
        p_max_distance_meters
      )
  ) subquery
  ORDER BY organization_id, distance_meters ASC;
END;
$$;

COMMENT ON FUNCTION find_suggested_organizations_for_vehicle IS 
'Finds organizations near vehicle GPS coordinates. Returns suggested organizations with distance, confidence, and image count.';

-- Function to bulk assign vehicles to organizations based on GPS
CREATE OR REPLACE FUNCTION bulk_assign_vehicles_to_orgs_by_gps(
  p_vehicle_ids UUID[],
  p_user_id UUID,
  p_max_distance_meters INTEGER DEFAULT 500,
  p_min_confidence INTEGER DEFAULT 50
)
RETURNS TABLE (
  vehicle_id UUID,
  organization_id UUID,
  business_name TEXT,
  assigned BOOLEAN,
  reason TEXT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle_id UUID;
  v_suggestion RECORD;
  v_assigned BOOLEAN;
BEGIN
  FOREACH v_vehicle_id IN ARRAY p_vehicle_ids
  LOOP
    -- Find best match for this vehicle
    SELECT * INTO v_suggestion
    FROM find_suggested_organizations_for_vehicle(v_vehicle_id, p_max_distance_meters)
    WHERE confidence_score >= p_min_confidence
    ORDER BY confidence_score DESC, distance_meters ASC
    LIMIT 1;
    
    IF v_suggestion.organization_id IS NOT NULL THEN
      -- Assign vehicle to organization
      INSERT INTO organization_vehicles (
        organization_id,
        vehicle_id,
        relationship_type,
        auto_tagged,
        gps_match_confidence,
        linked_by_user_id
      )
      VALUES (
        v_suggestion.organization_id,
        v_vehicle_id,
        v_suggestion.relationship_type,
        true,
        v_suggestion.confidence_score,
        p_user_id
      )
      ON CONFLICT (organization_id, vehicle_id, relationship_type)
      DO UPDATE SET
        gps_match_confidence = GREATEST(
          organization_vehicles.gps_match_confidence,
          v_suggestion.confidence_score
        ),
        auto_tagged = true,
        updated_at = NOW();
      
      v_assigned := true;
      
      RETURN QUERY SELECT
        v_vehicle_id,
        v_suggestion.organization_id,
        v_suggestion.business_name,
        v_assigned,
        format('Assigned to %s (%.0f%% confidence, %.0fm away)', 
          v_suggestion.business_name, 
          v_suggestion.confidence_score,
          v_suggestion.distance_meters)::TEXT;
    ELSE
      RETURN QUERY SELECT
        v_vehicle_id,
        NULL::UUID,
        NULL::TEXT,
        false,
        'No nearby organizations found'::TEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION bulk_assign_vehicles_to_orgs_by_gps IS 
'Bulk assigns vehicles to organizations based on GPS coordinates. Returns assignment results.';

