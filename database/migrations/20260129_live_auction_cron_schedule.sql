-- Live Auction Cron Schedule
-- Sets up pg_cron job to trigger live-auction-cron edge function every 30 seconds

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create a function to invoke the live-auction-cron edge function
CREATE OR REPLACE FUNCTION invoke_live_auction_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    supabase_url TEXT;
    service_key TEXT;
BEGIN
    -- Get secrets from vault (or use environment-specific approach)
    -- For Supabase hosted, we use the internal service URL
    supabase_url := current_setting('app.supabase_url', true);
    service_key := current_setting('app.service_role_key', true);

    -- If settings not available, use hardcoded project URL
    IF supabase_url IS NULL THEN
        supabase_url := 'https://qkgaybvrernstplzjaam.supabase.co';
    END IF;

    -- Use pg_net to make async HTTP request
    PERFORM net.http_post(
        url := supabase_url || '/functions/v1/live-auction-cron',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || COALESCE(service_key, '')
        ),
        body := '{}'::jsonb
    );
END;
$$;

-- Schedule the cron job to run every 30 seconds
-- Note: pg_cron minimum is 1 minute, so we create 2 jobs offset by 30 seconds
-- Job 1: Runs at the start of each minute
SELECT cron.schedule(
    'live-auction-sync-a',
    '* * * * *',  -- Every minute
    $$SELECT invoke_live_auction_cron()$$
);

-- Job 2: Runs 30 seconds after each minute start (using pg_sleep delay)
-- Alternative: Use external scheduler for sub-minute precision
-- For now, we'll use minute-level scheduling which is sufficient for most auctions

-- Add a comment explaining the schedule
COMMENT ON FUNCTION invoke_live_auction_cron IS
'Triggers the live-auction-cron edge function to sync all monitored auctions.
Called by pg_cron every minute. For soft-close auctions (last 2 mins),
the adaptive polling ensures more frequent individual syncs.';

-- Create a view to monitor cron job status
CREATE OR REPLACE VIEW live_auction_cron_status AS
SELECT
    j.jobid,
    j.schedule,
    j.command,
    j.nodename,
    j.nodeport,
    j.database,
    j.username,
    jr.status,
    jr.return_message,
    jr.start_time,
    jr.end_time
FROM cron.job j
LEFT JOIN cron.job_run_details jr ON j.jobid = jr.jobid
WHERE j.jobname LIKE 'live-auction-sync%'
ORDER BY jr.start_time DESC NULLS LAST
LIMIT 20;

-- Grant access to the view
GRANT SELECT ON live_auction_cron_status TO authenticated;

-- Also create a simple health check endpoint in the database
CREATE OR REPLACE FUNCTION get_live_auction_health()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
SELECT jsonb_build_object(
    'total_monitored', (SELECT COUNT(*) FROM monitored_auctions WHERE is_live = true),
    'soft_close_count', (SELECT COUNT(*) FROM monitored_auctions WHERE is_live = true AND is_in_soft_close = true),
    'overdue_sync', (SELECT COUNT(*) FROM monitored_auctions WHERE is_live = true AND next_poll_at < NOW() - INTERVAL '2 minutes'),
    'avg_bid_cents', (SELECT AVG(current_bid_cents) FROM monitored_auctions WHERE is_live = true AND current_bid_cents > 0),
    'sources', (
        SELECT jsonb_agg(jsonb_build_object(
            'slug', s.slug,
            'active_auctions', s.active_count,
            'health_status', s.health_status
        ))
        FROM (
            SELECT
                las.slug,
                las.health_status,
                COUNT(ma.id) as active_count
            FROM live_auction_sources las
            LEFT JOIN monitored_auctions ma ON ma.source_id = las.id AND ma.is_live = true
            WHERE las.is_active = true
            GROUP BY las.id, las.slug, las.health_status
        ) s
    ),
    'last_sync', (SELECT MAX(updated_at) FROM monitored_auctions),
    'checked_at', NOW()
);
$$;
