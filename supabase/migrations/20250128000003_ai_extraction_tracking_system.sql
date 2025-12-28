-- AI Extraction Tracking System
-- Tracks all extraction attempts separately, builds consensus from multiple extractions
-- Never overwrites existing data - adds extraction history instead

BEGIN;

-- Add extraction tracking fields to vehicle_images
ALTER TABLE vehicle_images
ADD COLUMN IF NOT EXISTS ai_extractions JSONB DEFAULT '[]'::jsonb;

ALTER TABLE vehicle_images
ADD COLUMN IF NOT EXISTS ai_extraction_consensus JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN vehicle_images.ai_extractions IS 
  'Array of all AI extraction attempts with timestamp, model, confidence, and extracted values';

COMMENT ON COLUMN vehicle_images.ai_extraction_consensus IS 
  'Consensus values built from multiple extractions with confidence scores';

-- Function to add a new extraction attempt
CREATE OR REPLACE FUNCTION add_ai_extraction(
  p_image_id UUID,
  p_extraction_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_extractions JSONB;
  v_new_extraction JSONB;
  v_consensus JSONB;
BEGIN
  -- Get current extractions
  SELECT COALESCE(ai_extractions, '[]'::jsonb) INTO v_current_extractions
  FROM vehicle_images
  WHERE id = p_image_id;
  
  -- Build new extraction record
  v_new_extraction := jsonb_build_object(
    'extracted_at', NOW(),
    'model', p_extraction_data->>'model',
    'confidence', (p_extraction_data->>'confidence')::numeric,
    'data', p_extraction_data->'data'
  );
  
  -- Add to array
  v_current_extractions := v_current_extractions || v_new_extraction;
  
  -- Update image
  UPDATE vehicle_images
  SET 
    ai_extractions = v_current_extractions,
    ai_extraction_consensus = build_extraction_consensus(v_current_extractions)
  WHERE id = p_image_id;
  
  -- Return consensus
  SELECT ai_extraction_consensus INTO v_consensus
  FROM vehicle_images
  WHERE id = p_image_id;
  
  RETURN v_consensus;
END;
$$;

-- Function to build consensus from multiple extractions
CREATE OR REPLACE FUNCTION build_extraction_consensus(p_extractions JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_consensus JSONB := '{}'::jsonb;
  v_angle_extractions JSONB := '[]'::jsonb;
  v_category_extractions JSONB := '[]'::jsonb;
  v_label_extractions JSONB := '[]'::jsonb;
  v_extraction JSONB;
  v_angle_counts JSONB := '{}'::jsonb;
  v_category_counts JSONB := '{}'::jsonb;
  v_angle_consensus TEXT;
  v_category_consensus TEXT;
  v_angle_confidence NUMERIC;
  v_category_confidence NUMERIC;
BEGIN
  -- Extract all angle values with their confidences
  FOR v_extraction IN SELECT * FROM jsonb_array_elements(p_extractions)
  LOOP
    IF v_extraction->'data'->>'angle' IS NOT NULL THEN
      v_angle_extractions := v_angle_extractions || jsonb_build_object(
        'value', v_extraction->'data'->>'angle',
        'confidence', (v_extraction->'confidence')::numeric,
        'model', v_extraction->>'model',
        'extracted_at', v_extraction->>'extracted_at'
      );
    END IF;
    
    IF v_extraction->'data'->>'category' IS NOT NULL THEN
      v_category_extractions := v_category_extractions || jsonb_build_object(
        'value', v_extraction->'data'->>'category',
        'confidence', (v_extraction->'confidence')::numeric,
        'model', v_extraction->>'model',
        'extracted_at', v_extraction->>'extracted_at'
      );
    END IF;
    
    IF v_extraction->'data'->>'labels' IS NOT NULL THEN
      v_label_extractions := v_label_extractions || v_extraction->'data'->'labels';
    END IF;
  END LOOP;
  
  -- Build angle consensus (most common value, weighted by confidence)
  IF jsonb_array_length(v_angle_extractions) > 0 THEN
    SELECT 
      value,
      SUM(confidence) as total_confidence,
      COUNT(*) as count
    INTO v_angle_consensus, v_angle_confidence
    FROM (
      SELECT 
        (elem->>'value')::text as value,
        (elem->>'confidence')::numeric as confidence
      FROM jsonb_array_elements(v_angle_extractions) elem
    ) angles
    GROUP BY value
    ORDER BY SUM(confidence) DESC, COUNT(*) DESC
    LIMIT 1;
    
    v_consensus := v_consensus || jsonb_build_object(
      'angle', jsonb_build_object(
        'value', v_angle_consensus,
        'confidence', v_angle_confidence,
        'extraction_count', jsonb_array_length(v_angle_extractions),
        'all_extractions', v_angle_extractions
      )
    );
  END IF;
  
  -- Build category consensus
  IF jsonb_array_length(v_category_extractions) > 0 THEN
    SELECT 
      value,
      SUM(confidence) as total_confidence,
      COUNT(*) as count
    INTO v_category_consensus, v_category_confidence
    FROM (
      SELECT 
        (elem->>'value')::text as value,
        (elem->>'confidence')::numeric as confidence
      FROM jsonb_array_elements(v_category_extractions) elem
    ) categories
    GROUP BY value
    ORDER BY SUM(confidence) DESC, COUNT(*) DESC
    LIMIT 1;
    
    v_consensus := v_consensus || jsonb_build_object(
      'category', jsonb_build_object(
        'value', v_category_consensus,
        'confidence', v_category_confidence,
        'extraction_count', jsonb_array_length(v_category_extractions),
        'all_extractions', v_category_extractions
      )
    );
  END IF;
  
  -- Aggregate labels (union of all labels)
  IF jsonb_array_length(v_label_extractions) > 0 THEN
    v_consensus := v_consensus || jsonb_build_object(
      'labels', jsonb_build_object(
        'values', (
          SELECT jsonb_agg(DISTINCT label)
          FROM (
            SELECT jsonb_array_elements_text(elem->'labels') as label
            FROM jsonb_array_elements(v_label_extractions) elem
          ) labels
        ),
        'extraction_count', jsonb_array_length(v_label_extractions)
      )
    );
  END IF;
  
  RETURN v_consensus;
END;
$$;

-- Function to extract from ai_scan_metadata and add as extraction attempt
CREATE OR REPLACE FUNCTION extract_and_track_ai_analysis()
RETURNS TABLE(
  images_processed INTEGER,
  extractions_added INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_processed INTEGER := 0;
  v_added INTEGER := 0;
  v_image RECORD;
  v_extraction JSONB;
BEGIN
  -- Process images with ai_scan_metadata that haven't been extracted yet
  FOR v_image IN 
    SELECT 
      id,
      ai_scan_metadata,
      ai_extractions
    FROM vehicle_images
    WHERE ai_scan_metadata IS NOT NULL
      AND ai_scan_metadata::text != '{}'
      AND (
        ai_extractions IS NULL 
        OR ai_extractions = '[]'::jsonb
        OR NOT EXISTS (
          SELECT 1 
          FROM jsonb_array_elements(ai_extractions) ext
          WHERE ext->'data'->>'source' = 'ai_scan_metadata'
        )
      )
    LIMIT 10000
  LOOP
    -- Build extraction data from ai_scan_metadata
    v_extraction := jsonb_build_object(
      'source', 'ai_scan_metadata',
      'model', COALESCE(
        v_image.ai_scan_metadata->'appraiser'->>'model',
        'gpt-4o'
      ),
      'confidence', COALESCE(
        (v_image.ai_scan_metadata->'appraiser'->>'condition_score')::numeric / 10.0,
        0.5
      ),
      'data', jsonb_build_object(
        'angle', COALESCE(
          v_image.ai_scan_metadata->'appraiser'->>'angle',
          v_image.ai_scan_metadata->'appraiser'->>'primary_label'
        ),
        'category', COALESCE(
          v_image.ai_scan_metadata->'appraiser'->>'angle_family',
          CASE 
            WHEN v_image.ai_scan_metadata->'appraiser'->>'angle' LIKE 'exterior%' THEN 'exterior'
            WHEN v_image.ai_scan_metadata->'appraiser'->>'angle' LIKE 'interior%' THEN 'interior'
            WHEN v_image.ai_scan_metadata->'appraiser'->>'angle' LIKE 'engine%' THEN 'engine'
            ELSE NULL
          END
        ),
        'labels', (
          SELECT jsonb_agg(jsonb_array_elements(v_image.ai_scan_metadata->'rekognition'->'Labels')->>'Name')
          WHERE v_image.ai_scan_metadata->'rekognition'->'Labels' IS NOT NULL
        )
      )
    );
    
    -- Add extraction
    PERFORM add_ai_extraction(v_image.id, v_extraction);
    
    v_added := v_added + 1;
    v_processed := v_processed + 1;
  END LOOP;
  
  RETURN QUERY SELECT v_processed, v_added;
END;
$$;

-- Run initial extraction
DO $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM extract_and_track_ai_analysis();
  RAISE NOTICE 'Extraction tracking: % images processed, % extractions added', 
    v_result.images_processed, v_result.extractions_added;
END;
$$;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_images_ai_extractions 
  ON vehicle_images USING GIN (ai_extractions);

CREATE INDEX IF NOT EXISTS idx_vehicle_images_ai_consensus 
  ON vehicle_images USING GIN (ai_extraction_consensus);

COMMENT ON FUNCTION add_ai_extraction IS 
  'Adds a new AI extraction attempt to an image. Never overwrites - only adds to history.';

COMMENT ON FUNCTION build_extraction_consensus IS 
  'Builds consensus from multiple extraction attempts, weighted by confidence.';

COMMENT ON FUNCTION extract_and_track_ai_analysis IS 
  'Extracts data from ai_scan_metadata and adds as tracked extraction attempts.';

COMMIT;

