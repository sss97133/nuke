-- Diagnose vehicle 992fb704-85d4-4358-9631-8f11fe9b5f47 (wrong lead image, missing VIN)
-- Run in Supabase SQL Editor or: psql $DATABASE_URL -f data/sql/diagnose_vehicle_992fb704.sql

-- 1) Vehicle row: vin, primary_image_url, discovery_url, origin
SELECT
  id,
  year,
  make,
  model,
  vin,
  primary_image_url,
  image_url,
  discovery_url,
  profile_origin,
  bat_auction_url,
  origin_metadata IS NOT NULL AS has_origin_metadata,
  (origin_metadata->>'vin') AS origin_vin,
  (origin_metadata->'image_urls') IS NOT NULL AS has_origin_image_urls
FROM vehicles
WHERE id = '992fb704-85d4-4358-9631-8f11fe9b5f47';

-- 2) vehicle_images: is_primary, position, storage_path (wrong lead = wrong is_primary or storage_path for another vehicle)
SELECT
  vi.id,
  vi.vehicle_id,
  vi.is_primary,
  vi.position,
  vi.source,
  LEFT(vi.storage_path::text, 80) AS storage_path_preview,
  LEFT(vi.image_url, 100) AS image_url_preview,
  vi.created_at
FROM vehicle_images vi
WHERE vi.vehicle_id = '992fb704-85d4-4358-9631-8f11fe9b5f47'
  AND COALESCE(vi.is_document, false) = false
  AND COALESCE(vi.is_duplicate, false) = false
ORDER BY vi.is_primary DESC, vi.position ASC NULLS LAST, vi.created_at ASC
LIMIT 25;

-- 3) Check for mismatched storage_path (path contains a different vehicle UUID = wrong image)
SELECT
  vi.id,
  vi.is_primary,
  vi.storage_path,
  vi.image_url
FROM vehicle_images vi
WHERE vi.vehicle_id = '992fb704-85d4-4358-9631-8f11fe9b5f47'
  AND vi.storage_path IS NOT NULL
  AND vi.storage_path::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  AND vi.storage_path::text NOT LIKE '%992fb704-85d4-4358-9631-8f11fe9b5f47%';

-- 4) BaT listing link (for VIN re-extraction URL)
SELECT
  bl.id,
  bl.vehicle_id,
  bl.bat_listing_url,
  bl.raw_data->>'vin' AS raw_vin
FROM bat_listings bl
WHERE bl.vehicle_id = '992fb704-85d4-4358-9631-8f11fe9b5f47'
LIMIT 1;
