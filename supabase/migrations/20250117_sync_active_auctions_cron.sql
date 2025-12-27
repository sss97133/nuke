-- ============================================================================
-- SYNC ACTIVE AUCTIONS CRON JOB
-- ============================================================================
-- Purpose: Automatically sync all active auction listings to keep bid counts
--          and current bids up-to-date. Runs every 15 minutes.
--
-- Sync Strategy:
-- - Only syncs listings that haven't been synced in last 15 minutes (rate limiting)
-- - Processes listings in batches (20 per run) to avoid timeouts
-- - Groups by platform to use appropriate sync functions
-- - Updates last_synced_at timestamp to track sync frequency
-- ============================================================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Helper function to get listings that need syncing (optimized query)
CREATE OR REPLACE FUNCTION get_listings_needing_sync(
  cooldown_threshold TIMESTAMPTZ,
  batch_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  platform TEXT,
  listing_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    el.id,
    el.platform,
    el.listing_url
  FROM external_listings el
  WHERE el.listing_status = 'active'
    AND el.sync_enabled = TRUE
    AND (el.last_synced_at IS NULL OR el.last_synced_at < cooldown_threshold)
  ORDER BY el.last_synced_at NULLS FIRST, el.created_at
  LIMIT batch_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- IMPORTANT: Service role key must be set first
-- Run this once: ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
-- Get your service role key from: Supabase Dashboard → Settings → API → Service Role Key

-- Remove existing job if it exists
SELECT cron.unschedule('sync-active-auctions') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-active-auctions'
);

-- Schedule sync job: Every 15 minutes
-- This ensures active auctions stay current without overwhelming external sites
SELECT cron.schedule(
  'sync-active-auctions',
  '*/15 * * * *', -- Every 15 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-active-auctions',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          current_setting('app.settings.service_role_key', true),
          current_setting('app.service_role_key', true)
        )
      ),
      body := jsonb_build_object(
        'batch_size', 20
      ),
      timeout_milliseconds := 120000 -- 2 minute timeout
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
WHERE jobname = 'sync-active-auctions';

COMMENT ON FUNCTION get_listings_needing_sync IS 'Helper function to efficiently query active listings that need syncing (not synced recently)';
COMMENT ON JOB cron.job IS 'Syncs active auction listings (BaT, Cars & Bids) every 15 minutes to keep bid counts and current bids current';
