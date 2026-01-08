-- Cleanup script: Remove BAT (Bring a Trailer) data from a vehicle that shouldn't have it
-- This is a ONE-OFF cleanup for a specific vehicle with contaminated BAT data
--
-- This removes:
-- 1. BAT listings linked to the vehicle (external_listings where platform='bat')
-- 2. BAT comments/bids linked to the vehicle (auction_comments and bat_comments)
-- 3. Clears BAT-specific fields from the vehicle record
-- 4. Fixes bad organization data (description in business_name field)

-- SET THIS TO YOUR VEHICLE ID
DO $$
DECLARE
  v_vehicle_id UUID := 'YOUR_VEHICLE_ID_HERE'; -- REPLACE THIS
  deleted_external_listings INT := 0;
  deleted_auction_comments INT := 0;
  deleted_bat_comments INT := 0;
  fixed_orgs INT := 0;
BEGIN
  -- 1. Delete external_listings where platform is 'bat'
  DELETE FROM external_listings
  WHERE vehicle_id = v_vehicle_id
    AND (platform = 'bat' OR listing_url LIKE '%bringatrailer.com%');
  
  GET DIAGNOSTICS deleted_external_listings = ROW_COUNT;
  
  -- 2. Delete auction_comments from BAT listings
  DELETE FROM auction_comments
  WHERE vehicle_id = v_vehicle_id
    AND (listing_url LIKE '%bringatrailer.com%' OR platform = 'bat' OR source = 'bat');
  
  GET DIAGNOSTICS deleted_auction_comments = ROW_COUNT;
  
  -- 3. Delete bat_comments
  DELETE FROM bat_comments
  WHERE vehicle_id = v_vehicle_id;
  
  GET DIAGNOSTICS deleted_bat_comments = ROW_COUNT;
  
  -- 4. Clear BAT-specific fields from vehicle (but keep the record)
  UPDATE vehicles
  SET
    bat_auction_url = NULL,
    bat_sold_price = NULL,
    bat_sale_date = NULL,
    bat_listing_title = NULL,
    bat_seller = NULL,
    bat_location = NULL
  WHERE id = v_vehicle_id
    AND (
      bat_auction_url IS NOT NULL
      OR bat_sold_price IS NOT NULL
      OR bat_sale_date IS NOT NULL
    );
  
  -- 5. Fix organizations with description text in business_name field
  -- This fixes the "is a dealer specializing is vintage Mustangs..." issue
  -- Also fixes location data showing ":" with JSON metadata
  UPDATE businesses
  SET 
    business_name = NULL,
    city = NULL,
    state = NULL
  WHERE business_name LIKE '%is a dealer specializing%'
     OR business_name LIKE '%specializing is vintage%'
     OR business_name LIKE '%has fitted this car%'
     OR (business_name LIKE '%:%' AND business_name LIKE '%commentRatingUri%')
     OR business_name = ':'
     OR (city = ':' OR state = ':');
  
  GET DIAGNOSTICS fixed_orgs = ROW_COUNT;
  
  RAISE NOTICE 'Cleaned up BAT data for vehicle %:', v_vehicle_id;
  RAISE NOTICE '  - Deleted % external_listings rows', deleted_external_listings;
  RAISE NOTICE '  - Deleted % auction_comments rows', deleted_auction_comments;
  RAISE NOTICE '  - Deleted % bat_comments rows', deleted_bat_comments;
  RAISE NOTICE '  - Cleared BAT fields from vehicle record';
  RAISE NOTICE '  - Fixed % organizations with bad business_name data', fixed_orgs;
  
  -- Verify cleanup
  SELECT COUNT(*) INTO deleted_external_listings
  FROM external_listings
  WHERE vehicle_id = v_vehicle_id
    AND (platform = 'bat' OR listing_url LIKE '%bringatrailer.com%');
  
  SELECT COUNT(*) INTO deleted_auction_comments
  FROM auction_comments
  WHERE vehicle_id = v_vehicle_id
    AND (listing_url LIKE '%bringatrailer.com%' OR platform = 'bat' OR source = 'bat');
  
  SELECT COUNT(*) INTO deleted_bat_comments
  FROM bat_comments
  WHERE vehicle_id = v_vehicle_id;
  
  IF deleted_external_listings = 0 AND deleted_auction_comments = 0 AND deleted_bat_comments = 0 THEN
    RAISE NOTICE '✅ Cleanup verified: No BAT data remaining';
  ELSE
    RAISE WARNING '⚠️ Warning: % external_listings, % auction_comments, and % bat_comments still remain', 
      deleted_external_listings, deleted_auction_comments, deleted_bat_comments;
  END IF;
  
END $$;

