-- Enhanced Duplicate Image Detection
-- Supports both exact duplicates (file hash) and near-duplicates (perceptual hash)

-- Add perceptual hash for near-duplicate detection
ALTER TABLE vehicle_images
ADD COLUMN IF NOT EXISTS perceptual_hash TEXT,
ADD COLUMN IF NOT EXISTS dhash TEXT,
ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES vehicle_images(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT FALSE;

-- Add indexes for fast duplicate lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_images_file_hash 
  ON vehicle_images(file_hash) 
  WHERE file_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_images_perceptual_hash 
  ON vehicle_images(perceptual_hash) 
  WHERE perceptual_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_hash 
  ON vehicle_images(vehicle_id, file_hash);

-- Add unique constraint on vehicle + hash (prevent exact duplicates per vehicle)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_vehicle_file_hash 
  ON vehicle_images(vehicle_id, file_hash) 
  WHERE file_hash IS NOT NULL AND vehicle_id IS NOT NULL;

-- Function to find duplicate images for a vehicle
CREATE OR REPLACE FUNCTION find_duplicate_images(
  p_vehicle_id UUID,
  p_file_hash TEXT,
  p_perceptual_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
  duplicate_id UUID,
  duplicate_type TEXT,
  similarity_score FLOAT
) AS $$
BEGIN
  -- Find exact hash matches
  RETURN QUERY
  SELECT 
    id as duplicate_id,
    'exact'::TEXT as duplicate_type,
    1.0::FLOAT as similarity_score
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND file_hash = p_file_hash
    AND file_hash IS NOT NULL
  LIMIT 1;
  
  -- If no exact match and perceptual hash provided, find near-duplicates
  IF NOT FOUND AND p_perceptual_hash IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      id as duplicate_id,
      'perceptual'::TEXT as duplicate_type,
      0.95::FLOAT as similarity_score -- Placeholder, actual similarity would need hamming distance
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND perceptual_hash = p_perceptual_hash
      AND perceptual_hash IS NOT NULL
    LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to mark image as duplicate
CREATE OR REPLACE FUNCTION mark_as_duplicate(
  p_image_id UUID,
  p_original_id UUID
)
RETURNS VOID AS $$
BEGIN
  UPDATE vehicle_images
  SET 
    is_duplicate = TRUE,
    duplicate_of = p_original_id,
    updated_at = NOW()
  WHERE id = p_image_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get duplicate statistics for a vehicle
CREATE OR REPLACE FUNCTION get_duplicate_stats(p_vehicle_id UUID)
RETURNS TABLE (
  total_images BIGINT,
  unique_images BIGINT,
  duplicate_images BIGINT,
  space_wasted_bytes BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as total_images,
    COUNT(DISTINCT file_hash)::BIGINT as unique_images,
    COUNT(*) FILTER (WHERE is_duplicate = TRUE)::BIGINT as duplicate_images,
    SUM(file_size) FILTER (WHERE is_duplicate = TRUE)::BIGINT as space_wasted_bytes
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id;
END;
$$ LANGUAGE plpgsql;

-- Add comments
COMMENT ON COLUMN vehicle_images.file_hash IS 'SHA-256 hash of file content for exact duplicate detection';
COMMENT ON COLUMN vehicle_images.perceptual_hash IS 'pHash for near-duplicate detection (similar images)';
COMMENT ON COLUMN vehicle_images.dhash IS 'Difference hash for fast perceptual matching';
COMMENT ON COLUMN vehicle_images.duplicate_of IS 'References the original image if this is a duplicate';
COMMENT ON COLUMN vehicle_images.is_duplicate IS 'True if this image is a duplicate of another';

