-- Intelligent Duplicate Detection
-- Detects when user has multiple profiles of same vehicle
-- Uses: GPS proximity, date similarity, user ownership, data completeness

DROP FUNCTION IF EXISTS detect_smart_duplicates(UUID) CASCADE;
CREATE OR REPLACE FUNCTION detect_smart_duplicates(p_user_id UUID)
RETURNS TABLE(
  incomplete_vehicle_id UUID,
  complete_vehicle_id UUID,
  confidence_score INTEGER,
  reasons TEXT[]
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v1.id as incomplete_vehicle_id,
    v2.id as complete_vehicle_id,
    (
      CASE WHEN v1.year = v2.year THEN 30 ELSE 0 END +
      CASE WHEN LOWER(v1.make) = LOWER(v2.make) THEN 30 ELSE 0 END +
      CASE WHEN LOWER(v1.model) LIKE LOWER('%' || v2.model || '%') OR LOWER(v2.model) LIKE LOWER('%' || v1.model || '%') THEN 20 ELSE 0 END +
      CASE WHEN EXISTS (
        SELECT 1 FROM vehicle_images i1, vehicle_images i2
        WHERE i1.vehicle_id = v1.id 
          AND i2.vehicle_id = v2.id
          AND i1.latitude IS NOT NULL 
          AND i2.latitude IS NOT NULL
          AND ST_DWithin(
            ST_MakePoint(i1.longitude, i1.latitude)::geography,
            ST_MakePoint(i2.longitude, i2.latitude)::geography,
            1000  -- Within 1km
          )
      ) THEN 15 ELSE 0 END +
      CASE WHEN (
        SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v2.id
      ) > (
        SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v1.id
      ) THEN 5 ELSE 0 END
    ) as confidence_score,
    ARRAY[
      CASE WHEN v1.year = v2.year THEN 'Same year' ELSE NULL END,
      CASE WHEN LOWER(v1.make) = LOWER(v2.make) THEN 'Same make' ELSE NULL END,
      CASE WHEN v2.vin IS NOT NULL AND v2.vin NOT LIKE 'VIVA-%' THEN 'Has real VIN' ELSE NULL END,
      'Better profile has more data'
    ]::TEXT[] as reasons
  FROM vehicles v1
  CROSS JOIN vehicles v2
  WHERE (v1.user_id = p_user_id OR v1.uploaded_by = p_user_id)
    AND (v2.user_id = p_user_id OR v2.uploaded_by = p_user_id)
    AND v1.id != v2.id
    AND v1.year = v2.year
    AND LOWER(v1.make) = LOWER(v2.make)
    AND (
      LOWER(v1.model) LIKE LOWER('%' || v2.model || '%') OR
      LOWER(v2.model) LIKE LOWER('%' || v1.model || '%')
    )
    AND (v1.vin IS NULL OR v1.vin = '' OR v1.vin LIKE 'VIVA-%')
    AND v2.vin IS NOT NULL
    AND v2.vin NOT LIKE 'VIVA-%'
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_merge_proposals 
      WHERE (primary_vehicle_id = v2.id AND duplicate_vehicle_id = v1.id)
         OR (primary_vehicle_id = v1.id AND duplicate_vehicle_id = v2.id)
    )
  ORDER BY confidence_score DESC;
END;
$$;

-- Run detection for you
SELECT * FROM detect_smart_duplicates('0b9f107a-d124-49de-9ded-94698f63c1c4');

