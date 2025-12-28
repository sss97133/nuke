-- Properly organize AI analysis data - SQL migration (not JavaScript loops)
-- This should have been done when data was first extracted

BEGIN;

-- Step 1: Populate extraction tracking for ALL images with metadata in one go
-- Use a single UPDATE with subquery instead of loops
UPDATE vehicle_images
SET 
  ai_extractions = jsonb_build_array(
    jsonb_build_object(
      'extracted_at', COALESCE(ai_last_scanned, NOW()),
      'source', 'ai_scan_metadata',
      'model', COALESCE(ai_scan_metadata->'appraiser'->>'model', 'gpt-4o'),
      'confidence', COALESCE(
        (ai_scan_metadata->'appraiser'->>'condition_score')::numeric / 10.0,
        0.5
      ),
      'data', jsonb_build_object(
        'angle', COALESCE(
          ai_scan_metadata->'appraiser'->>'angle',
          ai_scan_metadata->'appraiser'->>'primary_label'
        ),
        'category', COALESCE(
          ai_scan_metadata->'appraiser'->>'angle_family',
          CASE 
            WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'exterior%' THEN 'exterior'
            WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'interior%' THEN 'interior'
            WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'engine%' THEN 'engine'
            WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'undercarriage%' THEN 'undercarriage'
            ELSE NULL
          END
        ),
        'labels', (
          SELECT jsonb_agg(jsonb_array_elements(ai_scan_metadata->'rekognition'->'Labels')->>'Name')
          WHERE ai_scan_metadata->'rekognition'->'Labels' IS NOT NULL
            AND jsonb_typeof(ai_scan_metadata->'rekognition'->'Labels') = 'array'
        )
      )
    )
  ),
  ai_extraction_consensus = build_extraction_consensus(
    jsonb_build_array(
      jsonb_build_object(
        'extracted_at', COALESCE(ai_last_scanned, NOW()),
        'source', 'ai_scan_metadata',
        'model', COALESCE(ai_scan_metadata->'appraiser'->>'model', 'gpt-4o'),
        'confidence', COALESCE(
          (ai_scan_metadata->'appraiser'->>'condition_score')::numeric / 10.0,
          0.5
        ),
        'data', jsonb_build_object(
          'angle', COALESCE(
            ai_scan_metadata->'appraiser'->>'angle',
            ai_scan_metadata->'appraiser'->>'primary_label'
          ),
          'category', COALESCE(
            ai_scan_metadata->'appraiser'->>'angle_family',
            CASE 
              WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'exterior%' THEN 'exterior'
              WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'interior%' THEN 'interior'
              WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'engine%' THEN 'engine'
              WHEN ai_scan_metadata->'appraiser'->>'angle' LIKE 'undercarriage%' THEN 'undercarriage'
              ELSE NULL
            END
          )
        )
      )
    )
  )
WHERE ai_scan_metadata IS NOT NULL
  AND ai_scan_metadata::text != '{}'
  AND (ai_extractions IS NULL OR ai_extractions = '[]'::jsonb);

-- Step 2: Create a view so you can actually SEE the data
CREATE OR REPLACE VIEW organized_ai_analysis AS
SELECT 
  vi.id as image_id,
  vi.vehicle_id,
  vi.image_url,
  
  -- Consensus values (what we're confident about)
  vi.ai_extraction_consensus->'angle'->>'value' as consensus_angle,
  (vi.ai_extraction_consensus->'angle'->>'confidence')::numeric as angle_confidence,
  (vi.ai_extraction_consensus->'angle'->>'extraction_count')::integer as angle_extraction_count,
  
  vi.ai_extraction_consensus->'category'->>'value' as consensus_category,
  (vi.ai_extraction_consensus->'category'->>'confidence')::numeric as category_confidence,
  
  -- All individual extractions (so you can see conflicts)
  vi.ai_extractions as all_extractions,
  jsonb_array_length(vi.ai_extractions) as extraction_count,
  
  -- Quick access fields
  vi.angle,
  vi.category,
  vi.ai_detected_angle,
  vi.labels,
  
  -- Metadata (raw)
  vi.ai_scan_metadata->'appraiser' as appraiser_data,
  vi.ai_scan_metadata->'rekognition' as rekognition_data,
  
  -- Status
  vi.ai_processing_status,
  vi.total_processing_cost,
  vi.ai_last_scanned
FROM vehicle_images vi
WHERE vi.ai_scan_metadata IS NOT NULL
  AND vi.ai_scan_metadata::text != '{}';

-- Step 3: Create summary view
CREATE OR REPLACE VIEW ai_analysis_summary AS
SELECT 
  COUNT(*) as total_images_analyzed,
  COUNT(DISTINCT vehicle_id) as vehicles_with_analysis,
  COUNT(CASE WHEN ai_extraction_consensus->>'angle' IS NOT NULL THEN 1 END) as images_with_angle_consensus,
  COUNT(CASE WHEN ai_extraction_consensus->>'category' IS NOT NULL THEN 1 END) as images_with_category_consensus,
  COUNT(CASE WHEN jsonb_array_length(ai_extractions) > 1 THEN 1 END) as images_with_multiple_extractions,
  ROUND(AVG((ai_extraction_consensus->'angle'->>'confidence')::numeric), 2) as avg_angle_confidence,
  SUM(total_processing_cost) as total_cost_tracked
FROM vehicle_images
WHERE ai_scan_metadata IS NOT NULL
  AND ai_scan_metadata::text != '{}';

-- Step 4: Create view showing conflicts (where extractions disagree)
CREATE OR REPLACE VIEW ai_extraction_conflicts AS
SELECT 
  vi.id as image_id,
  vi.vehicle_id,
  vi.image_url,
  vi.ai_extractions,
  jsonb_array_length(vi.ai_extractions) as extraction_count,
  -- Find conflicting angle values
  (
    SELECT jsonb_agg(DISTINCT ext->'data'->>'angle')
    FROM jsonb_array_elements(vi.ai_extractions) ext
    WHERE ext->'data'->>'angle' IS NOT NULL
  ) as conflicting_angles,
  -- Find conflicting category values
  (
    SELECT jsonb_agg(DISTINCT ext->'data'->>'category')
    FROM jsonb_array_elements(vi.ai_extractions) ext
    WHERE ext->'data'->>'category' IS NOT NULL
  ) as conflicting_categories
FROM vehicle_images vi
WHERE vi.ai_extractions IS NOT NULL
  AND jsonb_array_length(vi.ai_extractions) > 1
  AND (
    -- Has conflicting angles
    (
      SELECT COUNT(DISTINCT ext->'data'->>'angle')
      FROM jsonb_array_elements(vi.ai_extractions) ext
      WHERE ext->'data'->>'angle' IS NOT NULL
    ) > 1
    OR
    -- Has conflicting categories
    (
      SELECT COUNT(DISTINCT ext->'data'->>'category')
      FROM jsonb_array_elements(vi.ai_extractions) ext
      WHERE ext->'data'->>'category' IS NOT NULL
    ) > 1
  );

COMMENT ON VIEW organized_ai_analysis IS 
  'View showing all organized AI analysis data - consensus values and all extractions';

COMMENT ON VIEW ai_analysis_summary IS 
  'Summary statistics of AI analysis coverage';

COMMENT ON VIEW ai_extraction_conflicts IS 
  'Images where multiple extractions disagree - need manual review';

COMMIT;

