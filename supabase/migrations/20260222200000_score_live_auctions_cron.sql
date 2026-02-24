-- ============================================================================
-- SCORE LIVE AUCTIONS CRON
-- ============================================================================
-- Purpose: After BaT auctions end, fetch hammer prices and update
--          external_listings + vehicles so sale_price/winning_bid stay in sync.
--          Without this, score-live-auctions was only run manually, so ended
--          auctions never got final_price backfilled.
--
-- Schedule: Every hour at :20 (so we pick up auctions that ended in the last hour).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('score-live-auctions')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'score-live-auctions');

-- Invoke score-live-auctions edge function (mode=score fetches final prices + scores predictions)
SELECT cron.schedule(
  'score-live-auctions',
  '20 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/score-live-auctions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := '{"mode":"score"}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

COMMENT ON EXTENSION pg_cron IS 'score-live-auctions runs hourly to backfill BaT hammer prices and score predictions';
