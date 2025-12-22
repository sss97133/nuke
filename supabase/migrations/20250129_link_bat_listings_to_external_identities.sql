-- ==========================================================================
-- LINK BaT LISTINGS TO EXTERNAL IDENTITIES
-- ==========================================================================
-- Purpose: Link bat_listings seller/buyer to external_identities
--          This enables tracking which users sold/bought vehicles
-- ==========================================================================

-- Link sellers
UPDATE bat_listings bl
SET seller_external_identity_id = ei.id
FROM external_identities ei
WHERE ei.platform = 'bat'
  AND ei.handle = bl.seller_username
  AND bl.seller_external_identity_id IS NULL
  AND bl.seller_username IS NOT NULL;

-- Link buyers
UPDATE bat_listings bl
SET buyer_external_identity_id = ei.id
FROM external_identities ei
WHERE ei.platform = 'bat'
  AND ei.handle = bl.buyer_username
  AND bl.buyer_external_identity_id IS NULL
  AND bl.buyer_username IS NOT NULL;

-- Verify the update
SELECT 
  COUNT(*) as total_listings,
  COUNT(CASE WHEN seller_external_identity_id IS NOT NULL THEN 1 END) as listings_with_seller_identity,
  COUNT(CASE WHEN buyer_external_identity_id IS NOT NULL THEN 1 END) as listings_with_buyer_identity
FROM bat_listings;

