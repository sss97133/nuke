-- Set up daily Craigslist scraping automation
-- Runs scrape-all-craigslist-squarebodies daily at 2 AM

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- IMPORTANT: Service role key must be set first
-- Run this once: ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';

-- Remove existing job if it exists
SELECT cron.unschedule('daily-craigslist-squarebodies') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-craigslist-squarebodies'
);

-- Schedule daily comprehensive Craigslist scrape
SELECT cron.schedule(
  'daily-craigslist-squarebodies',
  '0 2 * * *', -- Every day at 2 AM
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'max_regions', 100,
        'max_listings_per_search', 100
      ),
      timeout_milliseconds := 900000  -- 15 minute timeout
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
WHERE jobname = 'daily-craigslist-squarebodies';

-- View recent runs (after first run)
-- SELECT * FROM cron.job_run_details 
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'daily-craigslist-squarebodies')
-- ORDER BY start_time DESC LIMIT 10;

