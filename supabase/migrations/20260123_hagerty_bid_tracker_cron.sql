-- Hagerty Bid Tracker Cron Job
-- Runs hourly to track bid progression on active Hagerty auctions
-- Stores bid snapshots in external_listings.metadata.bid_history[]

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if it exists
SELECT cron.unschedule('hagerty-bid-tracker') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'hagerty-bid-tracker'
);

-- Schedule hourly tracking of active Hagerty auctions
SELECT cron.schedule(
  'hagerty-bid-tracker',
  '0 * * * *', -- Every hour at minute 0
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/hagerty-bid-tracker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'limit', 50
      )
    ) AS request_id;
  $$
);

-- Also run every 15 minutes during peak auction hours (6 PM - 10 PM ET = 22:00 - 02:00 UTC)
SELECT cron.schedule(
  'hagerty-bid-tracker-peak',
  '*/15 22-23,0-2 * * *', -- Every 15 min from 10 PM - 2 AM UTC (6 PM - 10 PM ET)
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/hagerty-bid-tracker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'limit', 50
      )
    ) AS request_id;
  $$
);

COMMENT ON EXTENSION pg_cron IS 'Hagerty bid tracker runs hourly, with extra runs during peak auction hours';
