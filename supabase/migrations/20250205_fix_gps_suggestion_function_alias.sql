-- Fix GPS Organization Suggestions Function Alias
-- The frontend is calling find_suggested_organizations_by_distance_meters
-- but the actual function is find_suggested_organizations_for_vehicle
-- Create an alias function to maintain compatibility

CREATE OR REPLACE FUNCTION find_suggested_organizations_by_distance_meters(
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
BEGIN
  -- Simply call the existing function with the same parameters
  RETURN QUERY
  SELECT * FROM find_suggested_organizations_for_vehicle(
    p_vehicle_id,
    p_max_distance_meters
  );
END;
$$;

COMMENT ON FUNCTION find_suggested_organizations_by_distance_meters IS 
'Alias function for find_suggested_organizations_for_vehicle. Maintains backward compatibility with frontend code.';

-- Also create the function mentioned in the error hint if it doesn't exist
CREATE OR REPLACE FUNCTION find_gps_organization_matches(
  p_vehicle_id UUID,
  p_timeline_event_id UUID DEFAULT NULL,
  p_max_distance_meters INTEGER DEFAULT 100
)
RETURNS TABLE (
  organization_id UUID,
  organization_name TEXT,
  distance_meters NUMERIC,
  confidence_score NUMERIC
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Use the existing function but return simplified results
  RETURN QUERY
  SELECT 
    s.organization_id,
    s.business_name AS organization_name,
    s.distance_meters,
    s.confidence_score
  FROM find_suggested_organizations_for_vehicle(
    p_vehicle_id,
    p_max_distance_meters
  ) s
  ORDER BY s.distance_meters ASC;
END;
$$;

COMMENT ON FUNCTION find_gps_organization_matches IS 
'Simplified GPS organization matching function. Returns basic match information for timeline events.';

