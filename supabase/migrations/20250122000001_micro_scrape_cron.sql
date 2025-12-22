-- Automated Micro-Scrape Cron Job
-- Runs every 5 minutes to continuously improve vehicle data quality

-- Note: This requires pg_cron extension to be enabled
-- Enable with: CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule micro-scrape to run every 5 minutes
SELECT cron.schedule(
  'micro-scrape-bandaid',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/micro-scrape-bandaid',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
    ),
    body := jsonb_build_object(
      'batch_size', 20,
      'max_runtime_ms', 25000
    )
  );
  $$
);

-- Alternative: If pg_cron not available, use Supabase Edge Function cron
-- Set up via Supabase Dashboard → Database → Cron Jobs

COMMENT ON FUNCTION cron.schedule IS 'Schedules micro-scrape to run every 5 minutes automatically';

