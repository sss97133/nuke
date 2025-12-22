-- Monitor Partial Scrape Failures
-- Shows vehicles where some scrape steps succeeded but others failed
-- Useful for identifying what needs retry

-- ============================================
-- VIEW: Vehicles with Partial Failures
-- ============================================
CREATE OR REPLACE VIEW partial_scrape_failures AS
SELECT 
  v.id as vehicle_id,
  v.make,
  v.model,
  v.year,
  v.discovery_url,
  v.created_at,
  
  -- Data extraction status
  CASE 
    WHEN v.vin IS NOT NULL THEN '✅'
    ELSE '❌'
  END as vin_status,
  
  CASE 
    WHEN v.sale_price IS NOT NULL THEN '✅'
    ELSE '❌'
  END as price_status,
  
  CASE 
    WHEN v.description IS NOT NULL AND v.description != '' THEN '✅'
    ELSE '❌'
  END as description_status,
  
  -- Image extraction status
  CASE 
    WHEN v.origin_metadata->'image_urls' IS NOT NULL 
     AND v.origin_metadata->'image_urls' != '[]'::jsonb THEN '✅'
    ELSE '❌'
  END as image_urls_extracted,
  
  CASE 
    WHEN COUNT(vi.id) > 0 THEN '✅'
    ELSE '❌'
  END as images_downloaded,
  
  -- Counts
  (v.origin_metadata->>'image_count')::INTEGER as stored_image_count,
  COUNT(vi.id) as actual_image_count,
  
  -- Failure summary
  CASE 
    WHEN v.vin IS NULL AND v.sale_price IS NULL AND COUNT(vi.id) = 0 THEN 'complete_failure'
    WHEN v.vin IS NULL OR v.sale_price IS NULL THEN 'data_missing'
    WHEN COUNT(vi.id) = 0 AND v.origin_metadata->'image_urls' IS NOT NULL THEN 'images_failed_download'
    WHEN COUNT(vi.id) = 0 AND v.origin_metadata->'image_urls' IS NULL THEN 'images_not_extracted'
    ELSE 'complete'
  END as failure_type,
  
  -- Retry recommendations
  CASE 
    WHEN COUNT(vi.id) = 0 AND v.origin_metadata->'image_urls' IS NOT NULL 
     AND v.origin_metadata->'image_urls' != '[]'::jsonb THEN 'retry-image-backfill'
    WHEN v.vin IS NULL THEN 'retry-vin-extraction'
    WHEN v.sale_price IS NULL THEN 'retry-data-extraction'
    ELSE NULL
  END as recommended_retry_function

FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
WHERE v.origin_metadata->>'source' = 'bringatrailer.com'
   OR v.discovery_url LIKE '%bringatrailer.com%'
GROUP BY v.id, v.make, v.model, v.year, v.discovery_url, v.vin, v.sale_price, v.description, v.origin_metadata, v.created_at
HAVING 
  v.vin IS NULL 
  OR v.sale_price IS NULL
  OR COUNT(vi.id) = 0
ORDER BY v.created_at DESC;

-- ============================================
-- QUERY: Recent Partial Failures
-- ============================================
SELECT 
  vehicle_id,
  make,
  model,
  year,
  failure_type,
  recommended_retry_function,
  stored_image_count,
  actual_image_count,
  created_at
FROM partial_scrape_failures
WHERE failure_type != 'complete'
ORDER BY created_at DESC
LIMIT 50;

-- ============================================
-- QUERY: Failure Statistics
-- ============================================
SELECT 
  failure_type,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE recommended_retry_function = 'retry-image-backfill') as needs_image_retry,
  COUNT(*) FILTER (WHERE recommended_retry_function = 'retry-vin-extraction') as needs_vin_retry,
  COUNT(*) FILTER (WHERE recommended_retry_function = 'retry-data-extraction') as needs_data_retry,
  ROUND(AVG(stored_image_count), 1) as avg_stored_images,
  ROUND(AVG(actual_image_count), 1) as avg_actual_images
FROM partial_scrape_failures
WHERE failure_type != 'complete'
GROUP BY failure_type
ORDER BY count DESC;

-- ============================================
-- QUERY: Vehicles Ready for Image Retry
-- ============================================
SELECT 
  v.id as vehicle_id,
  v.make,
  v.model,
  v.year,
  (v.origin_metadata->>'image_count')::INTEGER as stored_image_count,
  COUNT(vi.id) as actual_image_count,
  v.discovery_url,
  v.created_at
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
WHERE v.origin_metadata->'image_urls' IS NOT NULL
  AND v.origin_metadata->'image_urls' != '[]'::jsonb
  AND (v.origin_metadata->>'image_count')::INTEGER > 0
GROUP BY v.id, v.make, v.model, v.year, v.origin_metadata, v.discovery_url, v.created_at
HAVING COUNT(vi.id) = 0
ORDER BY v.created_at DESC
LIMIT 100;

-- ============================================
-- QUERY: Success Rate by Step (Last 7 Days)
-- ============================================
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_imports,
  
  -- VIN extraction success rate
  COUNT(*) FILTER (WHERE vin IS NOT NULL) as with_vin,
  ROUND(100.0 * COUNT(*) FILTER (WHERE vin IS NOT NULL) / COUNT(*), 1) as vin_success_rate,
  
  -- Price extraction success rate
  COUNT(*) FILTER (WHERE sale_price IS NOT NULL) as with_price,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sale_price IS NOT NULL) / COUNT(*), 1) as price_success_rate,
  
  -- Image URL extraction success rate
  COUNT(*) FILTER (WHERE origin_metadata->'image_urls' IS NOT NULL 
                    AND origin_metadata->'image_urls' != '[]'::jsonb) as with_image_urls,
  ROUND(100.0 * COUNT(*) FILTER (WHERE origin_metadata->'image_urls' IS NOT NULL 
                                   AND origin_metadata->'image_urls' != '[]'::jsonb) / COUNT(*), 1) as image_urls_success_rate,
  
  -- Image download success rate (vehicles with URLs that got downloaded)
  COUNT(*) FILTER (WHERE origin_metadata->'image_urls' IS NOT NULL 
                    AND origin_metadata->'image_urls' != '[]'::jsonb) as vehicles_with_urls,
  (
    SELECT COUNT(DISTINCT vehicle_id)
    FROM vehicle_images vi
    WHERE vi.vehicle_id IN (
      SELECT id FROM vehicles v2 
      WHERE DATE(v2.created_at) = DATE(vehicles.created_at)
        AND v2.origin_metadata->'image_urls' IS NOT NULL
    )
  ) as vehicles_with_downloaded_images,
  ROUND(100.0 * (
    SELECT COUNT(DISTINCT vehicle_id)
    FROM vehicle_images vi
    WHERE vi.vehicle_id IN (
      SELECT id FROM vehicles v2 
      WHERE DATE(v2.created_at) = DATE(vehicles.created_at)
        AND v2.origin_metadata->'image_urls' IS NOT NULL
    )
  ) / NULLIF(COUNT(*) FILTER (WHERE origin_metadata->'image_urls' IS NOT NULL 
                                AND origin_metadata->'image_urls' != '[]'::jsonb), 0), 1) as image_download_success_rate

FROM vehicles
WHERE (origin_metadata->>'source' = 'bringatrailer.com'
   OR discovery_url LIKE '%bringatrailer.com%')
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

