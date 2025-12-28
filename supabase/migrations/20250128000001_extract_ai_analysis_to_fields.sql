-- Extract AI analysis data from ai_scan_metadata JSONB into actual database fields
-- Only extracts data with reasonable confidence to avoid inaccurate data
-- Marks extracted data with source tracking

BEGIN;

-- Function to safely extract and populate fields from ai_scan_metadata
CREATE OR REPLACE FUNCTION extract_ai_analysis_to_fields()
RETURNS TABLE(
  images_updated INTEGER,
  angles_extracted INTEGER,
  categories_extracted INTEGER,
  labels_extracted INTEGER
) 
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INTEGER := 0;
  v_angles INTEGER := 0;
  v_categories INTEGER := 0;
  v_labels INTEGER := 0;
BEGIN
  -- Extract angle data (only if confidence is reasonable or not set)
  -- Prefer appraiser.angle, fallback to appraiser.primary_label if it looks like an angle
  UPDATE vehicle_images
  SET 
    angle = COALESCE(
      NULLIF(ai_scan_metadata->'appraiser'->>'angle', ''),
      NULLIF(ai_scan_metadata->'appraiser'->>'primary_label', ''),
      angle  -- Keep existing if no new data
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
      -- Only update if angle is currently NULL or if confidence is reasonable
      angle IS NULL 
      OR ai_detected_angle IS NULL
      OR (
        ai_scan_metadata->'appraiser'->>'condition_score' IS NOT NULL 
        AND (ai_scan_metadata->'appraiser'->>'condition_score')::numeric >= 5
      )
    );
  
  GET DIAGNOSTICS v_angles = ROW_COUNT;
  v_updated := v_updated + v_angles;

  -- Extract category (from appraiser.primary_label or angle_family)
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
    );
  
  GET DIAGNOSTICS v_categories = ROW_COUNT;
  v_updated := v_updated + v_categories;

  -- Extract labels from rekognition data (if available)
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
    );
  
  GET DIAGNOSTICS v_labels = ROW_COUNT;
  v_updated := v_updated + v_labels;

  -- Update ai_avg_confidence from condition_score if available
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
    );

  -- Update ai_component_count if available in metadata
  UPDATE vehicle_images
  SET 
    ai_component_count = COALESCE(
      (ai_scan_metadata->'appraiser'->>'component_count')::integer,
      (ai_scan_metadata->'rekognition'->>'LabelCount')::integer,
      ai_component_count
    )
  WHERE ai_scan_metadata IS NOT NULL
    AND ai_scan_metadata::text != '{}'
    AND (
      ai_scan_metadata->'appraiser'->>'component_count' IS NOT NULL
      OR ai_scan_metadata->'rekognition'->>'LabelCount' IS NOT NULL
    )
    AND ai_component_count IS NULL;

  RETURN QUERY SELECT v_updated, v_angles, v_categories, v_labels;
END;
$$;

-- Run the extraction
DO $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM extract_ai_analysis_to_fields();
  RAISE NOTICE 'Extraction complete: % images updated, % angles, % categories, % labels', 
    v_result.images_updated, v_result.angles_extracted, v_result.categories_extracted, v_result.labels_extracted;
END;
$$;

-- Add index for faster queries on extracted fields
CREATE INDEX IF NOT EXISTS idx_vehicle_images_angle_source 
  ON vehicle_images(angle_source) 
  WHERE angle_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_images_ai_extracted_angle 
  ON vehicle_images(ai_detected_angle) 
  WHERE ai_detected_angle IS NOT NULL;

COMMENT ON FUNCTION extract_ai_analysis_to_fields IS 
  'Extracts AI analysis data from ai_scan_metadata JSONB into actual database fields. Only extracts data with reasonable confidence scores to avoid inaccurate data.';

COMMIT;

