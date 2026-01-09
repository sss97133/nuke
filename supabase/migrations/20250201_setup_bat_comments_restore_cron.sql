-- Setup BaT Comments Restoration Cron Job
-- Automatically restores BaT comments for vehicles that need them
-- Runs daily at 2 AM to restore comments for vehicles missing them
--
-- SERVICE ROLE KEY SETUP (Choose ONE method):
--
-- Method 1 (Recommended): Auto-sync from Edge Function secrets
--   1. Deploy sync-service-key-to-db Edge Function (if not already deployed)
--   2. Call it once: POST /functions/v1/sync-service-key-to-db
--   3. This automatically syncs the key from Edge Function secrets to _app_secrets table
--
-- Method 2: Manual database setting
--   ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
--   Get your service role key from: Dashboard → Settings → API → service_role key

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Note: get_service_role_key_for_cron() helper function should already exist
-- from migration 20250128000001_fix_all_cron_jobs.sql
-- If it doesn't exist, it will be created by that migration

-- Remove existing job if it exists
SELECT cron.unschedule('restore-bat-comments') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'restore-bat-comments'
);

-- Schedule the restoration job: Runs daily at 2 AM
-- Processes vehicles that have BaT URLs but are missing comments
-- Uses get_service_role_key_for_cron() which checks _app_secrets first (synced from Edge Function secrets)
SELECT cron.schedule(
  'restore-bat-comments',
  '0 2 * * *', -- Daily at 2 AM
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/restore-bat-comments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true)
      )
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

