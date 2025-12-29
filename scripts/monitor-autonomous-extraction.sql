-- ============================================================================
-- AUTONOMOUS EXTRACTION MONITORING DASHBOARD
-- Run this in Supabase SQL Editor to track progress while you're away
-- ============================================================================

-- 1. CURRENT CAPACITY STATUS
-- ============================================================================
SELECT 
  'DATABASE SIZE' as metric,
  pg_size_pretty(pg_database_size(current_database())) as value,
  'Total database size' as description
UNION ALL
SELECT 
  'VEHICLES',
  (SELECT COUNT(*)::text FROM vehicles),
  'Total vehicles in database'
UNION ALL
SELECT 
  'EXTERNAL LISTINGS',
  (SELECT COUNT(*)::text FROM external_listings),
  'All auction listings'
UNION ALL
SELECT 
  'LIVE AUCTIONS',
  (SELECT COUNT(*)::text FROM external_listings WHERE end_date > NOW()),
  'Active auctions happening now'
UNION ALL
SELECT 
  'IMAGES',
  (SELECT COUNT(*)::text FROM vehicle_images),
  'Total vehicle images stored'
UNION ALL
SELECT 
  'ORGANIZATIONS',
  (SELECT COUNT(*)::text FROM businesses),
  'Dealers/auction houses tracked';

-- 2. IMPORT QUEUE STATUS (Backlog Health)
-- ============================================================================
SELECT '--- IMPORT QUEUE STATUS ---' as section;

SELECT 
  status,
  COUNT(*) as count,
  ROUND(AVG(attempts), 2) as avg_attempts,
  MIN(created_at) as oldest_item,
  MAX(created_at) as newest_item,
  CASE 
    WHEN status = 'pending' AND COUNT(*) > 10000 THEN '⚠️ BACKLOG HIGH'
    WHEN status = 'pending' AND COUNT(*) > 1000 THEN '⚠️ BACKLOG MEDIUM'
    WHEN status = 'failed' AND COUNT(*) > 500 THEN '❌ HIGH FAILURE RATE'
    ELSE '✅ OK'
  END as health
FROM import_queue
GROUP BY status
ORDER BY 
  CASE status
    WHEN 'pending' THEN 1
    WHEN 'processing' THEN 2
    WHEN 'complete' THEN 3
    WHEN 'failed' THEN 4
    WHEN 'duplicate' THEN 5
  END;

-- 3. LIVE AUCTION TRACKING
-- ============================================================================
SELECT '--- LIVE AUCTIONS ---' as section;

SELECT 
  el.platform,
  COUNT(*) as live_count,
  COUNT(DISTINCT el.vehicle_id) as unique_vehicles,
  MIN(el.end_date) as next_ending,
  MAX(el.current_bid) as highest_bid,
  SUM(CASE WHEN el.current_bid IS NOT NULL AND el.current_bid::numeric > 0 THEN 1 ELSE 0 END) as with_bids
FROM external_listings el
WHERE el.end_date > NOW()
GROUP BY el.platform
ORDER BY live_count DESC;

-- 4. EXTRACTION PROGRESS (Last Hour)
-- ============================================================================
SELECT '--- EXTRACTION ACTIVITY (LAST HOUR) ---' as section;

SELECT 
  'Vehicles Created' as activity,
  COUNT(*) as count,
  STRING_AGG(DISTINCT profile_origin, ', ') as sources
FROM vehicles
WHERE created_at > NOW() - INTERVAL '1 hour'
UNION ALL
SELECT 
  'Images Added',
  COUNT(*)::text,
  STRING_AGG(DISTINCT source, ', ')
FROM vehicle_images
WHERE created_at > NOW() - INTERVAL '1 hour'
UNION ALL
SELECT 
  'Queue Items Processed',
  COUNT(*)::text,
  'import_queue'
FROM import_queue
WHERE processed_at > NOW() - INTERVAL '1 hour' AND status = 'complete'
UNION ALL
SELECT 
  'Organizations Created',
  COUNT(*)::text,
  'businesses'
FROM businesses
WHERE created_at > NOW() - INTERVAL '1 hour';

-- 5. CRON JOB STATUS
-- ============================================================================
SELECT '--- ACTIVE CRON JOBS ---' as section;

SELECT 
  jobname,
  schedule,
  active,
  CASE 
    WHEN jobname LIKE '%sync-active%' THEN '🔄 Live auction sync'
    WHEN jobname LIKE '%import-queue%' THEN '📥 Queue processing'
    WHEN jobname LIKE '%bat%' THEN '🎯 BaT extraction'
    WHEN jobname LIKE '%cars-and-bids%' THEN '🚗 C&B extraction'
    WHEN jobname LIKE '%mecum%' THEN '🔨 Mecum extraction'
    WHEN jobname LIKE '%barrett%' THEN '🏎️ Barrett-Jackson'
    WHEN jobname LIKE '%grinder%' THEN '⚡ Continuous extraction'
    ELSE '📋 Other'
  END as purpose
FROM cron.job
WHERE active = true
ORDER BY 
  CASE 
    WHEN jobname LIKE '%sync-active%' THEN 1
    WHEN jobname LIKE '%grinder%' THEN 2
    WHEN jobname LIKE '%import-queue%' THEN 3
    ELSE 4
  END,
  jobname;

-- 6. FAILURE ANALYSIS
-- ============================================================================
SELECT '--- RECENT FAILURES (Need Attention) ---' as section;

SELECT 
  listing_url,
  error_message,
  attempts,
  last_attempt_at,
  created_at
FROM import_queue
WHERE status = 'failed'
  AND last_attempt_at > NOW() - INTERVAL '1 hour'
ORDER BY last_attempt_at DESC
LIMIT 10;

-- 7. TOP SOURCES (Volume Leaders)
-- ============================================================================
SELECT '--- TOP VEHICLE SOURCES ---' as section;

SELECT 
  COALESCE(profile_origin, 'unknown') as source,
  COUNT(*) as vehicles,
  COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as added_24h,
  COUNT(CASE WHEN primary_image_url IS NOT NULL THEN 1 END) as with_images,
  ROUND(AVG(CASE WHEN mileage IS NOT NULL AND mileage > 0 THEN mileage END)) as avg_mileage
FROM vehicles
GROUP BY profile_origin
ORDER BY vehicles DESC
LIMIT 10;

-- 8. SNOWBALL EFFECT TRACKING (Identity Discovery)
-- ============================================================================
SELECT '--- IDENTITY DISCOVERY (Snowball Effect) ---' as section;

SELECT 
  platform,
  COUNT(*) as total_identities,
  COUNT(CASE WHEN last_seen_at > NOW() - INTERVAL '24 hours' THEN 1 END) as active_24h,
  COUNT(CASE WHEN metadata->>'organization_id' IS NOT NULL THEN 1 END) as linked_to_orgs
FROM external_identities
GROUP BY platform
ORDER BY total_identities DESC;

-- 9. SYSTEM HEALTH SUMMARY
-- ============================================================================
SELECT '--- SYSTEM HEALTH SUMMARY ---' as section;

SELECT 
  CASE 
    WHEN pending_count > 10000 THEN '🔴 CRITICAL: High backlog'
    WHEN pending_count > 1000 THEN '🟡 WARNING: Medium backlog'
    WHEN failed_rate > 0.5 THEN '🔴 CRITICAL: High failure rate'
    WHEN failed_rate > 0.2 THEN '🟡 WARNING: Elevated failures'
    WHEN live_auctions < 1 THEN '🟡 WARNING: No live auctions tracked'
    ELSE '🟢 HEALTHY: All systems operational'
  END as status,
  pending_count as pending_items,
  ROUND(failed_rate * 100, 1) || '%' as failure_rate,
  live_auctions as active_auctions,
  vehicles_added_24h as new_vehicles_24h
FROM (
  SELECT 
    (SELECT COUNT(*) FROM import_queue WHERE status = 'pending') as pending_count,
    (SELECT COUNT(*)::numeric / NULLIF(COUNT(*), 0) FROM import_queue WHERE status = 'failed') as failed_rate,
    (SELECT COUNT(*) FROM external_listings WHERE end_date > NOW()) as live_auctions,
    (SELECT COUNT(*) FROM vehicles WHERE created_at > NOW() - INTERVAL '24 hours') as vehicles_added_24h
) summary;

-- 10. QUICK ACTIONS (If Things Go Wrong)
-- ============================================================================
SELECT '--- QUICK DIAGNOSTICS ---' as section;

-- Check if sync-active-auctions is working
SELECT 
  'Last auction sync' as check,
  MAX(updated_at) as last_update,
  CASE 
    WHEN MAX(updated_at) < NOW() - INTERVAL '30 minutes' THEN '❌ STALE (check sync-active-auctions)'
    ELSE '✅ RECENT'
  END as status
FROM external_listings
WHERE end_date > NOW();

-- Check if queue is processing
SELECT 
  'Queue processing' as check,
  MAX(processed_at) as last_processed,
  CASE 
    WHEN MAX(processed_at) < NOW() - INTERVAL '5 minutes' THEN '❌ STUCK (check process-import-queue)'
    ELSE '✅ ACTIVE'
  END as status
FROM import_queue
WHERE status = 'complete';

-- Check database size vs limits
SELECT 
  'Database capacity' as check,
  pg_size_pretty(pg_database_size(current_database())) as current_size,
  CASE 
    WHEN pg_database_size(current_database()) > 7000000000 THEN '⚠️ APPROACHING LIMIT (8GB on Pro plan)'
    WHEN pg_database_size(current_database()) > 500000000 THEN '✅ GOOD (Free tier would be full)'
    ELSE '✅ PLENTY OF ROOM'
  END as status;

