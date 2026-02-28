-- Migration: cron_startup_timeout_alert
-- Adds:
--   1. count_startup_timeouts_last_2min() — counts pg_cron startup timeouts in
--      the last 2 minutes (called from the edge function via RPC)
--   2. pg_cron job 327: every 5 min → cron-startup-timeout-alert edge function
--
-- Reference: docs/post-mortems/2026-02-27-pgrst002-schema-cache-outage.md
-- Prevention P4: fire Telegram alert when >10 startup timeouts occur in 1-min window

-- ─── 1. RPC: count startup timeouts in last 2 minutes ─────────────────────

CREATE OR REPLACE FUNCTION count_startup_timeouts_last_2min()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = cron, public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM cron.job_run_details
  WHERE start_time > NOW() - INTERVAL '2 minutes'
    AND return_message LIKE '%startup timeout%';
$$;

-- Allow the service role (used by edge functions) to call this
GRANT EXECUTE ON FUNCTION count_startup_timeouts_last_2min() TO service_role;

-- ─── 2. pg_cron job: every 5 minutes ──────────────────────────────────────

-- Remove any prior version to avoid duplicates
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-startup-timeout-alert') THEN
    PERFORM cron.unschedule('cron-startup-timeout-alert');
  END IF;
END;
$$;

SELECT cron.schedule(
  'cron-startup-timeout-alert',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/cron-startup-timeout-alert',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body    := '{}'::jsonb
  );
  $$
);
