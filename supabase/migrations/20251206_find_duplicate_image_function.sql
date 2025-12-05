-- Function to find duplicate images by filename or EXIF signature
-- Returns matching image ID and vehicle ID with confidence score
-- 
-- Images are KEYS - they unlock connections to existing data.
-- When a user uploads an image that already exists, we can:
-- 1. Detect the duplicate
-- 2. Find the original image's vehicle
-- 3. Link the uploader/org to that vehicle as a service relationship

CREATE OR REPLACE FUNCTION find_duplicate_image(
  p_filename TEXT,
  p_taken_at TIMESTAMPTZ DEFAULT NULL,
  p_latitude DECIMAL DEFAULT NULL,
  p_longitude DECIMAL DEFAULT NULL,
  p_camera_make TEXT DEFAULT NULL,
  p_camera_model TEXT DEFAULT NULL,
  p_exclude_image_id UUID DEFAULT NULL
)
RETURNS TABLE (
  image_id UUID,
  vehicle_id UUID,
  vehicle_year INT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  match_confidence REAL,
  match_reasons TEXT[]
) AS $$
DECLARE
  v_normalized_filename TEXT;
BEGIN
  -- Normalize filename (get just the file part, lowercase)
  v_normalized_filename := LOWER(COALESCE(
    SUBSTRING(p_filename FROM '[^/]+$'),
    p_filename
  ));
  
  RETURN QUERY
  WITH filename_matches AS (
    -- First try exact filename match
    SELECT 
      vi.id,
      vi.vehicle_id as vid,
      v.year,
      v.make,
      v.model,
      0.9::REAL as confidence,
      ARRAY['Filename match']::TEXT[] as reasons
    FROM vehicle_images vi
    JOIN vehicles v ON v.id = vi.vehicle_id
    WHERE vi.vehicle_id IS NOT NULL
      AND (p_exclude_image_id IS NULL OR vi.id != p_exclude_image_id)
      AND LOWER(vi.filename) LIKE '%' || v_normalized_filename || '%'
    LIMIT 5
  ),
  exif_matches AS (
    -- Then try EXIF signature match
    SELECT 
      vi.id,
      vi.vehicle_id as vid,
      v.year,
      v.make,
      v.model,
      (
        CASE WHEN p_taken_at IS NOT NULL AND vi.taken_at IS NOT NULL 
             AND ABS(EXTRACT(EPOCH FROM (vi.taken_at - p_taken_at))) < 60 
             THEN 0.3 ELSE 0 END +
        CASE WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL 
             AND vi.latitude IS NOT NULL AND vi.longitude IS NOT NULL
             AND ST_DWithin(
               ST_MakePoint(vi.longitude, vi.latitude)::geography,
               ST_MakePoint(p_longitude, p_latitude)::geography,
               100
             )
             THEN 0.3 ELSE 0 END +
        CASE WHEN p_camera_make IS NOT NULL 
             AND vi.exif_data->>'Make' = p_camera_make
             THEN 0.2 ELSE 0 END +
        CASE WHEN p_camera_model IS NOT NULL 
             AND vi.exif_data->>'Model' = p_camera_model
             THEN 0.2 ELSE 0 END
      )::REAL as confidence,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN p_taken_at IS NOT NULL AND vi.taken_at IS NOT NULL 
             AND ABS(EXTRACT(EPOCH FROM (vi.taken_at - p_taken_at))) < 60 
             THEN 'Same timestamp' END,
        CASE WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL 
             AND vi.latitude IS NOT NULL AND vi.longitude IS NOT NULL
             AND ST_DWithin(
               ST_MakePoint(vi.longitude, vi.latitude)::geography,
               ST_MakePoint(p_longitude, p_latitude)::geography,
               100
             )
             THEN 'GPS match' END,
        CASE WHEN p_camera_make IS NOT NULL 
             AND vi.exif_data->>'Make' = p_camera_make
             THEN 'Same camera make' END,
        CASE WHEN p_camera_model IS NOT NULL 
             AND vi.exif_data->>'Model' = p_camera_model
             THEN 'Same camera model' END
      ], NULL)::TEXT[] as reasons
    FROM vehicle_images vi
    JOIN vehicles v ON v.id = vi.vehicle_id
    WHERE vi.vehicle_id IS NOT NULL
      AND (p_exclude_image_id IS NULL OR vi.id != p_exclude_image_id)
      AND (
        -- Need at least timestamp or GPS to match
        (p_taken_at IS NOT NULL AND vi.taken_at IS NOT NULL 
         AND ABS(EXTRACT(EPOCH FROM (vi.taken_at - p_taken_at))) < 60)
        OR
        (p_latitude IS NOT NULL AND p_longitude IS NOT NULL 
         AND vi.latitude IS NOT NULL AND vi.longitude IS NOT NULL
         AND ST_DWithin(
           ST_MakePoint(vi.longitude, vi.latitude)::geography,
           ST_MakePoint(p_longitude, p_latitude)::geography,
           100
         ))
      )
    LIMIT 10
  ),
  all_matches AS (
    SELECT * FROM filename_matches
    UNION ALL
    SELECT * FROM exif_matches WHERE confidence >= 0.5
  )
  SELECT DISTINCT ON (vid)
    id as image_id,
    vid as vehicle_id,
    year as vehicle_year,
    make as vehicle_make,
    model as vehicle_model,
    confidence as match_confidence,
    reasons as match_reasons
  FROM all_matches
  ORDER BY vid, confidence DESC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION find_duplicate_image(TEXT, TIMESTAMPTZ, DECIMAL, DECIMAL, TEXT, TEXT, UUID) TO authenticated;

