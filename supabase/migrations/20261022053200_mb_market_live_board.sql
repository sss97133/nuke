-- The MB Market's open auctions on the live board.
--
-- WHY (measured 2026-10-20 20:03Z): The MB Market (thembmarket.com) had 11 open timed auctions, 9 of them vehicles
-- (2 parts lots), 6 with a current bid, all in US dollars, closing 2026-10-21 to 2026-10-28 with soft-close
-- extensions. None was on the board: live_auction_sources 'mb-market' last synced 2026-02-18.
--
-- WHAT: sync-live-auctions reads the house's live list from the endpoint its browse page calls (get_auction_list,
-- type live, and type no-reserve for the reserve flag) and a lot page only for a lot that is new or whose bid moved
-- (close time and bid count from the page: time_ends_ts and the bid-history count), upserts the vehicle lots through
-- upsert_live_auction_vehicles (platform_source 'mb-market') and hands the complete list to live_auction_board_sync.
-- This migration
--   * adds The MB Market to live_board_houses (enabled), so market_pulse_live_houses reads its lots;
--   * adds 'mb-market' to the platforms the sync-live-auctions-houses job (every five minutes) posts, appended to
--     whatever list the job carries now, so another house's migration is never undone.
-- Contract: supabase/sql/test_mb_market_live_board.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note)
VALUES ('mb-market', 'The MB Market', '^https?://([a-z0-9-]+\.)*thembmarket\.com/', true,
        'sync-live-auctions-houses, every five minutes: the live list (vehicles only; parts lots carry no year)')
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
  IF NOT (v_body -> 'platforms') ? 'mb-market' THEN
    v_body := jsonb_set(v_body, '{platforms}', (v_body -> 'platforms') || '["mb-market"]'::jsonb);
    PERFORM cron.alter_job(job_id := v_job, command := replace(v_cmd, v_old, v_body::text));
  END IF;
END
$job$;

COMMIT;
