-- ISSIMI's timed auctions on the live board, when it runs one.
--
-- WHY (measured 2026-10-20 20:2xZ): ISSIMI's /listings state held 414 listings: 354 timed public auctions (3-day
-- windows, USD and EUR, 99 with a top bid), the last of which closed 2026-06-18 15:46Z; the 30 open listings are offers
-- with no bidding window and private sales. No ISSIMI auction is open now, so the board shows none; the reader is in place
-- for the next one. live_auction_sources 'issimi' last synced 2026-02-18.
--
-- WHAT: sync-live-auctions reads the /listings page state (__NEXT_DATA__ initialAuctions) and keeps the public auctions
-- whose bidding window is open (top bid, currency as the house records it, close moved by its soft close, image),
-- upserts them through upsert_live_auction_vehicles (platform_source 'issimi') and hands the complete list to
-- live_auction_board_sync. The page is about 2 MB, so while the schedule holds no open ISSIMI lot it is read in the first
-- run of each hour only, and every run while one is open. This migration
--   * adds ISSIMI to live_board_houses (enabled), so market_pulse_live_houses reads its lots when there are any;
--   * adds 'issimi' to the platforms the sync-live-auctions-houses job (every five minutes) posts, appended to whatever
--     list the job carries now, so another house's migration is never undone.
-- Contract: supabase/sql/test_issimi_live_board.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note)
VALUES ('issimi', 'ISSIMI', '^https?://([a-z0-9-]+\.)*issimi\.com/', true,
        'sync-live-auctions-houses: timed public auctions from the listings state; hourly while none is open (none since 2026-06-18)')
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
  IF NOT (v_body -> 'platforms') ? 'issimi' THEN
    v_body := jsonb_set(v_body, '{platforms}', (v_body -> 'platforms') || '["issimi"]'::jsonb);
    PERFORM cron.alter_job(job_id := v_job, command := replace(v_cmd, v_old, v_body::text));
  END IF;
END
$job$;

COMMIT;
