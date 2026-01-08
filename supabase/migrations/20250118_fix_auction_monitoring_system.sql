-- ============================================================================
-- FIX AUCTION MONITORING SYSTEM
-- ============================================================================
-- Purpose: Fix critical issues with auction monitoring:
--   1. Update batch size from 20 to 50 (process more listings per run)
--   2. Update helper function default batch size
--   3. Add verification functions to check cron job health
--   4. Ensure both external_listings and bat_listings stay in sync
-- ============================================================================

-- Update helper function to use new default batch size
CREATE OR REPLACE FUNCTION get_listings_needing_sync(
  cooldown_threshold TIMESTAMPTZ,
  batch_limit INTEGER DEFAULT 50  -- Increased from 20 to 50
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

-- Update the cron job to use new batch size
SELECT cron.unschedule('sync-active-auctions') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-active-auctions'
);

-- Reschedule with updated batch size
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
        'batch_size', 50  -- Increased from 20 to 50
      ),
      timeout_milliseconds := 180000 -- Increased to 3 minutes (50 listings * ~3s each)
    ) AS request_id;
  $$
);

-- ============================================================================
-- VERIFICATION FUNCTIONS
-- ============================================================================

-- Function to check if sync cron job is active and running
CREATE OR REPLACE FUNCTION check_auction_sync_health()
RETURNS TABLE (
  job_name TEXT,
  is_scheduled BOOLEAN,
  is_active BOOLEAN,
  schedule TEXT,
  last_run_time TIMESTAMPTZ,
  last_run_status TEXT,
  last_run_message TEXT,
  active_listings_count BIGINT,
  listings_needing_sync BIGINT,
  listings_synced_recently BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH job_info AS (
    SELECT 
      j.jobname,
      j.active,
      j.schedule,
      jrd.start_time,
      jrd.status,
      jrd.return_message
    FROM cron.job j
    LEFT JOIN LATERAL (
      SELECT start_time, status, return_message
      FROM cron.job_run_details
      WHERE jobid = j.jobid
      ORDER BY start_time DESC
      LIMIT 1
    ) jrd ON true
    WHERE j.jobname = 'sync-active-auctions'
  ),
  listing_stats AS (
    SELECT 
      COUNT(*) FILTER (WHERE listing_status = 'active' AND sync_enabled = TRUE) as active_count,
      COUNT(*) FILTER (WHERE listing_status = 'active' 
                       AND sync_enabled = TRUE 
                       AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '15 minutes')) as needing_sync,
      COUNT(*) FILTER (WHERE listing_status = 'active' 
                       AND sync_enabled = TRUE 
                       AND last_synced_at >= NOW() - INTERVAL '15 minutes') as synced_recently
    FROM external_listings
  )
  SELECT 
    COALESCE(ji.jobname, 'sync-active-auctions'::TEXT) as job_name,
    (ji.jobname IS NOT NULL) as is_scheduled,
    COALESCE(ji.active, false) as is_active,
    COALESCE(ji.schedule, 'NOT SCHEDULED'::TEXT) as schedule,
    ji.start_time as last_run_time,
    COALESCE(ji.status, 'unknown'::TEXT) as last_run_status,
    LEFT(COALESCE(ji.return_message, ''), 200) as last_run_message,
    ls.active_count as active_listings_count,
    ls.needing_sync as listings_needing_sync,
    ls.synced_recently as listings_synced_recently
  FROM listing_stats ls
  LEFT JOIN job_info ji ON true
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check sync coverage (how many active listings get synced)
CREATE OR REPLACE FUNCTION check_sync_coverage()
RETURNS TABLE (
  total_active_listings BIGINT,
  listings_synced_last_hour BIGINT,
  listings_synced_last_15min BIGINT,
  listings_never_synced BIGINT,
  avg_minutes_since_sync NUMERIC,
  coverage_percent NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) FILTER (WHERE listing_status = 'active' AND sync_enabled = TRUE) as total_active,
    COUNT(*) FILTER (WHERE listing_status = 'active' 
                     AND sync_enabled = TRUE 
                     AND last_synced_at >= NOW() - INTERVAL '1 hour') as synced_1h,
    COUNT(*) FILTER (WHERE listing_status = 'active' 
                     AND sync_enabled = TRUE 
                     AND last_synced_at >= NOW() - INTERVAL '15 minutes') as synced_15min,
    COUNT(*) FILTER (WHERE listing_status = 'active' 
                     AND sync_enabled = TRUE 
                     AND last_synced_at IS NULL) as never_synced,
    COALESCE(
      AVG(EXTRACT(EPOCH FROM (NOW() - last_synced_at)) / 60) FILTER (
        WHERE listing_status = 'active' AND sync_enabled = TRUE AND last_synced_at IS NOT NULL
      ),
      0
    )::NUMERIC(10, 2) as avg_minutes,
    COALESCE(
      (COUNT(*) FILTER (WHERE listing_status = 'active' 
                        AND sync_enabled = TRUE 
                        AND last_synced_at >= NOW() - INTERVAL '1 hour')::NUMERIC / 
       NULLIF(COUNT(*) FILTER (WHERE listing_status = 'active' AND sync_enabled = TRUE), 0)) * 100,
      0
    )::NUMERIC(5, 2) as coverage_pct
  FROM external_listings;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify the job was updated
SELECT 
  jobid, 
  jobname, 
  schedule, 
  active,
  LEFT(command, 200) as command_preview
FROM cron.job 
WHERE jobname = 'sync-active-auctions';

-- Run health check
SELECT * FROM check_auction_sync_health();

-- Comments
COMMENT ON FUNCTION get_listings_needing_sync IS 'Helper function to efficiently query active listings that need syncing (not synced recently). Updated batch size default to 50.';
COMMENT ON FUNCTION check_auction_sync_health IS 'Check if sync cron job is scheduled, active, and running. Returns job status and listing statistics.';
COMMENT ON FUNCTION check_sync_coverage IS 'Check sync coverage - how many active listings have been synced recently. Useful for monitoring system health.';

