-- Fix vehicle_images attribution constraint to allow platform-specific sources
-- The old constraint only allowed: bat_import, external_import, organization_import
-- This is too restrictive - we want to track the actual source (hagerty, mecum, etc.)

ALTER TABLE vehicle_images DROP CONSTRAINT IF EXISTS vehicle_images_attribution_check;

-- New constraint: attribution via user OR specific source platform
-- Sources should match external_listings platforms for consistency
ALTER TABLE vehicle_images ADD CONSTRAINT vehicle_images_attribution_check CHECK (
  (user_id IS NOT NULL) OR
  (ghost_user_id IS NOT NULL) OR
  (imported_by IS NOT NULL) OR
  (source = ANY (ARRAY[
    -- Legacy sources
    'bat_import', 'external_import', 'organization_import', 'user_upload',
    -- Platform-specific sources (matches external_listings.platform)
    'bat', 'cars_and_bids', 'mecum', 'barrettjackson', 'russoandsteele',
    'pcarmarket', 'sbx', 'bonhams', 'rmsothebys', 'collecting_cars',
    'broad_arrow', 'gooding', 'ebay_motors', 'facebook_marketplace',
    'autotrader', 'hemmings', 'classic_com', 'craigslist', 'copart', 'iaai',
    'hagerty',
    -- Future platforms
    'motorious', 'conceptcarz', 'supercars', 'silodrome', 'bringatrailer'
  ]))
);

COMMENT ON CONSTRAINT vehicle_images_attribution_check ON vehicle_images IS
  'Images must have user attribution OR be from a known import source. Sources should match platform names for traceability. Updated 2026-01-23.';
