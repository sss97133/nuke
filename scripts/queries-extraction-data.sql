-- SQL Queries for Extraction Data
-- All queries work on vehicle_images.ai_scan_metadata (JSONB column)
-- Extractions are now indexed by model name for comparison

-- ============================================================================
-- MODEL-INDEXED QUERIES
-- ============================================================================

-- Get extraction from specific model
SELECT 
  id,
  image_url,
  ai_scan_metadata->'extractions'->'gemini-1.5-flash'->>'angle' as angle,
  ai_scan_metadata->'extractions'->'gemini-1.5-flash'->>'primary_label' as label,
  ai_scan_metadata->'extractions'->'gemini-1.5-flash'->>'extracted_at' as extracted_at
FROM vehicle_images
WHERE ai_scan_metadata->'extractions'->'gemini-1.5-flash' IS NOT NULL;

-- Compare extractions from two different models
SELECT 
  id,
  image_url,
  ai_scan_metadata->'extractions'->'gemini-1.5-flash'->>'angle' as model_1_5_angle,
  ai_scan_metadata->'extractions'->'gemini-2.0-flash'->>'angle' as model_2_0_angle,
  CASE 
    WHEN ai_scan_metadata->'extractions'->'gemini-1.5-flash'->>'angle' = 
         ai_scan_metadata->'extractions'->'gemini-2.0-flash'->>'angle' 
    THEN 'MATCH' 
    ELSE 'DIFFERENT' 
  END as comparison
FROM vehicle_images
WHERE ai_scan_metadata->'extractions'->'gemini-1.5-flash' IS NOT NULL
  AND ai_scan_metadata->'extractions'->'gemini-2.0-flash' IS NOT NULL;

-- List all models that have extracted each image
SELECT 
  id,
  image_url,
  ai_scan_metadata->'extraction_models' as models,
  jsonb_array_length(ai_scan_metadata->'extraction_models') as model_count
FROM vehicle_images
WHERE ai_scan_metadata->'extraction_models' IS NOT NULL
ORDER BY jsonb_array_length(ai_scan_metadata->'extraction_models') DESC;

-- Get images with extractions from multiple models
SELECT 
  id,
  image_url,
  ai_scan_metadata->'extraction_models' as models
FROM vehicle_images
WHERE jsonb_array_length(ai_scan_metadata->'extraction_models') > 1;

-- Get token usage by model
SELECT 
  ai_scan_metadata->'extractions'->'gemini-1.5-flash'->'metadata'->'tokens'->>'total' as tokens,
  COUNT(*) as image_count,
  SUM((ai_scan_metadata->'extractions'->'gemini-1.5-flash'->'metadata'->'tokens'->>'total')::integer) as total_tokens
FROM vehicle_images
WHERE ai_scan_metadata->'extractions'->'gemini-1.5-flash'->'metadata'->'tokens'->>'total' IS NOT NULL
GROUP BY ai_scan_metadata->'extractions'->'gemini-1.5-flash'->'metadata'->'tokens'->>'total'
ORDER BY image_count DESC;

-- ============================================================================
-- BASIC QUERIES (Backward Compatible - Uses Latest Extraction)
-- ============================================================================

-- Get all extraction data for a specific image
SELECT 
  id,
  image_url,
  ai_scan_metadata->'appraiser'->>'angle' as angle,
  ai_scan_metadata->'appraiser'->>'primary_label' as angle_label,
  ai_scan_metadata->'appraiser'->>'description' as description,
  ai_scan_metadata->'context_extraction'->>'environment' as environment,
  ai_last_scanned
FROM vehicle_images 
WHERE id = 'your-image-id-here';

-- ============================================================================
-- ANGLE QUERIES
-- ============================================================================

-- Get all angles for a vehicle
SELECT 
  id,
  image_url,
  ai_scan_metadata->'appraiser'->>'primary_label' as angle,
  ai_scan_metadata->'context_extraction'->>'environment' as environment
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND ai_scan_metadata->'appraiser' IS NOT NULL
ORDER BY created_at;

-- Count images by angle for a vehicle
SELECT 
  ai_scan_metadata->'appraiser'->>'angle' as angle,
  ai_scan_metadata->'appraiser'->>'primary_label' as label,
  COUNT(*) as count
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND ai_scan_metadata->'appraiser'->>'angle' IS NOT NULL
GROUP BY 
  ai_scan_metadata->'appraiser'->>'angle',
  ai_scan_metadata->'appraiser'->>'primary_label'
ORDER BY count DESC;

-- ============================================================================
-- CARE ASSESSMENT QUERIES
-- ============================================================================

-- Find all images with low care level
SELECT 
  id,
  image_url,
  ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level' as care_level,
  ai_scan_metadata->'context_extraction'->'care_assessment'->>'owner_cares' as owner_cares,
  ai_scan_metadata->'context_extraction'->'care_assessment'->'condition_indicators' as condition_indicators
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level' = 'low';

-- Get care assessment summary for a vehicle
SELECT 
  ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level' as care_level,
  COUNT(*) as image_count,
  COUNT(*) FILTER (WHERE (ai_scan_metadata->'context_extraction'->'care_assessment'->>'owner_cares')::boolean = true) as owner_cares_count,
  COUNT(*) FILTER (WHERE (ai_scan_metadata->'context_extraction'->'care_assessment'->>'owner_cares')::boolean = false) as owner_doesnt_care_count
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND ai_scan_metadata->'context_extraction'->'care_assessment' IS NOT NULL
GROUP BY ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level';

-- ============================================================================
-- SELLER PSYCHOLOGY QUERIES
-- ============================================================================

-- Find staged vs natural photos
SELECT 
  id,
  image_url,
  ai_scan_metadata->'context_extraction'->'seller_psychology'->>'is_staged' as is_staged,
  ai_scan_metadata->'context_extraction'->'seller_psychology'->>'intent' as intent,
  ai_scan_metadata->'context_extraction'->'seller_psychology'->>'transparency_level' as transparency
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND ai_scan_metadata->'context_extraction'->'seller_psychology' IS NOT NULL;

-- Count staged vs natural photos
SELECT 
  (ai_scan_metadata->'context_extraction'->'seller_psychology'->>'is_staged')::boolean as is_staged,
  ai_scan_metadata->'context_extraction'->'seller_psychology'->>'intent' as intent,
  COUNT(*) as count
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND ai_scan_metadata->'context_extraction'->'seller_psychology' IS NOT NULL
GROUP BY 
  (ai_scan_metadata->'context_extraction'->'seller_psychology'->>'is_staged')::boolean,
  ai_scan_metadata->'context_extraction'->'seller_psychology'->>'intent';

-- ============================================================================
-- ENVIRONMENT QUERIES
-- ============================================================================

-- Get all environments for a vehicle
SELECT 
  ai_scan_metadata->'context_extraction'->>'environment' as environment,
  COUNT(*) as count
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND ai_scan_metadata->'context_extraction'->>'environment' IS NOT NULL
GROUP BY ai_scan_metadata->'context_extraction'->>'environment'
ORDER BY count DESC;

-- Find images with specific environment
SELECT 
  id,
  image_url,
  ai_scan_metadata->'context_extraction'->>'environment' as environment,
  ai_scan_metadata->'context_extraction'->'context'->>'surrounding_area' as surrounding_area
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND ai_scan_metadata->'context_extraction'->>'environment' = 'garage';

-- ============================================================================
-- PRESENTATION QUERIES
-- ============================================================================

-- Find positioned vs natural photos
SELECT 
  id,
  image_url,
  (ai_scan_metadata->'context_extraction'->'presentation'->>'is_positioned')::boolean as is_positioned,
  (ai_scan_metadata->'context_extraction'->'presentation'->>'is_natural')::boolean as is_natural,
  ai_scan_metadata->'context_extraction'->'presentation'->>'photo_quality' as photo_quality
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND ai_scan_metadata->'context_extraction'->'presentation' IS NOT NULL;

-- ============================================================================
-- COMPREHENSIVE QUERIES
-- ============================================================================

-- Get full extraction data for all images in a vehicle
SELECT 
  id,
  image_url,
  ai_scan_metadata->'appraiser'->>'primary_label' as angle_label,
  ai_scan_metadata->'context_extraction'->>'environment' as environment,
  ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level' as care_level,
  ai_scan_metadata->'context_extraction'->'seller_psychology'->>'intent' as intent,
  (ai_scan_metadata->'context_extraction'->'seller_psychology'->>'is_staged')::boolean as is_staged,
  ai_scan_metadata->'appraiser'->'metadata'->'tokens'->>'total' as tokens_used,
  ai_last_scanned
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND ai_scan_metadata->'appraiser' IS NOT NULL
ORDER BY created_at;

-- Get extraction summary statistics for a vehicle
SELECT 
  COUNT(*) as total_images,
  COUNT(*) FILTER (WHERE ai_scan_metadata->'appraiser' IS NOT NULL) as extracted_images,
  COUNT(DISTINCT ai_scan_metadata->'appraiser'->>'angle') as unique_angles,
  COUNT(*) FILTER (WHERE ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level' = 'low') as low_care_count,
  COUNT(*) FILTER (WHERE (ai_scan_metadata->'context_extraction'->'seller_psychology'->>'is_staged')::boolean = true) as staged_count,
  COUNT(*) FILTER (WHERE (ai_scan_metadata->'context_extraction'->'seller_psychology'->>'is_staged')::boolean = false) as natural_count,
  SUM((ai_scan_metadata->'appraiser'->'metadata'->'tokens'->>'total')::integer) FILTER (WHERE ai_scan_metadata->'appraiser'->'metadata'->'tokens'->>'total' IS NOT NULL) as total_tokens_used
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83';

-- ============================================================================
-- FILTERING QUERIES
-- ============================================================================

-- Find images with rust or damage indicators
SELECT 
  id,
  image_url,
  ai_scan_metadata->'context_extraction'->'care_assessment'->'evidence' as evidence,
  ai_scan_metadata->'context_extraction'->'care_assessment'->'condition_indicators' as condition_indicators
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND (
    ai_scan_metadata->'context_extraction'->'care_assessment'->'evidence' @> '"rust"'::jsonb
    OR ai_scan_metadata->'context_extraction'->'care_assessment'->'condition_indicators' @> '"dirty"'::jsonb
  );

-- Find images with other vehicles visible
SELECT 
  id,
  image_url,
  ai_scan_metadata->'context_extraction'->'context'->>'other_vehicles_visible' as other_vehicles_visible,
  ai_scan_metadata->'context_extraction'->'context'->'background_objects' as background_objects
FROM vehicle_images
WHERE vehicle_id = 'e90512ed-9d9c-4467-932e-061fa871de83'
  AND (ai_scan_metadata->'context_extraction'->'context'->>'other_vehicles_visible')::boolean = true;

-- ============================================================================
-- ANALYTICS QUERIES
-- ============================================================================

-- Get angle distribution across all vehicles (top 10)
SELECT 
  ai_scan_metadata->'appraiser'->>'angle' as angle,
  ai_scan_metadata->'appraiser'->>'primary_label' as label,
  COUNT(*) as count
FROM vehicle_images
WHERE ai_scan_metadata->'appraiser'->>'angle' IS NOT NULL
GROUP BY 
  ai_scan_metadata->'appraiser'->>'angle',
  ai_scan_metadata->'appraiser'->>'primary_label'
ORDER BY count DESC
LIMIT 10;

-- Get care level distribution
SELECT 
  ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level' as care_level,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM vehicle_images
WHERE ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level' IS NOT NULL
GROUP BY ai_scan_metadata->'context_extraction'->'care_assessment'->>'care_level'
ORDER BY count DESC;

-- Get seller intent distribution
SELECT 
  ai_scan_metadata->'context_extraction'->'seller_psychology'->>'intent' as intent,
  COUNT(*) as count
FROM vehicle_images
WHERE ai_scan_metadata->'context_extraction'->'seller_psychology'->>'intent' IS NOT NULL
GROUP BY ai_scan_metadata->'context_extraction'->'seller_psychology'->>'intent'
ORDER BY count DESC;

