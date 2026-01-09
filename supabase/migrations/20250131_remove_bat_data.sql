-- ==========================================================================
-- REMOVE BaT DATA FROM DATABASE
-- ==========================================================================
-- Purpose: Remove all Bring a Trailer (BaT) related data from the database
-- This includes:
--   - BaT comments (bat_comments, auction_comments with platform='bat')
--   - BaT listings (bat_listings)
--   - BaT imported listing descriptions (extraction_metadata)
--   - BaT seller badges (organization_vehicles with BaT-related orgs)
--   - BaT-related vehicle metadata (origin_metadata.bat_seller, discovery_url)
-- ==========================================================================

-- Option 1: Remove BaT data for a specific vehicle
-- Uncomment and set the vehicle_id if you want to target a specific vehicle
-- DO $$
-- DECLARE
--   target_vehicle_id UUID := '83f6f033-a3c3-4cf4-a85e-a60d2c588838';
-- BEGIN

-- Option 2: Remove BaT data for ALL vehicles (default)
-- This will remove all BaT data from the entire database

-- ==========================================================================
-- 1. DELETE BaT COMMENTS
-- ==========================================================================

-- Delete from bat_comments table
DELETE FROM bat_comments
WHERE vehicle_id IN (
  SELECT id FROM vehicles 
  WHERE profile_origin = 'bat_import' 
     OR discovery_url ILIKE '%bringatrailer.com%'
     OR (origin_metadata->>'bat_seller') IS NOT NULL
);

-- Delete from auction_comments where platform is 'bat'
DELETE FROM auction_comments
WHERE platform = 'bat' 
   OR platform = 'bringatrailer'
   OR (platform IS NULL AND vehicle_id IN (
     SELECT id FROM vehicles 
     WHERE profile_origin = 'bat_import' 
        OR discovery_url ILIKE '%bringatrailer.com%'
   ));

-- ==========================================================================
-- 2. DELETE BaT LISTINGS
-- ==========================================================================

DELETE FROM bat_listings
WHERE vehicle_id IN (
  SELECT id FROM vehicles 
  WHERE profile_origin = 'bat_import' 
     OR discovery_url ILIKE '%bringatrailer.com%'
     OR (origin_metadata->>'bat_seller') IS NOT NULL
)
OR bat_listing_url ILIKE '%bringatrailer.com%';

-- ==========================================================================
-- 3. DELETE BaT IMPORTED LISTING DESCRIPTIONS
-- ==========================================================================

DELETE FROM extraction_metadata
WHERE field_name = 'raw_listing_description'
  AND (
    source_url ILIKE '%bringatrailer.com%'
    OR vehicle_id IN (
      SELECT id FROM vehicles 
      WHERE profile_origin = 'bat_import' 
         OR discovery_url ILIKE '%bringatrailer.com%'
    )
  );

-- ==========================================================================
-- 4. DELETE BaT SELLER BADGES (organization_vehicles)
-- ==========================================================================

-- Delete organization_vehicles links where the organization is BaT-related
-- or where the relationship was created from BaT data
DELETE FROM organization_vehicles
WHERE vehicle_id IN (
  SELECT id FROM vehicles 
  WHERE profile_origin = 'bat_import' 
     OR discovery_url ILIKE '%bringatrailer.com%'
     OR (origin_metadata->>'bat_seller') IS NOT NULL
)
AND (
  -- BaT-related organizations (check business_name for BaT keywords)
  organization_id IN (
    SELECT id FROM businesses 
    WHERE business_name ILIKE '%bring a trailer%'
       OR business_name ILIKE '%bat%'
       OR website ILIKE '%bringatrailer.com%'
  )
  -- Or relationship was auto-tagged from BaT
  OR (auto_tagged = true AND relationship_type IN ('seller', 'consigner', 'sold_by'))
);

-- ==========================================================================
-- 5. CLEAN BaT DATA FROM VEHICLES TABLE
-- ==========================================================================

-- Remove BaT seller info from origin_metadata
UPDATE vehicles
SET origin_metadata = origin_metadata - 'bat_seller' - 'bat_listing_title' - 'bat_location'
WHERE origin_metadata ? 'bat_seller'
   OR origin_metadata ? 'bat_listing_title';

-- Clear BaT discovery URLs (but keep the vehicle)
UPDATE vehicles
SET discovery_url = NULL
WHERE discovery_url ILIKE '%bringatrailer.com%'
  AND profile_origin = 'bat_import';

-- Clear BaT auction URLs
UPDATE vehicles
SET bat_auction_url = NULL
WHERE bat_auction_url IS NOT NULL;

-- Clear BaT seller field (if it exists as a direct column)
UPDATE vehicles
SET bat_seller = NULL
WHERE bat_seller IS NOT NULL;

-- Clear BaT listing title (if it exists as a direct column)
UPDATE vehicles
SET bat_listing_title = NULL
WHERE bat_listing_title IS NOT NULL;

-- Remove BaT profile origin (but keep the vehicle)
UPDATE vehicles
SET profile_origin = NULL
WHERE profile_origin = 'bat_import';

-- ==========================================================================
-- 6. DELETE BaT IMAGES (optional - uncomment if you want to remove images too)
-- ==========================================================================

-- Uncomment these if you also want to remove BaT-imported images
-- DELETE FROM vehicle_images
-- WHERE source = 'bat_import'
--    OR source = 'bat_listing'
--    OR (source IS NULL AND vehicle_id IN (
--      SELECT id FROM vehicles 
--      WHERE profile_origin = 'bat_import' 
--         OR discovery_url ILIKE '%bringatrailer.com%'
--    ));

-- ==========================================================================
-- 7. CLEAN UP BaT EXTERNAL IDENTITIES (optional)
-- ==========================================================================

-- Only delete BaT external identities that are NOT claimed by users
-- This preserves user-claimed identities
-- DELETE FROM external_identities
-- WHERE platform = 'bat'
--   AND claimed_by_user_id IS NULL;

-- ==========================================================================
-- END
-- ==========================================================================

-- If using Option 1 (specific vehicle), uncomment this:
-- END $$;

