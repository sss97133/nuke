-- Setup BaT Queue Processor Cron Job (FIXED - No Database Settings Required)
-- Run this in Supabase Dashboard → SQL Editor
--
-- IMPORTANT: Replace YOUR_SERVICE_ROLE_KEY_HERE with your actual service_role key
-- Get it from: Dashboard → Settings → API → service_role key (starts with eyJ...)

-- Step 1: Remove existing job if it exists
SELECT cron.unschedule('process-bat-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-bat-queue'
);

-- Step 2: Create cron job with hardcoded key (replace YOUR_SERVICE_ROLE_KEY_HERE)
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
      'batchSize', 10
    )
  ) AS request_id;
  $$
);

-- Step 3: Verify it was created
SELECT jobid, jobname, schedule, active 
FROM cron.job 
WHERE jobname = 'process-bat-queue';

-- Step 4: Check recent runs (after first run)
-- SELECT * FROM cron.job_run_details 
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'process-bat-queue')
-- ORDER BY start_time DESC LIMIT 10;

