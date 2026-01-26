-- Find all problematic BaT listings that need fixing
-- Run this in Supabase SQL Editor

WITH bat_vehicles AS (
  SELECT DISTINCT
    v.id as vehicle_id,
    v.year,
    v.make,
    v.model,
    v.listing_url,
    v.platform_url,
    v.discovery_url,
    v.bat_auction_url,
    v.current_bid,
    v.auction_end_date,
    v.created_at
  FROM vehicles v
  WHERE (
    v.listing_url LIKE '%bringatrailer.com%' OR
    v.platform_url LIKE '%bringatrailer.com%' OR
    v.discovery_url LIKE '%bringatrailer.com%' OR
    v.bat_auction_url LIKE '%bringatrailer.com%' OR
    v.listing_source = 'bring a trailer' OR
    v.platform_source = 'bringatrailer' OR
    v.import_source = 'bringatrailer'
  )
),
image_stats AS (
  SELECT
    vi.vehicle_id,
    COUNT(*) FILTER (WHERE vi.is_document IS NULL OR vi.is_document = false) as total_images,
    COUNT(*) FILTER (WHERE vi.source = 'bat_import') as bat_import_images,
    COUNT(*) FILTER (WHERE vi.source = 'external_import') as external_import_images,
    COUNT(*) FILTER (WHERE vi.storage_path LIKE '%import_queue%') as queue_images,
    COUNT(*) FILTER (WHERE vi.image_url LIKE '%-scaled.%' OR vi.image_url LIKE '%-150x%' OR vi.image_url LIKE '%-300x%' OR vi.image_url LIKE '%resize=%' OR vi.image_url LIKE '%w=%') as low_res_images,
    COUNT(*) FILTER (WHERE vi.image_url LIKE '%bringatrailer.com/wp-content/uploads%') as bat_hosted_images
  FROM vehicle_images vi
  WHERE vi.vehicle_id IN (SELECT vehicle_id FROM bat_vehicles)
  GROUP BY vi.vehicle_id
),
external_listing_stats AS (
  SELECT
    el.vehicle_id,
    COUNT(*) as external_listing_count,
    MAX(el.current_bid) FILTER (WHERE el.listing_status = 'active' OR el.listing_status = 'live') as active_current_bid,
    MAX(el.end_date) FILTER (WHERE el.listing_status = 'active' OR el.listing_status = 'live') as active_end_date,
    BOOL_OR(el.listing_status = 'active') as has_active_listing
  FROM external_listings el
  WHERE el.vehicle_id IN (SELECT vehicle_id FROM bat_vehicles)
    AND el.platform = 'bat'
  GROUP BY el.vehicle_id
)
SELECT
  bv.vehicle_id,
  bv.year,
  bv.make,
  bv.model,
  COALESCE(bv.listing_url, bv.platform_url, bv.discovery_url, bv.bat_auction_url) as bat_url,
  COALESCE(img.total_images, 0) as image_count,
  COALESCE(img.bat_import_images, 0) as bat_import_count,
  COALESCE(img.queue_images, 0) as queue_image_count,
  COALESCE(img.low_res_images, 0) as low_res_count,
  COALESCE(img.bat_hosted_images, 0) as bat_hosted_count,
  COALESCE(ext.external_listing_count, 0) as external_listing_count,
  ext.active_current_bid,
  ext.active_end_date,
  ext.has_active_listing,
  -- Issue flags
  CASE 
    WHEN COALESCE(img.total_images, 0) = 0 THEN 'NO_IMAGES'
    WHEN COALESCE(img.total_images, 0) <= 12 THEN 'FEW_IMAGES'
    WHEN COALESCE(img.queue_images, 0) > 0 THEN 'QUEUE_BADGES'
    WHEN COALESCE(img.low_res_images, 0) > 0 THEN 'LOW_RES_IMAGES'
    WHEN COALESCE(ext.external_listing_count, 0) = 0 AND bv.current_bid IS NULL THEN 'MISSING_AUCTION_DATA'
    WHEN ext.active_current_bid IS NULL AND ext.has_active_listing THEN 'MISSING_CURRENT_BID'
    WHEN ext.active_end_date IS NULL AND ext.has_active_listing THEN 'MISSING_END_DATE'
    ELSE 'OK'
  END as primary_issue,
  -- All issues as array
  ARRAY_REMOVE(ARRAY[
    CASE WHEN COALESCE(img.total_images, 0) = 0 THEN 'NO_IMAGES' END,
    CASE WHEN COALESCE(img.total_images, 0) > 0 AND COALESCE(img.total_images, 0) <= 12 THEN 'FEW_IMAGES' END,
    CASE WHEN COALESCE(img.queue_images, 0) > 0 THEN 'QUEUE_BADGES' END,
    CASE WHEN COALESCE(img.low_res_images, 0) > 0 THEN 'LOW_RES_IMAGES' END,
    CASE WHEN COALESCE(img.bat_import_images, 0) = 0 AND COALESCE(img.total_images, 0) > 0 THEN 'WRONG_SOURCE' END,
    CASE WHEN COALESCE(ext.external_listing_count, 0) = 0 AND bv.current_bid IS NULL THEN 'MISSING_AUCTION_DATA' END,
    CASE WHEN ext.active_current_bid IS NULL AND ext.has_active_listing THEN 'MISSING_CURRENT_BID' END,
    CASE WHEN ext.active_end_date IS NULL AND ext.has_active_listing THEN 'MISSING_END_DATE' END
  ], NULL) as all_issues,
  bv.created_at
FROM bat_vehicles bv
LEFT JOIN image_stats img ON img.vehicle_id = bv.vehicle_id
LEFT JOIN external_listing_stats ext ON ext.vehicle_id = bv.vehicle_id
ORDER BY 
  CASE 
    WHEN COALESCE(img.total_images, 0) = 0 THEN 1
    WHEN COALESCE(img.total_images, 0) <= 12 THEN 2
    WHEN COALESCE(img.queue_images, 0) > 0 THEN 3
    WHEN COALESCE(img.low_res_images, 0) > 0 THEN 4
    WHEN COALESCE(ext.external_listing_count, 0) = 0 THEN 5
    ELSE 6
  END,
  bv.created_at DESC;

