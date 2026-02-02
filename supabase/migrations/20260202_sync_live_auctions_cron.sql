-- ============================================================================
-- SYNC LIVE AUCTIONS CRON JOB
-- ============================================================================
-- Purpose: Automatically sync live auction listings from BaT, Collecting Cars, etc.
--          Runs every 15 minutes to keep the live auctions view populated.
--
-- This function syncs the vehicles table with auction_status = 'active' by
-- scraping live auction data from each platform's public pages.
-- ============================================================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if it exists
SELECT cron.unschedule('sync-live-auctions')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-live-auctions');

-- Schedule sync job: Every 15 minutes
-- Syncs BaT, Collecting Cars (paginated to 10k), and Cars & Bids live auctions.
-- Vehicles get auction_status='active' and sale_status='auction_live' for UI/stats parity.
-- If app.settings.service_role_key or app.service_role_key is set, auth is sent; else function must allow anon (no-verify-jwt).
SELECT cron.schedule(
  'sync-live-auctions',
  '*/15 * * * *', -- Every 15 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-live-auctions',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          current_setting('app.settings.service_role_key', true),
          current_setting('app.service_role_key', true),
          ''
        )
      ),
      body := jsonb_build_object(
        'action', 'sync'
      ),
      timeout_milliseconds := 300000
    ) AS request_id;
  $$
);

-- Verify job was created
SELECT
  jobid,
  jobname,
  schedule,
  active,
  LEFT(command, 150) as command_preview
FROM cron.job
WHERE jobname = 'sync-live-auctions';

COMMENT ON EXTENSION pg_cron IS 'Job scheduler for PostgreSQL - runs sync-live-auctions every 15 minutes';
