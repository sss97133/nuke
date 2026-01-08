-- Fix BaT Queue Cron Job - SLOW & ACCURATE (batchSize: 1)
-- Run this in Supabase Dashboard → SQL Editor

-- Step 1: Check current cron jobs for BaT queue
SELECT jobid, jobname, schedule, active, command
FROM cron.job 
WHERE jobname LIKE '%bat%' OR command LIKE '%process-bat-extraction-queue%';

-- Step 2: Remove existing BaT queue cron jobs
SELECT cron.unschedule('process-bat-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-bat-queue'
);

-- Step 3: Create new cron job - SLOW & ACCURATE (1 at a time, every 5 minutes)
-- IMPORTANT: Replace YOUR_SERVICE_ROLE_KEY_HERE with your actual service_role key
SELECT cron.schedule(
  'process-bat-queue',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg'  -- REPLACE THIS!
    ),
    body := jsonb_build_object(
      'batchSize', 1,  -- SLOW & ACCURATE: Process 1 at a time
      'maxAttempts', 3
    ),
    timeout_milliseconds := 300000  -- 5 minutes timeout
  ) AS request_id;
  $$
);

-- Step 4: Verify it was created
SELECT jobid, jobname, schedule, active 
FROM cron.job 
WHERE jobname = 'process-bat-queue';

-- Step 5: Check recent runs (after first run)
-- SELECT * FROM cron.job_run_details 
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'process-bat-queue')
-- ORDER BY start_time DESC LIMIT 10;

