-- ============================================================================
-- Check Missing Profile Data - See What's Missing from "Complete" Profiles
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. OVERVIEW: Vehicles from Complete Queue Items
-- ============================================================================
SELECT 
  'Total Complete Profiles' as metric,
  COUNT(*) as count
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
UNION ALL
SELECT 
  'With VIN',
  COUNT(*)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND v.vin IS NOT NULL AND v.vin != ''
UNION ALL
SELECT 
  'With Mileage',
  COUNT(*)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND v.mileage IS NOT NULL
UNION ALL
SELECT 
  'With Images',
  COUNT(DISTINCT v.id)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
INNER JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE q.status = 'complete'
UNION ALL
SELECT 
  'With Comments',
  COUNT(DISTINCT v.id)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
INNER JOIN auction_comments ac ON ac.vehicle_id = v.id
WHERE q.status = 'complete';

-- 2. DETAILED: What's Missing from Each Profile
-- ============================================================================
SELECT 
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  q.bat_url,
  CASE WHEN v.vin IS NULL OR v.vin = '' THEN '❌' ELSE '✅' END as has_vin,
  CASE WHEN v.mileage IS NULL THEN '❌' ELSE '✅' END as has_mileage,
  CASE WHEN v.color IS NULL OR v.color = '' THEN '❌' ELSE '✅' END as has_color,
  CASE WHEN v.transmission IS NULL OR v.transmission = '' THEN '❌' ELSE '✅' END as has_transmission,
  CASE WHEN v.engine IS NULL OR v.engine = '' THEN '❌' ELSE '✅' END as has_engine,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  (SELECT COUNT(*) FROM auction_comments WHERE vehicle_id = v.id) as comment_count,
  CASE 
    WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0 THEN '❌ No Images'
    WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) < 10 THEN '⚠️ Few Images'
    ELSE '✅ Has Images'
  END as images_status
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
ORDER BY 
  CASE 
    WHEN v.vin IS NULL OR v.vin = '' THEN 1
    WHEN v.mileage IS NULL THEN 2
    WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0 THEN 3
    WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) < 10 THEN 4
    ELSE 5
  END,
  v.created_at DESC
LIMIT 50;

-- 3. MISSING DATA SUMMARY: Count What's Missing
-- ============================================================================
SELECT 
  'Missing VIN' as missing_field,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1) as percentage
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND (v.vin IS NULL OR v.vin = '')
UNION ALL
SELECT 
  'Missing Mileage',
  COUNT(*),
  ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND v.mileage IS NULL
UNION ALL
SELECT 
  'Missing Color',
  COUNT(*),
  ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND (v.color IS NULL OR v.color = '')
UNION ALL
SELECT 
  'Missing Transmission',
  COUNT(*),
  ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND (v.transmission IS NULL OR v.transmission = '')
UNION ALL
SELECT 
  'Missing Engine',
  COUNT(*),
  ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND (v.engine IS NULL OR v.engine = '')
UNION ALL
SELECT 
  'No Images',
  COUNT(DISTINCT v.id),
  ROUND(COUNT(DISTINCT v.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND NOT EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id = v.id)
UNION ALL
SELECT 
  'Few Images (<10)',
  COUNT(DISTINCT v.id),
  ROUND(COUNT(DISTINCT v.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) < 10
  AND (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) > 0
UNION ALL
SELECT 
  'No Comments',
  COUNT(DISTINCT v.id),
  ROUND(COUNT(DISTINCT v.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = 'complete'), 0), 1)
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND NOT EXISTS (SELECT 1 FROM auction_comments WHERE vehicle_id = v.id)
ORDER BY count DESC;

-- 4. WORST PROFILES: Most Missing Data (Prioritize Fixing These)
-- ============================================================================
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  q.bat_url,
  (
    CASE WHEN v.vin IS NULL OR v.vin = '' THEN 1 ELSE 0 END +
    CASE WHEN v.mileage IS NULL THEN 1 ELSE 0 END +
    CASE WHEN v.color IS NULL OR v.color = '' THEN 1 ELSE 0 END +
    CASE WHEN v.transmission IS NULL OR v.transmission = '' THEN 1 ELSE 0 END +
    CASE WHEN v.engine IS NULL OR v.engine = '' THEN 1 ELSE 0 END +
    CASE WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0 THEN 3 ELSE 
      CASE WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) < 10 THEN 1 ELSE 0 END
    END +
    CASE WHEN NOT EXISTS (SELECT 1 FROM auction_comments WHERE vehicle_id = v.id) THEN 1 ELSE 0 END
  ) as missing_fields_count,
  CASE WHEN v.vin IS NULL OR v.vin = '' THEN 'VIN, ' ELSE '' END ||
  CASE WHEN v.mileage IS NULL THEN 'Mileage, ' ELSE '' END ||
  CASE WHEN v.color IS NULL OR v.color = '' THEN 'Color, ' ELSE '' END ||
  CASE WHEN v.transmission IS NULL OR v.transmission = '' THEN 'Transmission, ' ELSE '' END ||
  CASE WHEN v.engine IS NULL OR v.engine = '' THEN 'Engine, ' ELSE '' END ||
  CASE WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) = 0 THEN 'No Images, ' 
       WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) < 10 THEN 'Few Images, ' 
       ELSE '' END ||
  CASE WHEN NOT EXISTS (SELECT 1 FROM auction_comments WHERE vehicle_id = v.id) THEN 'No Comments' ELSE '' END
  as missing_fields
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
ORDER BY missing_fields_count DESC
LIMIT 30;

-- 5. BEST PROFILES: Complete with All Data (Reference for Quality)
-- ============================================================================
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.vin,
  v.mileage,
  v.color,
  v.transmission,
  v.engine,
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  (SELECT COUNT(*) FROM auction_comments WHERE vehicle_id = v.id) as comment_count,
  q.bat_url
FROM vehicles v
INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id
WHERE q.status = 'complete'
  AND v.vin IS NOT NULL AND v.vin != ''
  AND v.mileage IS NOT NULL
  AND v.color IS NOT NULL AND v.color != ''
  AND v.transmission IS NOT NULL AND v.transmission != ''
  AND v.engine IS NOT NULL AND v.engine != ''
  AND (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) >= 10
  AND EXISTS (SELECT 1 FROM auction_comments WHERE vehicle_id = v.id)
ORDER BY v.created_at DESC
LIMIT 20;

