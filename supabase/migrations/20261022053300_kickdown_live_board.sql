-- Kickdown's running auctions on the live board.
--
-- WHY (measured 2026-10-20 20:11Z): Kickdown (kickdown.com, Germany) had 45 running timed auctions, 40 with a current bid,
-- every amount in euros, 2 without reserve, closing 2026-10-21 19:30+02:00 to 2026-10-29 19:40+01:00. None was on the
-- board: live_auction_sources 'kickdown' last synced 2026-02-18.
--
-- WHAT: sync-live-auctions reads the house's server-rendered live board (/en/auctions/live, 2 pages: bid, close time with
-- offset or the printed German time, reserve badge) and its live RSS feed for lot images (the board's own image links are
-- 6-hour signed links), upserts the lots through upsert_live_auction_vehicles (platform_source 'kickdown', currency EUR as
-- the house prints it; the board never converts) and hands the complete list to live_auction_board_sync. The house
-- prints no bid count. This migration
--   * adds Kickdown to live_board_houses (enabled), so market_pulse_live_houses reads its lots;
--   * adds 'kickdown' to the platforms the sync-live-auctions-houses job (every five minutes) posts, appended to whatever
--     list the job carries now, so another house's migration is never undone.
-- Contract: supabase/sql/test_kickdown_live_board.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note)
VALUES ('kickdown', 'Kickdown', '^https?://([a-z0-9-]+\.)*kickdown\.com/', true,
        'sync-live-auctions-houses, every five minutes: the live board; bids in EUR; no bid count published')
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
  IF NOT (v_body -> 'platforms') ? 'kickdown' THEN
    v_body := jsonb_set(v_body, '{platforms}', (v_body -> 'platforms') || '["kickdown"]'::jsonb);
    PERFORM cron.alter_job(job_id := v_job, command := replace(v_cmd, v_old, v_body::text));
  END IF;
END
$job$;

COMMIT;
