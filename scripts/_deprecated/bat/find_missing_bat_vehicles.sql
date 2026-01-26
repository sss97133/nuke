-- Find Missing BAT Vehicles for Viva! Las Vegas Autos
-- Should be ~53 BAT profiles, currently only 1 is linked

-- Strategy:
-- 1. Vehicles with bat_seller mentioning Viva
-- 2. Vehicles with discovery_url from bringatrailer.com
-- 3. Vehicles created in bulk batches (likely BAT imports)
-- 4. Vehicles uploaded during tenure period (Jan 2024 - March 2025)

-- Query 1: Vehicles with BAT seller = Viva
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.bat_seller,
  v.bat_listing_title,
  v.discovery_url,
  v.created_at
FROM vehicles v
LEFT JOIN organization_vehicles ov ON ov.vehicle_id = v.id 
  AND ov.organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
WHERE (v.bat_seller ILIKE '%viva%' OR v.bat_seller ILIKE '%vivalasvegas%')
  AND ov.id IS NULL;

-- Query 2: Vehicles from BAT during tenure period
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.discovery_source,
  v.discovery_url,
  v.bat_listing_title,
  v.created_at
FROM vehicles v
LEFT JOIN organization_vehicles ov ON ov.vehicle_id = v.id 
  AND ov.organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
WHERE (v.discovery_source ILIKE '%bat%' OR v.discovery_url ILIKE '%bringatrailer%')
  AND v.created_at >= '2024-01-01'
  AND v.created_at <= '2025-03-31'
  AND ov.id IS NULL;

-- Query 3: Bulk import batches (likely BAT)
SELECT 
  DATE(created_at) as import_date,
  COUNT(*) as vehicle_count,
  STRING_AGG(DISTINCT discovery_source, ', ') as sources,
  STRING_AGG(DISTINCT bat_seller, ', ') as sellers
FROM vehicles
WHERE uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND created_at >= '2024-01-01'
  AND created_at <= '2025-03-31'
GROUP BY DATE(created_at)
HAVING COUNT(*) > 5
ORDER BY import_date DESC;

-- Query 4: Link all vehicles uploaded during tenure that aren't linked
INSERT INTO organization_vehicles (
  organization_id,
  vehicle_id,
  relationship_type,
  status,
  start_date,
  end_date,
  auto_tagged,
  linked_by_user_id
)
SELECT 
  'c433d27e-2159-4f8c-b4ae-32a5e44a77cf',
  v.id,
  CASE 
    WHEN v.profile_origin = 'bat_import' THEN 'consigner'
    WHEN v.profile_origin = 'dropbox_import' THEN 'owner'
    WHEN v.discovery_source ILIKE '%bat%' THEN 'consigner'
    ELSE 'collaborator'
  END,
  'active',
  '2024-01-01',
  '2025-03-31',
  true,
  v.uploaded_by
FROM vehicles v
WHERE v.uploaded_by = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND v.created_at >= '2024-01-01'
  AND v.created_at <= '2025-03-31'
  AND NOT EXISTS (
    SELECT 1 FROM organization_vehicles ov
    WHERE ov.organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
      AND ov.vehicle_id = v.id
      AND ov.status = 'active'
  )
ON CONFLICT DO NOTHING;

