-- Classic Trader's running auctions on the live board.
--
-- WHY (measured 2026-10-20 19:58Z): classic-trader.com/uk/auctions listed 25 running auctions (21 cars, 4 motorbikes),
-- 15 of them with a bid, in EUR (22) and CHF (3), closing 2026-10-21 to 2026-11-01; its car and motorbike auction
-- searches list the same 25 running. (The page shows 51 running cards because it repeats auctions across sections.)
-- None was on the board: no reader wrote its lots, vehicles held no row on the host, and live_auction_sources had no
-- row for it (source_registry has 'classic-trader', status pending).
--
-- WHAT: sync-live-auctions reads the page (one identified request a run, no retry; read directly, not archived: 5.2 MB
-- a read) and each card's own auction record (current highest bid, bid count, the auction's currency, absolute start
-- and end with offset, reserve state, estimate). It upserts the running regular auctions through
-- upsert_live_auction_vehicles (platform_source 'classic-trader', the ad's canonical link, the currency as the house
-- records it) and hands the complete list to live_auction_board_sync. This migration
--   * adds Classic Trader to live_auction_sources (live_auction_board_sync refuses a slug without a row there);
--   * adds Classic Trader to live_board_houses (enabled), so market_pulse_live_houses reads its lots;
--   * adds 'classic-trader' to the platforms the sync-live-auctions-houses job (every five minutes) posts, appended to
--     whatever list the job carries now, so another house's migration is never undone.
-- Contract: supabase/sql/test_classic_trader_live_board.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_auction_sources (slug, display_name, base_url, sync_method, auction_format, default_poll_interval_ms,
  has_soft_close, soft_close_window_seconds, auction_duration_typical, notes)
VALUES ('classic-trader', 'Classic Trader', 'https://www.classic-trader.com', 'polling_scrape', 'timed_online', 300000,
  true, 120, '12 or 15 days',
  '2026-10-20: timed online auctions (cars and motorbikes, EUR and CHF); a bid in the last 120 s (closing_buffer_seconds) '
  'moves the end. Read by sync-live-auctions from classic-trader.com/uk/auctions.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note)
VALUES ('classic-trader', 'Classic Trader', '^https?://([a-z0-9-]+\.)*classic-trader\.com/', true,
        'sync-live-auctions-houses, every five minutes: the auctions page (running regular auctions)')
ON CONFLICT (house) DO UPDATE SET enabled = true;

DO $job$
DECLARE
  v_job  bigint;
  v_cmd  text;
  v_old  text;
  v_body jsonb;
BEGIN
  SELECT jobid, command INTO v_job, v_cmd FROM cron.job WHERE jobname = 'sync-live-auctions-houses';
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'sync-live-auctions-houses is not scheduled (20261019021000_live_auction_board_sync_health)';
  END IF;
  v_old := substring(v_cmd FROM $re$body := '(\{[^']*\})'::jsonb$re$);
  IF v_old IS NULL OR jsonb_typeof(v_old::jsonb -> 'platforms') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'sync-live-auctions-houses: no platforms list in its body';
  END IF;
  v_body := v_old::jsonb;
  IF NOT (v_body -> 'platforms') ? 'classic-trader' THEN
    v_body := jsonb_set(v_body, '{platforms}', (v_body -> 'platforms') || '["classic-trader"]'::jsonb);
    PERFORM cron.alter_job(job_id := v_job, command := replace(v_cmd, v_old, v_body::text));
  END IF;
END
$job$;

COMMIT;
