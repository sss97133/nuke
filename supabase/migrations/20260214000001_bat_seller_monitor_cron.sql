-- BAT Seller Monitor Cron Job
-- Runs every 6 hours to check all active bat_seller_monitors
-- Uses the process-bat-seller-monitors edge function which:
--   1. Scrapes each seller's BaT profile via Firecrawl
--   2. Discovers listing URLs
--   3. Creates vehicles + external_listings for new ones
--   4. Queues them for full extraction
--   5. Updates monitor stats

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('bat-seller-monitor-sweep') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'bat-seller-monitor-sweep'
);

SELECT cron.schedule(
  'bat-seller-monitor-sweep',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-seller-monitors',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);
