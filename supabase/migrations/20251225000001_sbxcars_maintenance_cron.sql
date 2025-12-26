-- SBX Cars Maintenance Cron Jobs
-- Discovery: Finds new listings every 6 hours
-- Monitoring: Updates existing listings every 30 minutes

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- IMPORTANT: Service role key must be set first
-- Run this once: ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
-- Get your service role key from: Supabase Dashboard → Settings → API → Service Role Key

-- Remove existing jobs if they exist
SELECT cron.unschedule('sbxcars-discover') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sbxcars-discover'
);

SELECT cron.unschedule('sbxcars-monitor') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sbxcars-monitor'
);

-- Schedule discovery: Every 6 hours (finds new listing URLs)
SELECT cron.schedule(
  'sbxcars-discover',
  '0 */6 * * *', -- Every 6 hours
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/discover-sbxcars-listings',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'max_pages', 50,
        'sections', ARRAY['auctions', 'upcoming', 'ended']
      )
    ) AS request_id;
  $$
);

-- Schedule monitoring: Every 30 minutes (updates active auctions)
SELECT cron.schedule(
  'sbxcars-monitor',
  '*/30 * * * *', -- Every 30 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-sbxcars-listings',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'batch_size', 50
      )
    ) AS request_id;
  $$
);

-- Verify jobs were created
SELECT 
  jobid, 
  jobname, 
  schedule, 
  active,
  LEFT(command, 100) as command_preview
FROM cron.job 
WHERE jobname IN ('sbxcars-discover', 'sbxcars-monitor')
ORDER BY jobname;

-- Comments
COMMENT ON EXTENSION pg_cron IS 'Enables cron jobs for SBX Cars maintenance';
COMMENT ON FUNCTION cron.schedule IS 'Schedules SBX Cars discovery (every 6h) and monitoring (every 30min)';

