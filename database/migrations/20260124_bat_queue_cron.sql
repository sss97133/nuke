-- BAT Queue Worker Cron Jobs
-- Sets up parallel extraction workers via pg_cron
--
-- IMPORTANT: Run this in Supabase SQL editor after enabling pg_cron extension
--
-- To enable pg_cron (one-time, via Dashboard > Extensions):
--   1. Go to Database > Extensions
--   2. Search for "pg_cron"
--   3. Enable it
--
-- Then run this migration.

-- First, ensure pg_cron is enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant cron usage to postgres (if not already)
GRANT USAGE ON SCHEMA cron TO postgres;

-- Create a wrapper function to call the edge function
-- This uses pg_net for HTTP calls (should already be enabled in Supabase)
CREATE OR REPLACE FUNCTION trigger_bat_queue_worker(batch_size INT DEFAULT 20)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  supabase_url TEXT;
  service_key TEXT;
BEGIN
  -- Get secrets from vault (requires setup) or use environment
  -- For now, use direct URL - the function is deployed with --no-verify-jwt
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);

  -- Use pg_net to call the edge function
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/bat-queue-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object('batch_size', batch_size)
  );
END;
$$;

-- Schedule 3 parallel workers every minute
-- Each worker processes 20 BaT URLs with stealth delays
-- Expected throughput: ~60 URLs/minute = 3,600/hour

-- Worker 1: Runs at second 0
SELECT cron.schedule(
  'bat-queue-worker-1',
  '* * * * *',  -- Every minute
  $$SELECT trigger_bat_queue_worker(20)$$
);

-- Worker 2: Runs at second 20 (staggered)
SELECT cron.schedule(
  'bat-queue-worker-2',
  '* * * * *',
  $$SELECT pg_sleep(20); SELECT trigger_bat_queue_worker(20)$$
);

-- Worker 3: Runs at second 40 (staggered)
SELECT cron.schedule(
  'bat-queue-worker-3',
  '* * * * *',
  $$SELECT pg_sleep(40); SELECT trigger_bat_queue_worker(20)$$
);

-- View scheduled jobs
SELECT * FROM cron.job;

-- To pause all workers:
-- SELECT cron.unschedule('bat-queue-worker-1');
-- SELECT cron.unschedule('bat-queue-worker-2');
-- SELECT cron.unschedule('bat-queue-worker-3');

-- To check job history:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

COMMENT ON FUNCTION trigger_bat_queue_worker IS
'Triggers the bat-queue-worker edge function to process BaT URLs from import_queue.
Uses atomic claim to prevent duplicates across parallel workers.';
