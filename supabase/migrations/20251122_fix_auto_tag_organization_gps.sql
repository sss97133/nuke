-- Fix auto_tag_organization_from_gps to handle both vehicle_images and organization_images
-- Issue: Function tries to access NEW.vehicle_id even when triggered from organization_images table

CREATE OR REPLACE FUNCTION auto_tag_organization_from_gps()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  nearby_org RECORD;
  distance_km NUMERIC;
  target_vehicle_id UUID;
BEGIN
  -- Only process if image has GPS
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    
    -- Determine vehicle_id based on the table
    IF TG_TABLE_NAME = 'vehicle_images' THEN
      target_vehicle_id := NEW.vehicle_id;
    ELSIF TG_TABLE_NAME = 'organization_images' THEN
      -- Organization images don't have vehicle_id, skip vehicle linking
      target_vehicle_id := NULL;
    END IF;
    
    -- Only link vehicle if we have a vehicle_id
    IF target_vehicle_id IS NOT NULL THEN
      -- Find orgs within 500m (0.5km)
      FOR nearby_org IN
        SELECT 
          id,
          business_name,
          latitude,
          longitude,
          ST_Distance(
            ST_MakePoint(longitude, latitude)::geography,
            ST_MakePoint(NEW.longitude, NEW.latitude)::geography
          ) / 1000.0 AS dist_km
        FROM businesses
        WHERE latitude IS NOT NULL 
          AND longitude IS NOT NULL
          AND ST_DWithin(
            ST_MakePoint(longitude, latitude)::geography,
            ST_MakePoint(NEW.longitude, NEW.latitude)::geography,
            500  -- 500 meters
          )
        ORDER BY dist_km ASC
        LIMIT 1
      LOOP
        
        -- Create/update org-vehicle link
        INSERT INTO organization_vehicles (
          organization_id,
          vehicle_id,
          relationship_type,
          auto_tagged,
          gps_match_confidence,
          linked_by_user_id
        )
        VALUES (
          nearby_org.id,
          target_vehicle_id,
          'work_location',
          true,
          GREATEST(0, LEAST(100, (1 - (nearby_org.dist_km / 0.5)) * 100)),
          NEW.user_id
        )
        ON CONFLICT (organization_id, vehicle_id, relationship_type) 
        DO UPDATE SET
          gps_match_confidence = GREATEST(
            organization_vehicles.gps_match_confidence,
            GREATEST(0, LEAST(100, (1 - (nearby_org.dist_km / 0.5)) * 100))
          ),
          auto_tagged = true,
          updated_at = NOW();
        
      END LOOP;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_tag_organization_from_gps IS 
'Automatically links nearby organizations to vehicles based on GPS coordinates. 
Handles both vehicle_images and organization_images tables.';

