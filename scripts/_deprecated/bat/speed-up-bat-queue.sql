-- ============================================================================
-- Speed Up BaT Queue Processing
-- ============================================================================
-- 
-- This script speeds up the BaT extraction queue processing.
-- 
-- Steps:
-- 1. First, test with manual runs (use process-bat-queue-manual.js)
-- 2. Once stable, update cron to use larger batch size
-- 3. Optionally increase cron frequency
-- ============================================================================

-- Step 1: Remove existing slow cron job
SELECT cron.unschedule('process-bat-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-bat-queue'
);

-- Step 2: Create faster cron job with larger batch size
-- Options:
--   - batchSize: 10 (10 items every 5 min = 120/hour)
--   - batchSize: 20 (20 items every 5 min = 240/hour)
--   - batchSize: 50 (50 items every 5 min = 600/hour) - aggressive!

-- RECOMMENDED: Start with batchSize: 10
SELECT cron.schedule(
  'process-bat-queue',
  '*/5 * * * *', -- Every 5 minutes (or */2 for every 2 minutes)
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg'
    ),
    body := jsonb_build_object(
      'batchSize', 10  -- CHANGE THIS: 10 = moderate, 20 = fast, 50 = aggressive
    )
  ) AS request_id;
  $$
);

-- Step 3: Verify cron job was created
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname = 'process-bat-queue';

-- Step 4: Check current queue status
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percentage
FROM bat_extraction_queue
GROUP BY status
ORDER BY 
  CASE status
    WHEN 'pending' THEN 1
    WHEN 'processing' THEN 2
    WHEN 'complete' THEN 3
    WHEN 'failed' THEN 4
  END;

-- ============================================================================
-- ESTIMATED PROCESSING TIMES
-- ============================================================================
-- 
-- Current: 1 item every 5 min = 12/hour = 288/day = 5.5 days for 1,577 items
-- 
-- With batchSize: 10, every 5 min:
--   10 items every 5 min = 120/hour = 2,880/day = 13 hours for 1,577 items ✅
-- 
-- With batchSize: 20, every 5 min:
--   20 items every 5 min = 240/hour = 5,760/day = 7 hours for 1,577 items ✅✅
-- 
-- With batchSize: 50, every 5 min:
--   50 items every 5 min = 600/hour = 14,400/day = 2.6 hours for 1,577 items ✅✅✅
-- 
-- With batchSize: 10, every 2 min:
--   10 items every 2 min = 300/hour = 7,200/day = 5.3 hours for 1,577 items ✅✅
-- ============================================================================

-- ============================================================================
-- ROLLBACK (If things go wrong, revert to slow processing)
-- ============================================================================
/*
SELECT cron.unschedule('process-bat-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-bat-queue'
);

SELECT cron.schedule(
  'process-bat-queue',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg'
    ),
    body := jsonb_build_object('batchSize', 1)
  ) AS request_id;
  $$
);
*/
