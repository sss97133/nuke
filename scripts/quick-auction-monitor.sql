-- ============================================================================
-- QUICK AUCTION MONITORING QUERIES
-- Run these in Supabase SQL Editor for instant status checks
-- ============================================================================

-- 1. LIVE AUCTION OVERVIEW (Quick Status)
SELECT 
  platform,
  COUNT(*) FILTER (WHERE listing_status = 'active') as active_auctions,
  COUNT(*) FILTER (WHERE end_date > NOW()) as ending_soon,
  MAX(current_bid) as highest_bid,
  MAX(last_synced_at) as last_sync,
  CASE 
    WHEN MAX(last_synced_at) < NOW() - INTERVAL '30 minutes' THEN '❌ STALE'
    WHEN MAX(last_synced_at) < NOW() - INTERVAL '15 minutes' THEN '⚠️ DELAYED'
    ELSE '✅ RECENT'
  END as sync_status
FROM external_listings
WHERE listing_status = 'active'
GROUP BY platform
ORDER BY active_auctions DESC;

-- 2. SYNC JOB STATUS (Is it running?)
SELECT 
  jobname,
  active as is_active,
  schedule,
  start_time as last_run,
  status as last_status,
  CASE 
    WHEN start_time < NOW() - INTERVAL '30 minutes' THEN '❌ NOT RUNNING'
    WHEN status = 'failed' THEN '❌ FAILED'
    WHEN status = 'succeeded' THEN '✅ OK'
    ELSE '⚠️ UNKNOWN'
  END as health
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT start_time, status
  FROM cron.job_run_details
  WHERE jobid = j.jobid
  ORDER BY start_time DESC
  LIMIT 1
) jrd ON true
WHERE jobname IN ('sync-active-auctions', 'process-bat-queue')
ORDER BY jobname;

-- 3. QUEUE STATUS (How many waiting?)
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percentage,
  MIN(created_at) as oldest_item,
  CASE 
    WHEN status = 'pending' AND COUNT(*) > 1000 THEN '⚠️ LARGE BACKLOG'
    WHEN status = 'failed' AND COUNT(*) > 100 THEN '❌ MANY FAILURES'
    ELSE '✅ OK'
  END as health
FROM bat_extraction_queue
GROUP BY status
ORDER BY 
  CASE status
    WHEN 'pending' THEN 1
    WHEN 'processing' THEN 2
    WHEN 'complete' THEN 3
    WHEN 'failed' THEN 4
  END;

-- 4. RECENT ACTIVITY (Last Hour)
SELECT 
  'Recent Auction Updates' as metric,
  COUNT(*) as count,
  MAX(updated_at) as most_recent
FROM external_listings
WHERE updated_at > NOW() - INTERVAL '1 hour'
UNION ALL
SELECT 
  'Vehicles Created (24h)',
  COUNT(*),
  MAX(created_at)
FROM vehicles
WHERE created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT 
  'Queue Items Processed (24h)',
  COUNT(*),
  MAX(processed_at)
FROM bat_extraction_queue
WHERE status = 'complete'
  AND processed_at > NOW() - INTERVAL '24 hours';

-- 5. ACTIVE AUCTIONS BY PLATFORM (Detailed)
SELECT 
  platform,
  listing_url,
  current_bid,
  bid_count,
  end_date,
  EXTRACT(EPOCH FROM (end_date - NOW())) / 3600 as hours_remaining,
  last_synced_at,
  CASE 
    WHEN last_synced_at < NOW() - INTERVAL '30 minutes' THEN '❌'
    WHEN last_synced_at < NOW() - INTERVAL '15 minutes' THEN '⚠️'
    ELSE '✅'
  END as sync_status
FROM external_listings
WHERE listing_status = 'active'
  AND end_date > NOW()
ORDER BY end_date ASC
LIMIT 20;

-- 6. SYSTEM HEALTH CHECK (One-liner)
SELECT 
  CASE 
    WHEN sync_job_active = false THEN '❌ SYNC JOB INACTIVE'
    WHEN sync_job_old > INTERVAL '30 minutes' THEN '❌ SYNC JOB NOT RUNNING'
    WHEN queue_pending > 2000 THEN '⚠️ LARGE QUEUE BACKLOG'
    WHEN auctions_stale > 10 THEN '⚠️ MANY STALE AUCTIONS'
    ELSE '✅ ALL SYSTEMS OK'
  END as overall_status,
  sync_job_active,
  sync_job_old,
  queue_pending,
  auctions_stale,
  active_auctions
FROM (
  SELECT 
    (SELECT active FROM cron.job WHERE jobname = 'sync-active-auctions') as sync_job_active,
    (SELECT NOW() - start_time FROM cron.job_run_details 
     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'sync-active-auctions')
     ORDER BY start_time DESC LIMIT 1) as sync_job_old,
    (SELECT COUNT(*) FROM bat_extraction_queue WHERE status = 'pending') as queue_pending,
    (SELECT COUNT(*) FROM external_listings 
     WHERE listing_status = 'active' 
       AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '30 minutes')) as auctions_stale,
    (SELECT COUNT(*) FROM external_listings WHERE listing_status = 'active') as active_auctions
) health;

