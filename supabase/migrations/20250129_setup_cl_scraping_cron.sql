-- Set up cron jobs for Craigslist squarebody scraping
-- Discovery: Runs daily to find new listings
-- Processing: Runs every 30 minutes to process queue

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Get service role key from settings (must be set first)
-- Run this first: ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';

-- Remove existing jobs if they exist
SELECT cron.unschedule('cl-discover-squarebodies') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cl-discover-squarebodies'
);

SELECT cron.unschedule('cl-process-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cl-process-queue'
);

-- Schedule discovery job: Run daily at 2 AM (finds new listings)
SELECT cron.schedule(
  'cl-discover-squarebodies',
  '0 2 * * *', -- Daily at 2 AM
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/discover-cl-squarebodies',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'max_regions', null, -- All regions
        'max_searches_per_region', 10 -- Limit to avoid timeout
      )
    ) AS request_id;
  $$
);

-- Schedule processing job: Run every 30 minutes (processes queue)
SELECT cron.schedule(
  'cl-process-queue',
  '*/30 * * * *', -- Every 30 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-cl-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'batch_size', 15 -- Process 15 listings per run
      )
    ) AS request_id;
  $$
);

-- View scheduled jobs
SELECT jobid, jobname, schedule, command 
FROM cron.job 
WHERE jobname IN ('cl-discover-squarebodies', 'cl-process-queue');

-- To manually trigger discovery (for testing):
-- SELECT net.http_post(
--   url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/discover-cl-squarebodies',
--   headers := jsonb_build_object(
--     'Content-Type', 'application/json',
--     'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
--   ),
--   body := jsonb_build_object(
--     'max_regions', 5, -- Test with 5 regions
--     'max_searches_per_region', 5
--   )
-- );

-- To manually trigger processing (for testing):
-- SELECT net.http_post(
--   url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-cl-queue',
--   headers := jsonb_build_object(
--     'Content-Type', 'application/json',
--     'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
--   ),
--   body := jsonb_build_object(
--     'batch_size', 5 -- Test with 5 listings
--   )
-- );

-- To unschedule (if needed):
-- SELECT cron.unschedule('cl-discover-squarebodies');
-- SELECT cron.unschedule('cl-process-queue');

