-- ==========================================================================
-- BACKFILL PROFILE DATA LINKS
-- ==========================================================================
-- Purpose: Ensure all bat_comments, bat_listings, and images are properly
--          linked to external_identities so they show up in user profiles
-- ==========================================================================

-- Step 1: Ensure external_identities exist for all bat_users
INSERT INTO external_identities (
  platform,
  handle,
  profile_url,
  display_name,
  first_seen_at,
  last_seen_at,
  metadata
)
SELECT DISTINCT
  'bat' as platform,
  bu.bat_username as handle,
  bu.bat_profile_url as profile_url,
  COALESCE(bu.display_name, bu.bat_username) as display_name,
  COALESCE(bu.first_seen_at, bu.created_at) as first_seen_at,
  COALESCE(bu.last_seen_at, bu.updated_at) as last_seen_at,
  COALESCE(bu.metadata, '{}'::jsonb) as metadata
FROM bat_users bu
WHERE NOT EXISTS (
  SELECT 1 FROM external_identities ei
  WHERE ei.platform = 'bat'
    AND ei.handle = bu.bat_username
)
ON CONFLICT (platform, handle)
DO UPDATE SET
  profile_url = COALESCE(external_identities.profile_url, EXCLUDED.profile_url),
  display_name = COALESCE(external_identities.display_name, EXCLUDED.display_name),
  first_seen_at = LEAST(external_identities.first_seen_at, EXCLUDED.first_seen_at),
  last_seen_at = GREATEST(external_identities.last_seen_at, EXCLUDED.last_seen_at),
  updated_at = NOW();

-- Step 2: Link bat_comments to external_identities
UPDATE bat_comments bc
SET external_identity_id = ei.id
FROM external_identities ei
WHERE ei.platform = 'bat'
  AND ei.handle = bc.bat_username
  AND bc.external_identity_id IS NULL
  AND bc.bat_username IS NOT NULL;

-- Step 3: Link bat_listings sellers to external_identities
UPDATE bat_listings bl
SET seller_external_identity_id = ei.id
FROM external_identities ei
WHERE ei.platform = 'bat'
  AND ei.handle = bl.seller_username
  AND bl.seller_external_identity_id IS NULL
  AND bl.seller_username IS NOT NULL;

-- Step 4: Link bat_listings buyers to external_identities
UPDATE bat_listings bl
SET buyer_external_identity_id = ei.id
FROM external_identities ei
WHERE ei.platform = 'bat'
  AND ei.handle = bl.buyer_username
  AND bl.buyer_external_identity_id IS NULL
  AND bl.buyer_username IS NOT NULL;

-- Step 5: Link auction_comments to external_identities (if they have author_username)
UPDATE auction_comments ac
SET external_identity_id = ei.id
FROM external_identities ei
WHERE ei.platform = 'bat'
  AND ei.handle = ac.author_username
  AND ac.external_identity_id IS NULL
  AND ac.author_username IS NOT NULL;

-- Verification queries
DO $$
DECLARE
  v_comments_total INTEGER;
  v_comments_linked INTEGER;
  v_listings_total INTEGER;
  v_listings_seller_linked INTEGER;
  v_listings_buyer_linked INTEGER;
  v_auction_comments_total INTEGER;
  v_auction_comments_linked INTEGER;
BEGIN
  -- Check bat_comments
  SELECT COUNT(*), COUNT(CASE WHEN external_identity_id IS NOT NULL THEN 1 END)
  INTO v_comments_total, v_comments_linked
  FROM bat_comments;
  
  -- Check bat_listings
  SELECT COUNT(*), 
         COUNT(CASE WHEN seller_external_identity_id IS NOT NULL THEN 1 END),
         COUNT(CASE WHEN buyer_external_identity_id IS NOT NULL THEN 1 END)
  INTO v_listings_total, v_listings_seller_linked, v_listings_buyer_linked
  FROM bat_listings;
  
  -- Check auction_comments
  SELECT COUNT(*), COUNT(CASE WHEN external_identity_id IS NOT NULL THEN 1 END)
  INTO v_auction_comments_total, v_auction_comments_linked
  FROM auction_comments
  WHERE author_username IS NOT NULL;
  
  RAISE NOTICE 'Backfill Results:';
  RAISE NOTICE '  bat_comments: % total, % linked to external_identities', v_comments_total, v_comments_linked;
  RAISE NOTICE '  bat_listings: % total, % with seller linked, % with buyer linked', 
    v_listings_total, v_listings_seller_linked, v_listings_buyer_linked;
  RAISE NOTICE '  auction_comments: % total, % linked to external_identities', 
    v_auction_comments_total, v_auction_comments_linked;
END $$;

