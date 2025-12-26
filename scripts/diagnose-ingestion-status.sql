-- DIAGNOSTIC QUERIES FOR INGESTION STATUS
-- Run these in Supabase Dashboard → SQL Editor to diagnose ingestion failures

-- ============================================
-- 1. IMPORT QUEUE STATUS OVERVIEW
-- ============================================
SELECT 
  status,
  COUNT(*) as count,
  COUNT(DISTINCT source_id) as unique_sources,
  MIN(created_at) as oldest_pending,
  MAX(created_at) as newest_pending
FROM import_queue
GROUP BY status
ORDER BY count DESC;

-- ============================================
-- 2. FAILED ITEMS (Recent)
-- ============================================
SELECT 
  id,
  listing_url,
  status,
  attempts,
  error_message,
  source_id,
  created_at,
  processed_at,
  next_attempt_at
FROM import_queue
WHERE status = 'failed'
ORDER BY processed_at DESC
LIMIT 20;

-- ============================================
-- 3. PENDING ITEMS (Stuck/Locked)
-- ============================================
SELECT 
  id,
  listing_url,
  status,
  attempts,
  locked_at,
  locked_by,
  next_attempt_at,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at))/3600 as hours_old
FROM import_queue
WHERE status = 'pending'
  AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '1 hour')
  AND (next_attempt_at IS NULL OR next_attempt_at < NOW())
ORDER BY created_at ASC
LIMIT 50;

-- ============================================
-- 4. PROCESSING ITEMS (Potentially Stuck)
-- ============================================
SELECT 
  id,
  listing_url,
  status,
  attempts,
  locked_at,
  locked_by,
  EXTRACT(EPOCH FROM (NOW() - locked_at))/60 as minutes_locked
FROM import_queue
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '30 minutes'
ORDER BY locked_at ASC
LIMIT 20;

-- ============================================
-- 5. SOURCE HEALTH STATUS
-- ============================================
SELECT 
  domain,
  source_name,
  is_active,
  last_scraped_at,
  last_successful_scrape,
  total_listings_found,
  EXTRACT(EPOCH FROM (NOW() - last_scraped_at))/3600 as hours_since_last_scrape,
  EXTRACT(EPOCH FROM (NOW() - last_successful_scrape))/3600 as hours_since_last_success
FROM scrape_sources
ORDER BY last_scraped_at DESC NULLS LAST;

-- ============================================
-- 6. RECENT VEHICLE CREATIONS (Last 24h)
-- ============================================
SELECT 
  discovery_source,
  COUNT(*) as vehicles_created,
  MAX(created_at) as last_created
FROM vehicles
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY discovery_source
ORDER BY vehicles_created DESC;

-- ============================================
-- 7. QUEUE PROCESSING RATE (Last 24h)
-- ============================================
SELECT 
  DATE_TRUNC('hour', processed_at) as hour,
  status,
  COUNT(*) as count
FROM import_queue
WHERE processed_at > NOW() - INTERVAL '24 hours'
GROUP BY hour, status
ORDER BY hour DESC, status;

-- ============================================
-- 8. ERROR PATTERNS (Top Errors)
-- ============================================
SELECT 
  LEFT(error_message, 100) as error_preview,
  COUNT(*) as occurrence_count,
  MAX(processed_at) as last_occurrence
FROM import_queue
WHERE status = 'failed'
  AND error_message IS NOT NULL
GROUP BY LEFT(error_message, 100)
ORDER BY occurrence_count DESC
LIMIT 10;

-- ============================================
-- 9. CRON JOB STATUS
-- ============================================
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  last_run_started_at,
  last_run_finished_at,
  last_run_status,
  last_run_duration_ms
FROM cron.job
WHERE jobname LIKE '%import%' OR jobname LIKE '%queue%'
ORDER BY jobname;

-- ============================================
-- 10. SOURCE ACTIVITY (Last 7 Days)
-- ============================================
SELECT 
  s.domain,
  s.source_name,
  COUNT(DISTINCT q.id) as items_in_queue,
  COUNT(DISTINCT CASE WHEN q.status = 'pending' THEN q.id END) as pending,
  COUNT(DISTINCT CASE WHEN q.status = 'failed' THEN q.id END) as failed,
  COUNT(DISTINCT CASE WHEN q.status = 'complete' THEN q.id END) as completed,
  MAX(q.created_at) as last_item_added
FROM scrape_sources s
LEFT JOIN import_queue q ON q.source_id = s.id
WHERE s.is_active = true
GROUP BY s.id, s.domain, s.source_name
ORDER BY items_in_queue DESC;

