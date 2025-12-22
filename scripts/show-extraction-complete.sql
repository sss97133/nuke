-- Complete SQL query to show PCarMarket extraction results
-- Vehicle ID: e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8

-- Main vehicle data with all extracted fields
SELECT
  -- Basic Info
  v.id,
  v.year,
  v.make,
  v.model,
  v.trim,
  v.vin,
  v.mileage,
  
  -- Auction Data
  v.sale_price,
  v.sale_date,
  v.auction_outcome,
  
  -- Origin Tracking
  v.profile_origin,
  v.discovery_source,
  v.discovery_url,
  v.listing_url,
  
  -- Metadata (JSONB - shows all PCarMarket-specific data)
  v.origin_metadata,
  
  -- Image Count
  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
  
  -- Organization Info
  b.business_name as organization_name,
  b.website as organization_website,
  ov.relationship_type,
  ov.listing_status as org_listing_status,
  
  -- Timestamps
  v.created_at,
  v.updated_at

FROM vehicles v
LEFT JOIN organization_vehicles ov ON v.id = ov.vehicle_id
LEFT JOIN businesses b ON ov.organization_id = b.id
WHERE v.id = 'e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8';

-- Show all images
SELECT 
  vi.id,
  vi.image_url,
  vi.is_primary,
  vi.category,
  vi.source,
  vi.filename
FROM vehicle_images vi
WHERE vi.vehicle_id = 'e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8'
ORDER BY vi.is_primary DESC, vi.created_at ASC;

-- Show organization link details
SELECT
  ov.relationship_type,
  ov.listing_status,
  ov.listing_url,
  ov.auto_tagged,
  b.business_name,
  b.website
FROM organization_vehicles ov
JOIN businesses b ON ov.organization_id = b.id
WHERE ov.vehicle_id = 'e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8';

