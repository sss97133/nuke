-- ============================================================================
-- AUTO-MATCH IMAGES TO VEHICLES
-- ============================================================================
-- 
-- Enables automatic matching of unorganized images to vehicles based on:
-- - GPS coordinate proximity (images taken at same/similar locations)
-- - Date proximity (images taken around same time)
-- - Filename patterns
--
-- ============================================================================

-- Function: Find images near a location for a specific vehicle
CREATE OR REPLACE FUNCTION find_images_near_location(
  p_latitude DECIMAL,
  p_longitude DECIMAL,
  p_vehicle_id UUID,
  p_max_distance_meters INTEGER DEFAULT 50
)
RETURNS TABLE (
  image_id UUID,
  distance_meters NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vi.id AS image_id,
    ROUND(
      ST_Distance(
        ST_MakePoint(vi.longitude, vi.latitude)::geography,
        ST_MakePoint(p_longitude, p_latitude)::geography
      )::NUMERIC,
      2
    ) AS distance_meters
  FROM vehicle_images vi
  WHERE vi.vehicle_id = p_vehicle_id
    AND vi.latitude IS NOT NULL
    AND vi.longitude IS NOT NULL
    AND ST_DWithin(
      ST_MakePoint(vi.longitude, vi.latitude)::geography,
      ST_MakePoint(p_longitude, p_latitude)::geography,
      p_max_distance_meters
    )
  ORDER BY distance_meters ASC;
END;
$$ LANGUAGE plpgsql;

-- Function: Auto-match unorganized image to vehicles
CREATE OR REPLACE FUNCTION auto_match_image_to_vehicles(
  p_image_id UUID,
  p_max_gps_distance_meters INTEGER DEFAULT 50,
  p_max_date_difference_days INTEGER DEFAULT 30,
  p_min_confidence REAL DEFAULT 0.5
)
RETURNS TABLE (
  vehicle_id UUID,
  confidence REAL,
  match_reasons TEXT[]
) AS $$
DECLARE
  v_image RECORD;
  v_vehicle RECORD;
  v_score REAL;
  v_reasons TEXT[];
  v_gps_score REAL;
  v_date_score REAL;
  v_filename_score REAL;
  v_nearby_count INTEGER;
  v_min_distance NUMERIC;
  v_date_diff_days NUMERIC;
BEGIN
  -- Get the unorganized image
  SELECT 
    id, filename, latitude, longitude, taken_at, user_id, exif_data
  INTO v_image
  FROM vehicle_images
  WHERE id = p_image_id
    AND vehicle_id IS NULL
    AND organization_status = 'unorganized';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Loop through user's vehicles
  FOR v_vehicle IN
    SELECT id, year, make, model, user_id
    FROM vehicles
    WHERE user_id = v_image.user_id
  LOOP
    v_score := 0;
    v_reasons := ARRAY[]::TEXT[];

    -- 1. GPS Location Match (40% weight)
    IF v_image.latitude IS NOT NULL AND v_image.longitude IS NOT NULL THEN
      -- Count nearby images
      SELECT COUNT(*), MIN(distance_meters)
      INTO v_nearby_count, v_min_distance
      FROM find_images_near_location(
        v_image.latitude,
        v_image.longitude,
        v_vehicle.id,
        p_max_gps_distance_meters
      );

      IF v_nearby_count > 0 THEN
        -- Score decreases with distance, increases with count
        v_gps_score := GREATEST(0, 1 - (COALESCE(v_min_distance, 0) / p_max_gps_distance_meters::REAL));
        v_gps_score := v_gps_score * 0.5 + (LEAST(v_nearby_count::REAL / 10, 1) * 0.5);
        v_score := v_score + (v_gps_score * 0.4);
        v_reasons := array_append(v_reasons, 
          format('GPS match: %s%% (within %sm, %s nearby images)', 
            ROUND(v_gps_score * 100)::TEXT,
            p_max_gps_distance_meters::TEXT,
            v_nearby_count::TEXT
          )
        );
      END IF;
    END IF;

    -- 2. Date Proximity Match (30% weight)
    IF v_image.taken_at IS NOT NULL THEN
      SELECT 
        MIN(EXTRACT(EPOCH FROM (taken_at - v_image.taken_at)) / 86400)
      INTO v_date_diff_days
      FROM vehicle_images
      WHERE vehicle_id = v_vehicle.id
        AND taken_at IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (taken_at - v_image.taken_at)) / 86400) <= p_max_date_difference_days;

      IF v_date_diff_days IS NOT NULL THEN
        v_date_score := GREATEST(0, 1 - (ABS(v_date_diff_days) / p_max_date_difference_days::REAL));
        v_score := v_score + (v_date_score * 0.3);
        v_reasons := array_append(v_reasons,
          format('Date match: %s%% (within %s days)', 
            ROUND(v_date_score * 100)::TEXT,
            p_max_date_difference_days::TEXT
          )
        );
      END IF;
    END IF;

    -- 3. Filename Pattern Match (20% weight)
    IF v_image.filename IS NOT NULL THEN
      v_filename_score := 0;
      
      -- Check for year
      IF v_vehicle.year IS NOT NULL AND 
         LOWER(v_image.filename) LIKE '%' || v_vehicle.year::TEXT || '%' THEN
        v_filename_score := v_filename_score + 0.3;
      END IF;

      -- Check for make
      IF v_vehicle.make IS NOT NULL AND 
         LOWER(v_image.filename) LIKE '%' || LOWER(v_vehicle.make) || '%' THEN
        v_filename_score := v_filename_score + 0.3;
      END IF;

      -- Check for model
      IF v_vehicle.model IS NOT NULL AND 
         LOWER(v_image.filename) LIKE '%' || LOWER(v_vehicle.model) || '%' THEN
        v_filename_score := v_filename_score + 0.4;
      END IF;

      IF v_filename_score > 0 THEN
        v_score := v_score + (LEAST(v_filename_score, 1.0) * 0.2);
        v_reasons := array_append(v_reasons,
          format('Filename match: %s%%', ROUND(LEAST(v_filename_score, 1.0) * 100)::TEXT)
        );
      END IF;
    END IF;

    -- Only return matches above confidence threshold
    IF v_score >= p_min_confidence THEN
      vehicle_id := v_vehicle.id;
      confidence := LEAST(1.0, v_score);
      match_reasons := v_reasons;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION find_images_near_location(DECIMAL, DECIMAL, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION auto_match_image_to_vehicles(UUID, INTEGER, INTEGER, REAL) TO authenticated;

-- Add comments
COMMENT ON FUNCTION find_images_near_location IS 
  'Finds images of a vehicle within a specified distance (meters) of given coordinates';

COMMENT ON FUNCTION auto_match_image_to_vehicles IS 
  'Automatically matches an unorganized image to vehicles based on GPS, date, and filename patterns. Returns matches with confidence scores.';

