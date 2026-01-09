-- Tier System Diagnostic Queries
-- Use these to understand why users have specific tiers and what data is available

-- =====================================================
-- DIAGNOSTIC 1: Why are most profiles C tier?
-- =====================================================

-- Check tier distribution
SELECT 
  tier,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM seller_tiers
GROUP BY tier
ORDER BY 
  CASE tier 
    WHEN 'SSS' THEN 1
    WHEN 'SS' THEN 2
    WHEN 'S' THEN 3
    WHEN 'A' THEN 4
    WHEN 'B' THEN 5
    WHEN 'C' THEN 6
    ELSE 7
  END;

-- Check platform tier distribution
SELECT 
  COALESCE(platform_tier, 'NULL') as platform_tier,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM seller_tiers
GROUP BY platform_tier
ORDER BY 
  CASE platform_tier 
    WHEN 'A' THEN 1
    WHEN 'B' THEN 2
    WHEN 'C' THEN 3
    WHEN 'D' THEN 4
    WHEN 'E' THEN 5
    WHEN 'F' THEN 6
    ELSE 7
  END;

-- =====================================================
-- DIAGNOSTIC 2: Users with C tier - why?
-- =====================================================

-- Sample C tier users and their metrics
SELECT 
  st.seller_id,
  p.username,
  st.tier,
  st.total_sales,
  st.successful_sales,
  st.total_revenue_cents,
  st.average_rating,
  st.completion_rate,
  st.platform_tier,
  st.platform_score,
  st.tier_updated_at,
  st.platform_tier_updated_at
FROM seller_tiers st
LEFT JOIN profiles p ON st.seller_id = p.id
WHERE st.tier = 'C'
LIMIT 20;

-- =====================================================
-- DIAGNOSTIC 3: Check if triggers are working
-- =====================================================

-- Check trigger existence
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name LIKE '%tier%'
ORDER BY event_object_table, trigger_name;

-- Check when tiers were last updated
SELECT 
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE tier_updated_at IS NULL) as never_updated,
  COUNT(*) FILTER (WHERE tier_updated_at < NOW() - INTERVAL '7 days') as stale_7d,
  COUNT(*) FILTER (WHERE tier_updated_at < NOW() - INTERVAL '30 days') as stale_30d,
  COUNT(*) FILTER (WHERE tier_updated_at >= NOW() - INTERVAL '1 day') as updated_today
FROM seller_tiers;

-- =====================================================
-- DIAGNOSTIC 4: Data availability for tier calculation
-- =====================================================

-- Check users with vehicles but no tier data
SELECT 
  COUNT(DISTINCT v.user_id) as users_with_vehicles,
  COUNT(DISTINCT st.seller_id) as users_with_seller_tier,
  COUNT(DISTINCT v.user_id) - COUNT(DISTINCT st.seller_id) as missing_tiers
FROM vehicles v
LEFT JOIN seller_tiers st ON v.user_id = st.seller_id;

-- Check users with activity but C tier
SELECT 
  v.user_id,
  COUNT(DISTINCT v.id) as vehicle_count,
  COUNT(DISTINCT vi.id) as image_count,
  COUNT(DISTINCT vte.id) as event_count,
  COUNT(DISTINCT vr.id) as receipt_count,
  st.tier,
  st.platform_tier,
  st.total_sales,
  st.successful_sales
FROM vehicles v
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
LEFT JOIN vehicle_timeline_events vte ON v.id = vte.vehicle_id
LEFT JOIN vehicle_receipts vr ON v.id = vr.vehicle_id
LEFT JOIN seller_tiers st ON v.user_id = st.seller_id
WHERE v.user_id IS NOT NULL
  AND (st.tier = 'C' OR st.tier IS NULL)
  AND (
    COUNT(DISTINCT vi.id) > 10 OR
    COUNT(DISTINCT vte.id) > 5 OR
    COUNT(DISTINCT vr.id) > 0
  )
GROUP BY v.user_id, st.tier, st.platform_tier, st.total_sales, st.successful_sales
HAVING COUNT(DISTINCT vi.id) > 10 OR COUNT(DISTINCT vte.id) > 5
LIMIT 20;

-- =====================================================
-- DIAGNOSTIC 5: Platform activity vs tier mismatch
-- =====================================================

-- Users with high platform activity but low tier
WITH user_activity AS (
  SELECT 
    v.user_id,
    COUNT(DISTINCT vi.id) as images,
    COUNT(DISTINCT vte.id) as events,
    COUNT(DISTINCT vr.id) as receipts,
    MAX(vi.created_at) as last_image,
    MAX(vte.created_at) as last_event
  FROM vehicles v
  LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id
  LEFT JOIN vehicle_timeline_events vte ON v.id = vte.vehicle_id
  LEFT JOIN vehicle_receipts vr ON v.id = vr.vehicle_id
  WHERE v.user_id IS NOT NULL
  GROUP BY v.user_id
)
SELECT 
  ua.user_id,
  ua.images,
  ua.events,
  ua.receipts,
  ua.last_image,
  ua.last_event,
  st.tier,
  st.platform_tier,
  st.platform_score,
  st.total_sales,
  CASE 
    WHEN ua.images >= 100 AND st.tier = 'C' THEN 'HIGH_ACTIVITY_LOW_TIER'
    WHEN ua.events >= 50 AND st.tier = 'C' THEN 'HIGH_EVENTS_LOW_TIER'
    ELSE 'OK'
  END as mismatch_type
FROM user_activity ua
LEFT JOIN seller_tiers st ON ua.user_id = st.seller_id
WHERE (
  (ua.images >= 100 OR ua.events >= 50) AND 
  (st.tier = 'C' OR st.platform_tier IS NULL)
)
ORDER BY ua.images DESC, ua.events DESC
LIMIT 20;

-- =====================================================
-- DIAGNOSTIC 6: Test platform tier calculation
-- =====================================================

-- Test platform tier calculation for a specific user
-- Replace 'USER_ID_HERE' with actual user ID
/*
SELECT calculate_platform_tier_score('USER_ID_HERE');
*/

-- Test platform tier calculation for a specific vehicle
-- Replace 'VEHICLE_ID_HERE' with actual vehicle ID
/*
SELECT 
  calculate_platform_tier_score(v.user_id, v.id) as tier_result
FROM vehicles v
WHERE v.id = 'VEHICLE_ID_HERE';
*/

-- =====================================================
-- DIAGNOSTIC 7: Trigger firing frequency
-- =====================================================

-- Check recent listing/bid activity that should trigger tier refresh
SELECT 
  'vehicle_listings' as source,
  COUNT(*) as total_changes,
  COUNT(DISTINCT seller_id) as unique_sellers,
  MIN(updated_at) as earliest_change,
  MAX(updated_at) as latest_change
FROM vehicle_listings
WHERE updated_at >= NOW() - INTERVAL '24 hours'
UNION ALL
SELECT 
  'auction_bids' as source,
  COUNT(*) as total_changes,
  COUNT(DISTINCT bidder_id) as unique_buyers,
  MIN(updated_at) as earliest_change,
  MAX(updated_at) as latest_change
FROM auction_bids
WHERE updated_at >= NOW() - INTERVAL '24 hours';

-- Check platform activity that should trigger platform tier refresh
SELECT 
  'vehicle_images' as source,
  COUNT(*) as uploads,
  COUNT(DISTINCT user_id) as unique_users,
  MIN(created_at) as earliest,
  MAX(created_at) as latest
FROM vehicle_images
WHERE created_at >= NOW() - INTERVAL '24 hours'
UNION ALL
SELECT 
  'vehicle_timeline_events' as source,
  COUNT(*) as events,
  COUNT(DISTINCT user_id) as unique_users,
  MIN(created_at) as earliest,
  MAX(created_at) as latest
FROM vehicle_timeline_events
WHERE created_at >= NOW() - INTERVAL '24 hours'
UNION ALL
SELECT 
  'vehicle_receipts' as source,
  COUNT(*) as receipts,
  COUNT(DISTINCT (
    SELECT user_id FROM vehicles WHERE id = vehicle_receipts.vehicle_id
  )) as unique_users,
  MIN(created_at) as earliest,
  MAX(created_at) as latest
FROM vehicle_receipts
WHERE created_at >= NOW() - INTERVAL '24 hours';

-- =====================================================
-- DIAGNOSTIC 8: Missing data preventing tier upgrades
-- =====================================================

-- Users stuck at C tier - what's missing?
SELECT 
  st.seller_id,
  p.username,
  st.tier,
  st.total_sales,
  st.successful_sales,
  COUNT(DISTINCT vl.id) FILTER (WHERE vl.status = 'sold') as actual_sold_listings,
  COUNT(DISTINCT vl.id) as total_listings,
  st.total_revenue_cents,
  st.average_rating
FROM seller_tiers st
LEFT JOIN profiles p ON st.seller_id = p.id
LEFT JOIN vehicle_listings vl ON st.seller_id = vl.seller_id
WHERE st.tier = 'C'
GROUP BY st.seller_id, p.username, st.tier, st.total_sales, st.successful_sales, 
         st.total_revenue_cents, st.average_rating
HAVING COUNT(DISTINCT vl.id) FILTER (WHERE vl.status = 'sold') != st.successful_sales
   OR COUNT(DISTINCT vl.id) != st.total_sales
LIMIT 20;

-- =====================================================
-- DIAGNOSTIC 9: Platform tier vs commercial tier comparison
-- =====================================================

-- Compare platform tier to commercial tier
SELECT 
  st.tier as commercial_tier,
  COALESCE(st.platform_tier, 'NULL') as platform_tier,
  COUNT(*) as count,
  AVG(st.total_sales) as avg_sales,
  AVG(st.platform_score) as avg_platform_score
FROM seller_tiers st
GROUP BY st.tier, st.platform_tier
ORDER BY 
  CASE st.tier 
    WHEN 'SSS' THEN 1 WHEN 'SS' THEN 2 WHEN 'S' THEN 3
    WHEN 'A' THEN 4 WHEN 'B' THEN 5 WHEN 'C' THEN 6 ELSE 7
  END,
  CASE st.platform_tier 
    WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3
    WHEN 'D' THEN 4 WHEN 'E' THEN 5 WHEN 'F' THEN 6 ELSE 7
  END;

-- Users with platform tier but low commercial tier (or vice versa)
SELECT 
  st.seller_id,
  p.username,
  st.tier as commercial_tier,
  st.platform_tier,
  st.total_sales,
  st.successful_sales,
  st.platform_score,
  CASE 
    WHEN st.platform_tier IN ('A', 'B') AND st.tier = 'C' THEN 'HIGH_PLATFORM_LOW_COMMERCIAL'
    WHEN st.tier IN ('A', 'B') AND st.platform_tier IN ('D', 'E', 'F') THEN 'HIGH_COMMERCIAL_LOW_PLATFORM'
    WHEN st.platform_tier IS NULL AND st.tier = 'C' THEN 'NO_PLATFORM_TIER'
    ELSE 'OK'
  END as tier_discrepancy
FROM seller_tiers st
LEFT JOIN profiles p ON st.seller_id = p.id
WHERE (
  (st.platform_tier IN ('A', 'B') AND st.tier = 'C') OR
  (st.tier IN ('A', 'B') AND st.platform_tier IN ('D', 'E', 'F')) OR
  (st.platform_tier IS NULL)
)
LIMIT 20;

-- =====================================================
-- RECOMMENDATIONS QUERY
-- =====================================================

-- Summary of issues and recommendations
DO $$
DECLARE
  v_total_users INTEGER;
  v_c_tier_count INTEGER;
  v_no_platform_tier INTEGER;
  v_stale_tiers INTEGER;
  v_high_activity_low_tier INTEGER;
BEGIN
  -- Get counts
  SELECT COUNT(*) INTO v_total_users FROM seller_tiers;
  SELECT COUNT(*) INTO v_c_tier_count FROM seller_tiers WHERE tier = 'C';
  SELECT COUNT(*) INTO v_no_platform_tier FROM seller_tiers WHERE platform_tier IS NULL;
  SELECT COUNT(*) INTO v_stale_tiers 
  FROM seller_tiers 
  WHERE tier_updated_at IS NULL OR tier_updated_at < NOW() - INTERVAL '30 days';
  
  RAISE NOTICE '=== TIER SYSTEM DIAGNOSTICS ===';
  RAISE NOTICE 'Total users with tiers: %', v_total_users;
  RAISE NOTICE 'Users with C tier: % (%%%)', 
    v_c_tier_count, 
    ROUND(v_c_tier_count * 100.0 / NULLIF(v_total_users, 0), 2);
  RAISE NOTICE 'Users without platform tier: % (%%%)', 
    v_no_platform_tier, 
    ROUND(v_no_platform_tier * 100.0 / NULLIF(v_total_users, 0), 2);
  RAISE NOTICE 'Users with stale tiers (30+ days): %', v_stale_tiers;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== RECOMMENDATIONS ===';
  
  IF v_c_tier_count * 100.0 / NULLIF(v_total_users, 0) > 80 THEN
    RAISE NOTICE '⚠️  WARNING: >80%% of users at C tier. Likely because:';
    RAISE NOTICE '   1. Most users have no vehicle_listings with status=''sold''';
    RAISE NOTICE '   2. Platform-native tier calculation not yet run';
    RAISE NOTICE '   3. Users need to list vehicles for sale to increase commercial tier';
    RAISE NOTICE '';
    RAISE NOTICE '   SOLUTION: Run platform tier calculation:';
    RAISE NOTICE '   SELECT refresh_all_platform_tiers();';
  END IF;
  
  IF v_no_platform_tier * 100.0 / NULLIF(v_total_users, 0) > 50 THEN
    RAISE NOTICE '⚠️  WARNING: >50%% users missing platform tier.';
    RAISE NOTICE '   SOLUTION: Run bulk platform tier refresh:';
    RAISE NOTICE '   SELECT refresh_all_platform_tiers();';
  END IF;
  
  IF v_stale_tiers > 0 THEN
    RAISE NOTICE '⚠️  WARNING: % users with stale tiers (>30 days old).', v_stale_tiers;
    RAISE NOTICE '   SOLUTION: Run bulk refresh:';
    RAISE NOTICE '   SELECT refresh_all_seller_tiers();';
    RAISE NOTICE '   SELECT refresh_all_platform_tiers();';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== NEXT STEPS ===';
  RAISE NOTICE '1. Run: SELECT refresh_all_platform_tiers(); (to calculate platform tiers)';
  RAISE NOTICE '2. Run diagnostics above to see user-specific issues';
  RAISE NOTICE '3. Check trigger logs to ensure triggers are firing';
  RAISE NOTICE '========================';
END $$;

