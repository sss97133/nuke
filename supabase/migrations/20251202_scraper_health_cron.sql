-- Set up automated health monitoring for scrapers
-- Runs check-scraper-health function every hour to monitor reliability

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing health check job if it exists
SELECT cron.unschedule('hourly-scraper-health-check') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hourly-scraper-health-check'
);

-- Schedule hourly health check
SELECT cron.schedule(
  'hourly-scraper-health-check',
  '0 * * * *', -- Every hour on the hour
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/check-scraper-health',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      timeout_milliseconds := 30000  -- 30 second timeout
    ) AS request_id;
  $$
);

-- Verify job was created
SELECT 
  jobid, 
  jobname, 
  schedule, 
  active,
  LEFT(command, 100) as command_preview
FROM cron.job 
WHERE jobname = 'hourly-scraper-health-check';

COMMENT ON EXTENSION pg_cron IS 'PostgreSQL job scheduler for automated tasks';

