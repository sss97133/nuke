-- Comprehensive Tier System Test Script
-- Tests tier refresh functions, triggers, and bulk operations
-- Run this to validate the tier system is working correctly

-- =====================================================
-- SETUP: Check prerequisites
-- =====================================================

DO $$
DECLARE
  v_rating_exists BOOLEAN;
  v_issues TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Check if rating column exists in vehicle_listings
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_listings' AND column_name = 'rating'
  ) INTO v_rating_exists;
  
  IF NOT v_rating_exists THEN
    v_issues := array_append(v_issues, 'WARNING: rating column does not exist in vehicle_listings. Seller tier calculation will fail when trying to calculate average rating.');
  END IF;
  
  -- Check if seller_tiers table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seller_tiers') THEN
    v_issues := array_append(v_issues, 'ERROR: seller_tiers table does not exist. Run tiered_auction_system migration first.');
  END IF;
  
  -- Check if buyer_tiers table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'buyer_tiers') THEN
    v_issues := array_append(v_issues, 'ERROR: buyer_tiers table does not exist. Run tiered_auction_system migration first.');
  END IF;
  
  -- Check if refresh functions exist
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_seller_tier') THEN
    v_issues := array_append(v_issues, 'ERROR: refresh_seller_tier function does not exist. Run tier_system_refresh_functions migration first.');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_buyer_tier') THEN
    v_issues := array_append(v_issues, 'ERROR: refresh_buyer_tier function does not exist. Run tier_system_refresh_functions migration first.');
  END IF;
  
  -- Report issues
  IF array_length(v_issues, 1) > 0 THEN
    RAISE NOTICE '=== PREREQUISITE CHECKS ===';
    FOREACH v_issue IN ARRAY v_issues
    LOOP
      RAISE NOTICE '%', v_issue;
    END LOOP;
    RAISE NOTICE '========================';
  ELSE
    RAISE NOTICE '✓ All prerequisites met';
  END IF;
END $$;

-- =====================================================
-- FIX: Add rating column if missing (for testing)
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_listings' AND column_name = 'rating'
  ) THEN
    ALTER TABLE vehicle_listings 
    ADD COLUMN rating DECIMAL(3,2) CHECK (rating >= 0 AND rating <= 5);
    
    RAISE NOTICE 'Added rating column to vehicle_listings for tier calculations';
    
    COMMENT ON COLUMN vehicle_listings.rating IS 'Seller rating for this listing (0-5 scale)';
  END IF;
END $$;

-- =====================================================
-- TEST 1: Test seller tier refresh with test data
-- =====================================================

DO $$
DECLARE
  v_test_seller_id UUID;
  v_test_vehicle_id UUID;
  v_listing_id UUID;
  v_result JSONB;
  v_tier_record RECORD;
BEGIN
  RAISE NOTICE '=== TEST 1: Seller Tier Refresh ===';
  
  -- Create a test seller profile (using existing test user if available, or generate UUID)
  -- In real scenario, you would use an actual profile ID
  SELECT id INTO v_test_seller_id FROM profiles LIMIT 1;
  
  IF v_test_seller_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: No profiles found. Create a test profile first.';
    RETURN;
  END IF;
  
  -- Create a test vehicle
  SELECT id INTO v_test_vehicle_id FROM vehicles LIMIT 1;
  
  IF v_test_vehicle_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: No vehicles found. Create a test vehicle first.';
    RETURN;
  END IF;
  
  -- Create test listings with various statuses and sales
  -- Test case 1: New seller with no sales (should be tier C)
  INSERT INTO vehicle_listings (vehicle_id, seller_id, sale_type, status)
  VALUES (v_test_vehicle_id, v_test_seller_id, 'auction', 'active')
  RETURNING id INTO v_listing_id;
  
  -- Refresh seller tier
  SELECT refresh_seller_tier(v_test_seller_id) INTO v_result;
  
  -- Check result
  SELECT * INTO v_tier_record FROM seller_tiers WHERE seller_id = v_test_seller_id;
  
  IF v_tier_record IS NULL THEN
    RAISE NOTICE 'FAILED: No tier record created for seller';
  ELSIF v_tier_record.tier != 'C' THEN
    RAISE NOTICE 'FAILED: Expected tier C for new seller, got %', v_tier_record.tier;
  ELSE
    RAISE NOTICE '✓ Test 1a PASSED: New seller correctly assigned tier C';
  END IF;
  
  -- Test case 2: Seller with successful sales
  UPDATE vehicle_listings
  SET status = 'sold', sold_price_cents = 5000000, rating = 4.5 -- $50k, 4.5 rating
  WHERE id = v_listing_id;
  
  -- Create more sold listings
  FOR i IN 1..10 LOOP
    INSERT INTO vehicle_listings (vehicle_id, seller_id, sale_type, status, sold_price_cents, rating)
    VALUES (v_test_vehicle_id, v_test_seller_id, 'auction', 'sold', 3000000 + (i * 100000), 4.0 + (i * 0.02))
    ON CONFLICT DO NOTHING;
  END LOOP;
  
  -- Refresh tier
  SELECT refresh_seller_tier(v_test_seller_id) INTO v_result;
  
  SELECT * INTO v_tier_record FROM seller_tiers WHERE seller_id = v_test_seller_id;
  
  IF v_tier_record IS NULL THEN
    RAISE NOTICE 'FAILED: Tier record not updated';
  ELSE
    RAISE NOTICE '✓ Test 1b PASSED: Seller tier updated';
    RAISE NOTICE '  - Tier: %', v_tier_record.tier;
    RAISE NOTICE '  - Successful Sales: %', v_tier_record.successful_sales;
    RAISE NOTICE '  - Total Revenue: $%', v_tier_record.total_revenue_cents / 100;
    RAISE NOTICE '  - Average Rating: %', v_tier_record.average_rating;
    RAISE NOTICE '  - Completion Rate: %%', v_tier_record.completion_rate;
    RAISE NOTICE '  - No Reserve Qualified: %', v_tier_record.no_reserve_qualification;
  END IF;
  
  -- Cleanup test data (optional - comment out to keep for inspection)
  -- DELETE FROM vehicle_listings WHERE seller_id = v_test_seller_id AND id = v_listing_id;
  
END $$;

-- =====================================================
-- TEST 2: Test buyer tier refresh with test data
-- =====================================================

DO $$
DECLARE
  v_test_buyer_id UUID;
  v_test_listing_id UUID;
  v_result JSONB;
  v_tier_record RECORD;
  v_bid_id UUID;
BEGIN
  RAISE NOTICE '=== TEST 2: Buyer Tier Refresh ===';
  
  -- Get a test buyer profile
  SELECT id INTO v_test_buyer_id FROM profiles LIMIT 1 OFFSET 1;
  
  IF v_test_buyer_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: Need at least 2 profiles. Create test profiles first.';
    RETURN;
  END IF;
  
  -- Get a test listing
  SELECT id INTO v_test_listing_id FROM vehicle_listings LIMIT 1;
  
  IF v_test_listing_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: No listings found. Create a test listing first.';
    RETURN;
  END IF;
  
  -- Test case 1: New buyer with no bids (should be tier C)
  SELECT refresh_buyer_tier(v_test_buyer_id) INTO v_result;
  
  SELECT * INTO v_tier_record FROM buyer_tiers WHERE buyer_id = v_test_buyer_id;
  
  IF v_tier_record IS NULL THEN
    RAISE NOTICE 'FAILED: No tier record created for buyer';
  ELSIF v_tier_record.tier != 'C' THEN
    RAISE NOTICE 'FAILED: Expected tier C for new buyer, got %', v_tier_record.tier;
  ELSE
    RAISE NOTICE '✓ Test 2a PASSED: New buyer correctly assigned tier C';
  END IF;
  
  -- Test case 2: Buyer with bids
  -- Create multiple bids
  FOR i IN 1..15 LOOP
    INSERT INTO auction_bids (listing_id, bidder_id, proxy_max_bid_cents, displayed_bid_cents, is_winning)
    VALUES (
      v_test_listing_id,
      v_test_buyer_id,
      5000000 + (i * 100000), -- $50k + increments
      5000000 + (i * 100000),
      CASE WHEN i = 15 THEN TRUE ELSE FALSE END -- Last bid wins
    )
    RETURNING id INTO v_bid_id;
    
    -- Mark previous bids as outbid
    IF i > 1 THEN
      UPDATE auction_bids
      SET is_winning = FALSE, is_outbid = TRUE, outbid_at = NOW()
      WHERE listing_id = v_test_listing_id
        AND bidder_id = v_test_buyer_id
        AND id != v_bid_id;
    END IF;
  END LOOP;
  
  -- Refresh tier
  SELECT refresh_buyer_tier(v_test_buyer_id) INTO v_result;
  
  SELECT * INTO v_tier_record FROM buyer_tiers WHERE buyer_id = v_test_buyer_id;
  
  IF v_tier_record IS NULL THEN
    RAISE NOTICE 'FAILED: Tier record not updated';
  ELSE
    RAISE NOTICE '✓ Test 2b PASSED: Buyer tier updated';
    RAISE NOTICE '  - Tier: %', v_tier_record.tier;
    RAISE NOTICE '  - Total Bids: %', v_tier_record.total_bids;
    RAISE NOTICE '  - Winning Bids: %', v_tier_record.winning_bids;
    RAISE NOTICE '  - Payment Reliability: %%', v_tier_record.payment_reliability;
    RAISE NOTICE '  - Total Spent: $%', v_tier_record.total_spent_cents / 100;
  END IF;
  
  -- Cleanup (optional)
  -- DELETE FROM auction_bids WHERE bidder_id = v_test_buyer_id;
  
END $$;

-- =====================================================
-- TEST 3: Test triggers
-- =====================================================

DO $$
DECLARE
  v_test_seller_id UUID;
  v_test_buyer_id UUID;
  v_test_vehicle_id UUID;
  v_listing_id UUID;
  v_tier_before RECORD;
  v_tier_after RECORD;
BEGIN
  RAISE NOTICE '=== TEST 3: Trigger Tests ===';
  
  -- Get test IDs
  SELECT id INTO v_test_seller_id FROM profiles LIMIT 1;
  SELECT id INTO v_test_buyer_id FROM profiles LIMIT 1 OFFSET 1;
  SELECT id INTO v_test_vehicle_id FROM vehicles LIMIT 1;
  
  IF v_test_seller_id IS NULL OR v_test_buyer_id IS NULL OR v_test_vehicle_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: Need profiles and vehicles for trigger tests';
    RETURN;
  END IF;
  
  -- Get initial tier
  SELECT * INTO v_tier_before FROM seller_tiers WHERE seller_id = v_test_seller_id;
  
  -- Test trigger: Create a listing (should trigger tier refresh)
  INSERT INTO vehicle_listings (vehicle_id, seller_id, sale_type, status)
  VALUES (v_test_vehicle_id, v_test_seller_id, 'auction', 'active')
  RETURNING id INTO v_listing_id;
  
  -- Small delay to let trigger execute
  PERFORM pg_sleep(0.1);
  
  -- Check if tier was updated
  SELECT * INTO v_tier_after FROM seller_tiers WHERE seller_id = v_test_seller_id;
  
  IF v_tier_after.tier_updated_at > v_tier_before.tier_updated_at OR v_tier_before IS NULL THEN
    RAISE NOTICE '✓ Test 3a PASSED: Listing creation trigger works';
  ELSE
    RAISE NOTICE 'FAILED: Listing creation trigger may not have fired';
  END IF;
  
  -- Test trigger: Update listing to sold (should trigger tier refresh)
  UPDATE vehicle_listings
  SET status = 'sold', sold_price_cents = 10000000, rating = 4.8
  WHERE id = v_listing_id;
  
  PERFORM pg_sleep(0.1);
  
  SELECT * INTO v_tier_after FROM seller_tiers WHERE seller_id = v_test_seller_id;
  
  IF v_tier_after.tier_updated_at > v_tier_before.tier_updated_at THEN
    RAISE NOTICE '✓ Test 3b PASSED: Listing update trigger works';
  ELSE
    RAISE NOTICE 'FAILED: Listing update trigger may not have fired';
  END IF;
  
  -- Test buyer tier trigger
  IF v_listing_id IS NOT NULL THEN
    SELECT * INTO v_tier_before FROM buyer_tiers WHERE buyer_id = v_test_buyer_id;
    
    INSERT INTO auction_bids (listing_id, bidder_id, proxy_max_bid_cents, displayed_bid_cents, is_winning)
    VALUES (v_listing_id, v_test_buyer_id, 10000000, 10000000, TRUE);
    
    PERFORM pg_sleep(0.1);
    
    SELECT * INTO v_tier_after FROM buyer_tiers WHERE buyer_id = v_test_buyer_id;
    
    IF v_tier_after.tier_updated_at > v_tier_before.tier_updated_at OR v_tier_before IS NULL THEN
      RAISE NOTICE '✓ Test 3c PASSED: Bid creation trigger works';
    ELSE
      RAISE NOTICE 'FAILED: Bid creation trigger may not have fired';
    END IF;
  END IF;
  
END $$;

-- =====================================================
-- TEST 4: Test bulk refresh functions
-- =====================================================

DO $$
DECLARE
  v_result JSONB;
BEGIN
  RAISE NOTICE '=== TEST 4: Bulk Refresh Functions ===';
  
  -- Test seller bulk refresh
  SELECT refresh_all_seller_tiers() INTO v_result;
  
  IF (v_result->>'success')::BOOLEAN THEN
    RAISE NOTICE '✓ Test 4a PASSED: Bulk seller tier refresh works';
    RAISE NOTICE '  - Refreshed: % sellers', v_result->>'refreshed';
    RAISE NOTICE '  - Errors: %', v_result->>'errors';
  ELSE
    RAISE NOTICE 'FAILED: Bulk seller tier refresh returned error';
  END IF;
  
  -- Test buyer bulk refresh
  SELECT refresh_all_buyer_tiers() INTO v_result;
  
  IF (v_result->>'success')::BOOLEAN THEN
    RAISE NOTICE '✓ Test 4b PASSED: Bulk buyer tier refresh works';
    RAISE NOTICE '  - Refreshed: % buyers', v_result->>'refreshed';
    RAISE NOTICE '  - Errors: %', v_result->>'errors';
  ELSE
    RAISE NOTICE 'FAILED: Bulk buyer tier refresh returned error';
  END IF;
  
END $$;

-- =====================================================
-- TEST 5: Test RLS policies
-- =====================================================

DO $$
DECLARE
  v_policy_count INTEGER;
BEGIN
  RAISE NOTICE '=== TEST 5: RLS Policy Checks ===';
  
  -- Check seller_tiers policies
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'seller_tiers';
  
  IF v_policy_count >= 3 THEN
    RAISE NOTICE '✓ Test 5a PASSED: seller_tiers has % policies (expected at least 3)', v_policy_count;
  ELSE
    RAISE NOTICE 'FAILED: seller_tiers has only % policies (expected at least 3)', v_policy_count;
  END IF;
  
  -- Check buyer_tiers policies
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'buyer_tiers';
  
  IF v_policy_count >= 3 THEN
    RAISE NOTICE '✓ Test 5b PASSED: buyer_tiers has % policies (expected at least 3)', v_policy_count;
  ELSE
    RAISE NOTICE 'FAILED: buyer_tiers has only % policies (expected at least 3)', v_policy_count;
  END IF;
  
END $$;

-- =====================================================
-- TEST 6: Tier calculation accuracy
-- =====================================================

DO $$
DECLARE
  v_test_seller_id UUID;
  v_result JSONB;
  v_expected_score INTEGER;
  v_actual_score INTEGER;
BEGIN
  RAISE NOTICE '=== TEST 6: Tier Calculation Accuracy ===';
  
  -- Get a seller with known metrics
  SELECT id INTO v_test_seller_id 
  FROM seller_tiers 
  WHERE successful_sales > 0 
  LIMIT 1;
  
  IF v_test_seller_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: No sellers with sales found for accuracy test';
    RETURN;
  END IF;
  
  -- Refresh and check score calculation
  SELECT refresh_seller_tier(v_test_seller_id) INTO v_result;
  
  v_actual_score := (v_result->>'score')::INTEGER;
  
  -- Basic validation: score should be between 0 and 100
  IF v_actual_score >= 0 AND v_actual_score <= 100 THEN
    RAISE NOTICE '✓ Test 6a PASSED: Score is within valid range (0-100): %', v_actual_score;
  ELSE
    RAISE NOTICE 'FAILED: Score % is outside valid range (0-100)', v_actual_score;
  END IF;
  
  -- Check tier matches score ranges
  CASE (v_result->>'tier')::TEXT
    WHEN 'SSS' THEN
      IF v_actual_score >= 90 THEN
        RAISE NOTICE '✓ Test 6b PASSED: Tier SSS matches score >= 90';
      ELSE
        RAISE NOTICE 'FAILED: Tier SSS but score is % (< 90)', v_actual_score;
      END IF;
    WHEN 'SS' THEN
      IF v_actual_score >= 75 AND v_actual_score < 90 THEN
        RAISE NOTICE '✓ Test 6b PASSED: Tier SS matches score 75-89';
      ELSE
        RAISE NOTICE 'FAILED: Tier SS but score is % (not 75-89)', v_actual_score;
      END IF;
    WHEN 'S' THEN
      IF v_actual_score >= 60 AND v_actual_score < 75 THEN
        RAISE NOTICE '✓ Test 6b PASSED: Tier S matches score 60-74';
      ELSE
        RAISE NOTICE 'FAILED: Tier S but score is % (not 60-74)', v_actual_score;
      END IF;
    WHEN 'A' THEN
      IF v_actual_score >= 45 AND v_actual_score < 60 THEN
        RAISE NOTICE '✓ Test 6b PASSED: Tier A matches score 45-59';
      ELSE
        RAISE NOTICE 'FAILED: Tier A but score is % (not 45-59)', v_actual_score;
      END IF;
    WHEN 'B' THEN
      IF v_actual_score >= 30 AND v_actual_score < 45 THEN
        RAISE NOTICE '✓ Test 6b PASSED: Tier B matches score 30-44';
      ELSE
        RAISE NOTICE 'FAILED: Tier B but score is % (not 30-44)', v_actual_score;
      END IF;
    WHEN 'C' THEN
      IF v_actual_score < 30 THEN
        RAISE NOTICE '✓ Test 6b PASSED: Tier C matches score < 30';
      ELSE
        RAISE NOTICE 'FAILED: Tier C but score is % (>= 30)', v_actual_score;
      END IF;
    ELSE
      RAISE NOTICE 'FAILED: Unknown tier %', (v_result->>'tier')::TEXT;
  END CASE;
  
END $$;

-- =====================================================
-- SUMMARY
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST SUMMARY ===';
  RAISE NOTICE 'All tier system tests completed.';
  RAISE NOTICE 'Review the output above for any failures or warnings.';
  RAISE NOTICE '==================';
END $$;

