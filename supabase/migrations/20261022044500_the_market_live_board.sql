-- The Market's open auctions on the live board.
--
-- WHY (measured 2026-10-20 19:59Z): themarket.co.uk/auctions/live listed 11 lots: 10 timed auctions open for bids,
-- every one with a bid, all in GBP, closing 2026-10-21 to 2026-10-27, and one whose auction closed on 2026-10-07 and is
-- now offered at a Buy Now price. None was on the board: live_auction_sources 'the-market' last synced 2026-02-18, no
-- reader wrote its lots, and vehicles held no row on the host.
--
-- WHAT: sync-live-auctions reads the page (through archiveFetch, one identified request, no retry) and the listings
-- payload its Nuxt page server-renders (highest bid in pence, bid count, end time in UTC, reserve status; the page's
-- own API route answers 403, so it is not called). It upserts the lots open for bids through
-- upsert_live_auction_vehicles (platform_source 'the-market', the lot page's canonical www.themarket.co.uk/listings
-- link, currency GBP as the house records it) and hands the complete list to live_auction_board_sync. This migration
--   * adds The Market to live_board_houses (enabled), so market_pulse_live_houses reads its lots;
--   * adds 'the-market' to the platforms the sync-live-auctions-houses job (every five minutes) posts, appended to
--     whatever list the job carries now, so another house's migration is never undone.
-- Contract: supabase/sql/test_the_market_live_board.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note)
VALUES ('the-market', 'The Market', '^https?://([a-z0-9-]+\.)*themarket\.co\.uk/', true,
        'sync-live-auctions-houses, every five minutes: the live auctions page (lots open for bids)')
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
  IF NOT (v_body -> 'platforms') ? 'the-market' THEN
    v_body := jsonb_set(v_body, '{platforms}', (v_body -> 'platforms') || '["the-market"]'::jsonb);
    PERFORM cron.alter_job(job_id := v_job, command := replace(v_cmd, v_old, v_body::text));
  END IF;
END
$job$;

COMMIT;
