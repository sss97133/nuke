-- ============================================================================
-- HILLBANK INVENTORY - COMPLETE DATA EXTRACTION
-- ============================================================================
-- Gets ALL vehicle data: counts, URLs, prices, Y/M/M, descriptions, images
-- ============================================================================

-- 1. INVENTORY COUNTS (For Sale vs Sold)
-- ============================================================================
SELECT 
  COALESCE(ov.listing_status, 'unknown') as status,
  COUNT(*) as vehicle_count,
  SUM(ov.asking_price) FILTER (WHERE ov.asking_price IS NOT NULL) as total_asking_price,
  AVG(ov.asking_price) FILTER (WHERE ov.asking_price IS NOT NULL) as avg_asking_price
FROM organization_vehicles ov
WHERE ov.organization_id = '1152029f-316d-4379-80b6-e74706700490'
  AND ov.status = 'active'
GROUP BY ov.listing_status
ORDER BY vehicle_count DESC;

-- Also check sale_status from vehicles table
SELECT 
  v.sale_status,
  COUNT(*) as count
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.organization_id = '1152029f-316d-4379-80b6-e74706700490'
  AND ov.status = 'active'
GROUP BY v.sale_status;

-- ============================================================================
-- 2. ALL VEHICLE DATA (Complete Dataset)
-- ============================================================================
SELECT 
  -- Organization Vehicle ID
  ov.id as org_vehicle_id,
  
  -- Vehicle Basic Info
  v.id as vehicle_id,
  v.year,
  v.make,
  v.model,
  v.trim,
  v.vin,
  v.mileage,
  
  -- Pricing
  ov.asking_price,
  v.current_value,
  v.sale_price,
  v.sale_date,
  
  -- Status
  ov.listing_status,
  v.sale_status,
  ov.status as org_vehicle_status,
  
  -- Vehicle URL (n-zero.dev)
  CONCAT('https://n-zero.dev/vehicle/', v.id) as vehicle_url,
  
  -- External listing URL (if exists)
  COALESCE(
    (SELECT listing_url FROM external_listings el WHERE el.vehicle_id = v.id ORDER BY COALESCE(el.sold_at, el.end_date, el.updated_at) DESC NULLS LAST, el.updated_at DESC LIMIT 1),
    (SELECT url FROM vehicle_listings vl WHERE vl.vehicle_id = v.id LIMIT 1),
    v.source_url
  ) as external_url,
  
  -- Description
  v.description,
  
  -- Primary Image URL
  (SELECT image_url 
   FROM vehicle_images vi 
   WHERE vi.vehicle_id = v.id 
   ORDER BY vi.is_primary DESC NULLS LAST, vi.created_at ASC 
   LIMIT 1) as primary_image_url,
  
  -- ALL Image URLs (as JSON array)
  (
    SELECT json_agg(
      json_build_object(
        'url', image_url,
        'thumbnail_url', thumbnail_url,
        'medium_url', medium_url,
        'is_primary', is_primary,
        'created_at', created_at
      ) ORDER BY vi2.is_primary DESC NULLS LAST, vi2.created_at ASC
    )
    FROM vehicle_images vi2
    WHERE vi2.vehicle_id = v.id
  ) as all_images,
  
  -- Image Count
  (SELECT COUNT(*) FROM vehicle_images vi3 WHERE vi3.vehicle_id = v.id) as image_count,
  
  -- Timestamps
  ov.created_at as added_to_inventory_at,
  v.created_at as vehicle_created_at,
  v.updated_at as vehicle_updated_at
  
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.organization_id = '1152029f-316d-4379-80b6-e74706700490'
  AND ov.status = 'active'
ORDER BY 
  CASE ov.listing_status 
    WHEN 'in_stock' THEN 1 
    WHEN 'available' THEN 2 
    WHEN 'sold' THEN 3 
    ELSE 4 
  END,
  ov.created_at DESC;

-- ============================================================================
-- 3. SUMMARY STATISTICS
-- ============================================================================
SELECT 
  COUNT(*) as total_vehicles,
  COUNT(*) FILTER (WHERE ov.listing_status IN ('in_stock', 'available')) as for_sale_count,
  COUNT(*) FILTER (WHERE ov.listing_status = 'sold' OR v.sale_status = 'sold') as sold_count,
  COUNT(*) FILTER (WHERE ov.asking_price IS NOT NULL) as vehicles_with_price,
  SUM(ov.asking_price) FILTER (WHERE ov.asking_price IS NOT NULL) as total_asking_value,
  AVG(ov.asking_price) FILTER (WHERE ov.asking_price IS NOT NULL) as avg_asking_price,
  MIN(ov.asking_price) FILTER (WHERE ov.asking_price IS NOT NULL) as min_price,
  MAX(ov.asking_price) FILTER (WHERE ov.asking_price IS NOT NULL) as max_price,
  COUNT(DISTINCT v.make) as unique_makes,
  COUNT(DISTINCT v.year) as unique_years,
  SUM((SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id)) as total_images
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.organization_id = '1152029f-316d-4379-80b6-e74706700490'
  AND ov.status = 'active';

-- ============================================================================
-- 4. EXPORT FOR CSV/EXCEL (Simplified Flat Format)
-- ============================================================================
SELECT 
  v.year,
  v.make,
  v.model,
  v.trim,
  v.vin,
  v.mileage,
  ov.asking_price,
  ov.listing_status,
  CONCAT('https://n-zero.dev/vehicle/', v.id) as vehicle_url,
  (SELECT image_url FROM vehicle_images vi WHERE vi.vehicle_id = v.id ORDER BY vi.is_primary DESC NULLS LAST LIMIT 1) as primary_image,
  v.description,
  ov.created_at::date as added_date
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
WHERE ov.organization_id = '1152029f-316d-4379-80b6-e74706700490'
  AND ov.status = 'active'
ORDER BY ov.created_at DESC;

