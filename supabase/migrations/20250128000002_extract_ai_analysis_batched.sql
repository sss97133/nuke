-- Extract AI analysis data from ai_scan_metadata JSONB into actual database fields
-- Batched version to avoid timeouts on large datasets
-- Only extracts data with reasonable confidence to avoid inaccurate data

BEGIN;

-- Extract angles (batch 1)
UPDATE vehicle_images
SET 
  angle = COALESCE(
    NULLIF(ai_scan_metadata->'appraiser'->>'angle', ''),
    NULLIF(ai_scan_metadata->'appraiser'->>'primary_label', ''),
    angle
  ),
  ai_detected_angle = COALESCE(
    NULLIF(ai_scan_metadata->'appraiser'->>'angle', ''),
    NULLIF(ai_scan_metadata->'appraiser'->>'primary_label', ''),
    ai_detected_angle
  ),
  ai_detected_angle_confidence = COALESCE(
    CASE 
      WHEN ai_scan_metadata->'appraiser'->>'condition_score' IS NOT NULL 
      THEN (ai_scan_metadata->'appraiser'->>'condition_score')::numeric / 10.0
      ELSE NULL
    END,
    ai_detected_angle_confidence
  ),
  angle_source = CASE 
    WHEN ai_scan_metadata->'appraiser'->>'angle' IS NOT NULL THEN 'ai_appraiser'
    WHEN ai_scan_metadata->'appraiser'->>'primary_label' IS NOT NULL THEN 'ai_appraiser_label'
    ELSE angle_source
  END
WHERE ai_scan_metadata IS NOT NULL
  AND ai_scan_metadata::text != '{}'
  AND (
    ai_scan_metadata->'appraiser'->>'angle' IS NOT NULL 
    OR ai_scan_metadata->'appraiser'->>'primary_label' IS NOT NULL
  )
  AND (
    angle IS NULL 
    OR ai_detected_angle IS NULL
    OR (
      ai_scan_metadata->'appraiser'->>'condition_score' IS NOT NULL 
      AND (ai_scan_metadata->'appraiser'->>'condition_score')::numeric >= 5
    )
  )
  AND id IN (
    SELECT id FROM vehicle_images 
    WHERE ai_scan_metadata IS NOT NULL 
    LIMIT 50000
  );

-- Extract categories (batch 2)
UPDATE vehicle_images
SET 
  category = COALESCE(
    NULLIF(ai_scan_metadata->'appraiser'->>'angle_family', ''),
    CASE 
      WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'exterior%' THEN 'exterior'
      WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'interior%' THEN 'interior'
      WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'engine%' THEN 'engine'
      WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'undercarriage%' THEN 'undercarriage'
      WHEN ai_scan_metadata->'appraiser'->>'primary_label' LIKE '%Engine%' THEN 'engine'
      WHEN ai_scan_metadata->'appraiser'->>'primary_label' LIKE '%Interior%' THEN 'interior'
      WHEN ai_scan_metadata->'appraiser'->>'primary_label' LIKE '%Exterior%' THEN 'exterior'
      ELSE category
    END,
    category
  )
WHERE ai_scan_metadata IS NOT NULL
  AND ai_scan_metadata::text != '{}'
  AND ai_scan_metadata->'appraiser' IS NOT NULL
  AND (
    category IS NULL
    OR (
      ai_scan_metadata->'appraiser'->>'condition_score' IS NOT NULL 
      AND (ai_scan_metadata->'appraiser'->>'condition_score')::numeric >= 6
    )
  )
  AND id IN (
    SELECT id FROM vehicle_images 
    WHERE ai_scan_metadata IS NOT NULL 
    LIMIT 50000
  );

-- Extract labels from rekognition (batch 3) - only for images without labels
UPDATE vehicle_images
SET 
  labels = ARRAY(
    SELECT jsonb_array_elements(ai_scan_metadata->'rekognition'->'Labels')->>'Name'
  )
WHERE ai_scan_metadata IS NOT NULL
  AND ai_scan_metadata::text != '{}'
  AND ai_scan_metadata->'rekognition'->'Labels' IS NOT NULL
  AND jsonb_typeof(ai_scan_metadata->'rekognition'->'Labels') = 'array'
  AND (
    labels IS NULL 
    OR array_length(labels, 1) IS NULL
    OR array_length(labels, 1) = 0
  )
  AND id IN (
    SELECT id FROM vehicle_images 
    WHERE ai_scan_metadata->'rekognition'->'Labels' IS NOT NULL
    LIMIT 20000
  );

-- Update confidence scores (batch 4)
UPDATE vehicle_images
SET 
  ai_avg_confidence = COALESCE(
    (ai_scan_metadata->'appraiser'->>'condition_score')::numeric / 10.0,
    ai_avg_confidence
  )
WHERE ai_scan_metadata IS NOT NULL
  AND ai_scan_metadata::text != '{}'
  AND ai_scan_metadata->'appraiser'->>'condition_score' IS NOT NULL
  AND (
    ai_avg_confidence IS NULL
    OR ai_avg_confidence < (ai_scan_metadata->'appraiser'->>'condition_score')::numeric / 10.0
  )
  AND id IN (
    SELECT id FROM vehicle_images 
    WHERE ai_scan_metadata->'appraiser'->>'condition_score' IS NOT NULL
    LIMIT 50000
  );

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_vehicle_images_angle_source 
  ON vehicle_images(angle_source) 
  WHERE angle_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_images_ai_extracted_angle 
  ON vehicle_images(ai_detected_angle) 
  WHERE ai_detected_angle IS NOT NULL;

COMMIT;

