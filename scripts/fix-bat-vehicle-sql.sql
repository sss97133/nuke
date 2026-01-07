-- Comprehensive BaT Vehicle Repair Script
-- Vehicle: cde8da51-2b3b-4d82-8ca4-11e6f95d7928 (2007 Bentley Continental GTC)
-- Demonstrates the extraction_attempts model in pure SQL

-- =============================================================================
-- STEP 1: ANALYZE CURRENT STATE
-- =============================================================================

-- Get vehicle info
\echo '=== CURRENT STATE ==='
SELECT 
  'Vehicle ID' as field, v.id as value
FROM vehicles v WHERE v.id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
UNION ALL
SELECT 'Title', v.title FROM vehicles v WHERE v.id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
UNION ALL
SELECT 'Discovery URL', v.discovery_url FROM vehicles v WHERE v.id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
UNION ALL
SELECT 'Primary Image (before)', v.primary_image_url FROM vehicles v WHERE v.id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
UNION ALL
SELECT 'Current image count', COUNT(vi.id)::text FROM vehicle_images vi WHERE vi.vehicle_id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928';

-- =============================================================================
-- STEP 2: EXTRACT CANONICAL IMAGES FROM origin_metadata
-- =============================================================================

\echo ''
\echo '=== EXTRACTING CANONICAL IMAGES ==='

-- Parse and filter canonical images
WITH canonical_raw AS (
  SELECT 
    v.id as vehicle_id,
    jsonb_array_elements_text(v.origin_metadata->'image_urls') as image_url
  FROM vehicles v
  WHERE v.id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
),
canonical_filtered AS (
  SELECT DISTINCT image_url
  FROM canonical_raw
  WHERE image_url ~ '/wp-content/uploads/.*\.(jpg|jpeg|png|webp)'  -- Only photos from uploads
    AND image_url !~ '(svg|icon|logo|social|theme|partial-load|opt-out)'  -- Exclude UI elements
  ORDER BY image_url
)
SELECT 'Found ' || COUNT(*) || ' canonical photos' as status FROM canonical_filtered;

-- =============================================================================
-- STEP 3: CHECK FOR CONTAMINATION (shared hashes, bad hosts)
-- =============================================================================

\echo ''
\echo '=== CHECKING CONTAMINATION ==='

WITH image_hashes AS (
  SELECT 
    vi.id,
    vi.vehicle_id,
    vi.image_url,
    vi.file_hash
  FROM vehicle_images vi
  WHERE vi.vehicle_id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
    AND vi.file_hash IS NOT NULL
),
hash_usage AS (
  SELECT 
    ih.file_hash,
    COUNT(DISTINCT ih.vehicle_id) as vehicle_count
  FROM image_hashes ih
  GROUP BY ih.file_hash
  HAVING COUNT(DISTINCT ih.vehicle_id) > 1
),
contaminated_images AS (
  SELECT 
    vi.id,
    vi.image_url,
    CASE 
      WHEN hu.vehicle_count > 1 THEN 'shared_hash (' || hu.vehicle_count || ' vehicles)'
      WHEN vi.image_url ~ '(facebook|linkedin|addtoany|twitter|pinterest)' THEN 'bad_host'
      ELSE 'unknown'
    END as contamination_reason
  FROM vehicle_images vi
  LEFT JOIN image_hashes ih ON ih.id = vi.id
  LEFT JOIN hash_usage hu ON hu.file_hash = ih.file_hash
  WHERE vi.vehicle_id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
    AND (hu.vehicle_count > 1 OR vi.image_url ~ '(facebook|linkedin|addtoany|twitter|pinterest)')
)
SELECT 
  COALESCE(COUNT(*), 0) || ' contaminated images found' as status
FROM contaminated_images;

-- =============================================================================
-- STEP 4: RECORD EXTRACTION ATTEMPT (DRY RUN)
-- =============================================================================

\echo ''
\echo '=== RECORDING EXTRACTION ATTEMPT ==='

-- Record the attempt
DO $$
DECLARE
  v_attempt_id UUID;
  v_extractor_id UUID;
  v_canonical_count INT;
  v_contaminated_count INT;
  v_current_count INT;
BEGIN
  -- Get extractor ID
  SELECT id INTO v_extractor_id
  FROM extractor_registry
  WHERE name = 'bat-listing' AND version = 'v7'
  LIMIT 1;
  
  -- Count images
  WITH canonical_raw AS (
    SELECT jsonb_array_elements_text(v.origin_metadata->'image_urls') as image_url
    FROM vehicles v WHERE v.id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
  ),
  canonical_filtered AS (
    SELECT DISTINCT image_url FROM canonical_raw
    WHERE image_url ~ '/wp-content/uploads/.*\.(jpg|jpeg|png|webp)'
      AND image_url !~ '(svg|icon|logo|social|theme|partial-load|opt-out)'
  )
  SELECT COUNT(*) INTO v_canonical_count FROM canonical_filtered;
  
  SELECT COUNT(*) INTO v_current_count 
  FROM vehicle_images 
  WHERE vehicle_id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928';
  
  -- Insert attempt record
  INSERT INTO extraction_attempts (
    vehicle_id,
    source_url,
    source_type,
    extractor_name,
    extractor_version,
    extractor_id,
    status,
    metrics,
    extracted_data,
    snapshot_ref,
    validation_passed,
    completed_at
  ) VALUES (
    'cde8da51-2b3b-4d82-8ca4-11e6f95d7928',
    'https://bringatrailer.com/listing/2007-bentley-continental-gtc-59',
    'bat',
    'bat-listing',
    'v7',
    v_extractor_id,
    'success',
    jsonb_build_object(
      'images', jsonb_build_object(
        'before_total', v_current_count,
        'canonical_found', v_canonical_count
      ),
      'timing', jsonb_build_object(
        'total_ms', 0
      )
    ),
    jsonb_build_object(
      'canonical_count', v_canonical_count
    ),
    'manual_sql_fix',
    true,
    now()
  ) RETURNING id INTO v_attempt_id;
  
  RAISE NOTICE 'Extraction attempt recorded: %', v_attempt_id;
END $$;

-- =============================================================================
-- STEP 5: APPLY FIX (uncomment to execute)
-- =============================================================================

\echo ''
\echo '=== READY TO APPLY FIX ==='
\echo 'To apply:'
\echo '1. Delete contaminated images'
\echo '2. Insert canonical images'
\echo '3. Update primary_image_url'
\echo ''
\echo 'Uncomment the sections below to execute.'

-- UNCOMMENT TO APPLY:
/*
-- Delete contaminated images
WITH image_hashes AS (
  SELECT vi.id, vi.vehicle_id, vi.file_hash
  FROM vehicle_images vi
  WHERE vi.vehicle_id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
    AND vi.file_hash IS NOT NULL
),
hash_usage AS (
  SELECT ih.file_hash, COUNT(DISTINCT ih.vehicle_id) as vehicle_count
  FROM image_hashes ih
  GROUP BY ih.file_hash
  HAVING COUNT(DISTINCT ih.vehicle_id) > 1
),
contaminated_ids AS (
  SELECT vi.id
  FROM vehicle_images vi
  LEFT JOIN image_hashes ih ON ih.id = vi.id
  LEFT JOIN hash_usage hu ON hu.file_hash = ih.file_hash
  WHERE vi.vehicle_id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
    AND (hu.vehicle_count > 1 OR vi.image_url ~ '(facebook|linkedin|addtoany|twitter|pinterest)')
)
DELETE FROM vehicle_images WHERE id IN (SELECT id FROM contaminated_ids);

-- Insert canonical images
WITH canonical_raw AS (
  SELECT jsonb_array_elements_text(v.origin_metadata->'image_urls') as image_url
  FROM vehicles v WHERE v.id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
),
canonical_filtered AS (
  SELECT DISTINCT image_url FROM canonical_raw
  WHERE image_url ~ '/wp-content/uploads/.*\.(jpg|jpeg|png|webp)'
    AND image_url !~ '(svg|icon|logo|social|theme|partial-load|opt-out)'
),
new_images AS (
  SELECT 
    cf.image_url,
    ROW_NUMBER() OVER (ORDER BY cf.image_url) as position
  FROM canonical_filtered cf
  LEFT JOIN vehicle_images vi 
    ON vi.vehicle_id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928' 
    AND vi.image_url = cf.image_url
  WHERE vi.id IS NULL  -- Only insert missing images
)
INSERT INTO vehicle_images (vehicle_id, image_url, source, image_type, is_canonical, is_primary, position)
SELECT 
  'cde8da51-2b3b-4d82-8ca4-11e6f95d7928',
  image_url,
  'bat_import',
  'gallery',
  true,
  (position = 1),
  position
FROM new_images;

-- Update primary_image_url
WITH canonical_raw AS (
  SELECT jsonb_array_elements_text(v.origin_metadata->'image_urls') as image_url
  FROM vehicles v WHERE v.id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
),
canonical_first AS (
  SELECT image_url FROM canonical_raw
  WHERE image_url ~ '/wp-content/uploads/.*\.(jpg|jpeg|png|webp)'
    AND image_url !~ '(svg|icon|logo|social|theme|partial-load|opt-out)'
  ORDER BY image_url
  LIMIT 1
)
UPDATE vehicles
SET 
  primary_image_url = (SELECT image_url FROM canonical_first),
  updated_at = now()
WHERE id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928';
*/

-- =============================================================================
-- STEP 6: VERIFY RESULTS (run after applying fix)
-- =============================================================================

\echo ''
\echo '=== VERIFICATION (run after applying fix) ==='

/*
SELECT 
  'After: image count' as field,
  COUNT(*)::text as value
FROM vehicle_images 
WHERE vehicle_id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928'
UNION ALL
SELECT 
  'After: primary image',
  v.primary_image_url
FROM vehicles v 
WHERE v.id = 'cde8da51-2b3b-4d82-8ca4-11e6f95d7928';
*/

