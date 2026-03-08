-- Setup BaT Queue Processor Cron Job
-- Run this in Supabase Dashboard → SQL Editor

-- Step 1: Set service role key (REQUIRED - get from Settings → API → service_role key)
-- Replace YOUR_SERVICE_ROLE_KEY with your actual key
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY_HERE';

-- Step 2: Remove existing job if it exists
SELECT cron.unschedule('process-bat-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-bat-queue'
);

-- Step 3: Create cron job (processes 10 vehicles every 5 minutes)
SELECT cron.schedule(
  'process-bat-queue',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'batchSize', 10
    )
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

