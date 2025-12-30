-- ============================================================
-- BaT Data Quality Assessment
-- Run this to understand what's working vs broken
-- ============================================================

-- 1. OVERALL BaT VEHICLE COMPLETENESS
-- ============================================================
SELECT 
  '=== BaT Vehicle Completeness Overview ===' as section,
  COUNT(*) as total_bat_vehicles,
  COUNT(CASE WHEN bat_auction_url IS NOT NULL OR discovery_url ILIKE '%bringatrailer%' THEN 1 END) as has_bat_url,
  COUNT(CASE WHEN description IS NOT NULL AND LENGTH(description) > 80 THEN 1 END) as has_description,
  COUNT(CASE WHEN vin IS NOT NULL THEN 1 END) as has_vin,
  COUNT(CASE WHEN sale_price IS NOT NULL THEN 1 END) as has_sale_price,
  COUNT(CASE WHEN auction_end_date IS NOT NULL THEN 1 END) as has_auction_end_date,
  COUNT(CASE WHEN bat_comments IS NOT NULL THEN 1 END) as has_comment_count,
  COUNT(CASE WHEN origin_metadata->'bat_features' IS NOT NULL 
             AND origin_metadata->'bat_features' != '[]'::jsonb THEN 1 END) as has_features,
  COUNT(CASE WHEN bat_bids IS NOT NULL THEN 1 END) as has_bid_count,
  COUNT(CASE WHEN bat_views IS NOT NULL THEN 1 END) as has_view_count,
  COUNT(CASE WHEN bat_seller IS NOT NULL THEN 1 END) as has_seller,
  COUNT(CASE WHEN bat_location IS NOT NULL THEN 1 END) as has_location
FROM vehicles
WHERE bat_auction_url IS NOT NULL 
   OR discovery_url ILIKE '%bringatrailer.com%'
   OR profile_origin = 'bat_import';

-- 2. IMAGE COMPLETENESS
-- ============================================================
SELECT 
  '=== Image Completeness ===' as section,
  COUNT(DISTINCT v.id) as vehicles_with_images,
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(vi.id) >= 20) as vehicles_with_20plus_images,
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(CASE WHEN vi.source = 'bat_import' THEN 1 END) > 0) as vehicles_with_bat_images,
  AVG(COUNT(vi.id)) as avg_images_per_vehicle,
  COUNT(CASE WHEN vi.image_url LIKE '%-scaled.%' OR vi.image_url LIKE '%resize=%' THEN 1 END) as low_res_images
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE v.bat_auction_url IS NOT NULL 
   OR v.discovery_url ILIKE '%bringatrailer.com%'
GROUP BY v.id;

-- 3. COMMENTS & BIDS COMPLETENESS
-- ============================================================
SELECT 
  '=== Comments & Bids Completeness ===' as section,
  COUNT(DISTINCT v.id) as total_bat_vehicles,
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(ac.id) > 0) as vehicles_with_comments,
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(CASE WHEN ac.bid_amount IS NOT NULL THEN 1 END) > 0) as vehicles_with_bids,
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(CASE WHEN ac.content_hash IS NOT NULL THEN 1 END) = COUNT(ac.id)) as vehicles_with_proper_dedupe,
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(CASE WHEN ac.auction_event_id IS NOT NULL THEN 1 END) = COUNT(ac.id)) as vehicles_with_linked_events,
  AVG(COUNT(ac.id)) as avg_comments_per_vehicle,
  AVG(COUNT(CASE WHEN ac.bid_amount IS NOT NULL THEN 1 END)) as avg_bids_per_vehicle
FROM vehicles v
LEFT JOIN auction_comments ac ON ac.vehicle_id = v.id
WHERE v.bat_auction_url IS NOT NULL 
   OR v.discovery_url ILIKE '%bringatrailer.com%'
GROUP BY v.id;

-- 4. AUCTION EVENTS COVERAGE
-- ============================================================
SELECT 
  '=== Auction Events Coverage ===' as section,
  COUNT(DISTINCT v.id) as vehicles_with_bat_url,
  COUNT(DISTINCT ae.id) as vehicles_with_auction_event,
  COUNT(DISTINCT v.id) - COUNT(DISTINCT ae.id) as missing_auction_events,
  ROUND(100.0 * COUNT(DISTINCT ae.id) / NULLIF(COUNT(DISTINCT v.id), 0), 2) as coverage_pct
FROM vehicles v
LEFT JOIN auction_events ae ON ae.vehicle_id = v.id AND ae.platform = 'bat'
WHERE v.bat_auction_url IS NOT NULL 
   OR v.discovery_url ILIKE '%bringatrailer.com%';

-- 5. EXTERNAL LISTINGS COVERAGE
-- ============================================================
SELECT 
  '=== External Listings Coverage ===' as section,
  COUNT(DISTINCT v.id) as vehicles_with_bat_url,
  COUNT(DISTINCT el.id) as vehicles_with_external_listing,
  COUNT(DISTINCT v.id) - COUNT(DISTINCT el.id) as missing_external_listings,
  ROUND(100.0 * COUNT(DISTINCT el.id) / NULLIF(COUNT(DISTINCT v.id), 0), 2) as coverage_pct
FROM vehicles v
LEFT JOIN external_listings el ON el.vehicle_id = v.id AND el.platform = 'bat'
WHERE v.bat_auction_url IS NOT NULL 
   OR v.discovery_url ILIKE '%bringatrailer.com%';

-- 6. DATA QUALITY ISSUES SUMMARY
-- ============================================================
SELECT 
  '=== Data Quality Issues ===' as section,
  issue,
  count,
  ROUND(100.0 * count / NULLIF((SELECT COUNT(*) FROM vehicles WHERE bat_auction_url IS NOT NULL OR discovery_url ILIKE '%bringatrailer.com%'), 0), 2) as pct_of_total
FROM (
  SELECT 
    'Missing VIN' as issue,
    COUNT(*) as count
  FROM vehicles
  WHERE (bat_auction_url IS NOT NULL OR discovery_url ILIKE '%bringatrailer.com%')
    AND vin IS NULL
  
  UNION ALL
  
  SELECT 
    'Missing Description',
    COUNT(*)
  FROM vehicles
  WHERE (bat_auction_url IS NOT NULL OR discovery_url ILIKE '%bringatrailer.com%')
    AND (description IS NULL OR LENGTH(description) < 80)
  
  UNION ALL
  
  SELECT 
    'Missing Images',
    COUNT(*)
  FROM vehicles v
  WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ILIKE '%bringatrailer.com%')
    AND NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)
  
  UNION ALL
  
  SELECT 
    'Missing Comments',
    COUNT(*)
  FROM vehicles v
  WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ILIKE '%bringatrailer.com%')
    AND NOT EXISTS (SELECT 1 FROM auction_comments ac WHERE ac.vehicle_id = v.id)
  
  UNION ALL
  
  SELECT 
    'Missing Auction Event',
    COUNT(*)
  FROM vehicles v
  WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ILIKE '%bringatrailer.com%')
    AND NOT EXISTS (SELECT 1 FROM auction_events ae WHERE ae.vehicle_id = v.id AND ae.platform = 'bat')
  
  UNION ALL
  
  SELECT 
    'Missing External Listing',
    COUNT(*)
  FROM vehicles v
  WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ILIKE '%bringatrailer.com%')
    AND NOT EXISTS (SELECT 1 FROM external_listings el WHERE el.vehicle_id = v.id AND el.platform = 'bat')
  
  UNION ALL
  
  SELECT 
    'Missing Comment Count',
    COUNT(*)
  FROM vehicles
  WHERE (bat_auction_url IS NOT NULL OR discovery_url ILIKE '%bringatrailer.com%')
    AND bat_comments IS NULL
  
  UNION ALL
  
  SELECT 
    'Missing Features',
    COUNT(*)
  FROM vehicles
  WHERE (bat_auction_url IS NOT NULL OR discovery_url ILIKE '%bringatrailer.com%')
    AND (origin_metadata->'bat_features' IS NULL OR origin_metadata->'bat_features' = '[]'::jsonb)
  
  UNION ALL
  
  SELECT 
    'Comments Without Content Hash',
    COUNT(DISTINCT ac.vehicle_id)
  FROM auction_comments ac
  JOIN vehicles v ON v.id = ac.vehicle_id
  WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ILIKE '%bringatrailer.com%')
    AND ac.content_hash IS NULL
  
  UNION ALL
  
  SELECT 
    'Comments Without Auction Event',
    COUNT(DISTINCT ac.vehicle_id)
  FROM auction_comments ac
  JOIN vehicles v ON v.id = ac.vehicle_id
  WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ILIKE '%bringatrailer.com%')
    AND ac.auction_event_id IS NULL
) issues
ORDER BY count DESC;

-- 7. COMMENT COUNT MISMATCHES (stored vs actual)
-- ============================================================
SELECT 
  '=== Comment Count Mismatches ===' as section,
  v.id,
  v.year,
  v.make,
  v.model,
  v.bat_comments as stored_count,
  COUNT(ac.id) as actual_count,
  COUNT(ac.id) - COALESCE(v.bat_comments, 0) as difference
FROM vehicles v
LEFT JOIN auction_comments ac ON ac.vehicle_id = v.id
WHERE (v.bat_auction_url IS NOT NULL OR v.discovery_url ILIKE '%bringatrailer.com%')
  AND (v.bat_comments IS NULL OR v.bat_comments != COUNT(ac.id))
GROUP BY v.id, v.year, v.make, v.model, v.bat_comments
HAVING COUNT(ac.id) != COALESCE(v.bat_comments, 0)
ORDER BY ABS(COUNT(ac.id) - COALESCE(v.bat_comments, 0)) DESC
LIMIT 20;

