-- Setup BaT Comments Restoration Cron Job
-- Automatically restores BaT comments for vehicles that need them
-- Runs daily at 2 AM to restore comments for vehicles missing them
--
-- IMPORTANT: Service role key must be set first:
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
-- Get your service role key from: Dashboard → Settings → API → service_role key

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if it exists
SELECT cron.unschedule('restore-bat-comments') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'restore-bat-comments'
);

-- Schedule the restoration job: Runs daily at 2 AM
-- Processes vehicles that have BaT URLs but are missing comments
SELECT cron.schedule(
  'restore-bat-comments',
  '0 2 * * *', -- Daily at 2 AM
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/restore-bat-comments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'batch_size', 50,  -- Process 50 vehicles per run
      'max_runs_per_day', 1  -- Only run once per day
    )
  ) AS request_id;
  $$
);

-- Verify job was created
SELECT jobid, jobname, schedule, active, command
FROM cron.job 
WHERE jobname = 'restore-bat-comments';

-- View all BaT-related cron jobs
SELECT jobid, jobname, schedule, active
FROM cron.job 
WHERE jobname LIKE '%bat%' OR jobname LIKE '%BaT%'
ORDER BY jobname;

