-- Barrett-Jackson on the live board, inside its events' bidding windows only.
--
-- WHY (measured 2026-10-20 19:50Z): live_auction_sources 'barrett-jackson' held no open monitored lot and last synced
-- 2026-02-18; sync-live-auctions' Barrett-Jackson reader was a Firecrawl page scrape no job called. Online bidding for
-- Barrett-Jackson's sales runs on its own platform, Barrett-Jackson Digital (bid.barrett-jackson.com, an Auctic site): it
-- holds Las Vegas 2026 (599 collector-car lots, live auction with online bidding, 10-12 Sep) and Columbus 2026, each lot
-- with its status, open and close times, highest bid, bid count and sold price. Nothing is bid-open today: the calendar's
-- next event is the 2026 Nov. Digital Select (online, 5-12 Nov, bidding from 5 Nov 10:00 America/Phoenix; now in
-- preview, docket not yet published), then 2027 Scottsdale (live, 23-31 Jan).
--
-- WHAT: sync-live-auctions reads Barrett-Jackson's calendar every five minutes (one small JSON request). Within a day of
-- an event's dates it reads Barrett-Jackson Digital's events and each collector-car event's lots: a lot is live while the
-- platform has it active and its own bidding has opened; sold, passed and withdrawn lots are ended through
-- end_live_auction_lots with their closing bid and close time. Each lot is written under its docket page
-- (barrett-jackson.com/<event>/docket/vehicle/<slug>), matched by lot number and title. Every request carries our own
-- agent, one every 3 s at most; a refusal stops the reader for an hour and is recorded on live_auction_sources (the
-- owner's 2026-10-16 authorization to read Barrett-Jackson despite its robots.txt).
-- This migration
--   * adds Barrett-Jackson to live_board_houses (enabled), so market_pulse_live_houses reads its live lots;
--   * adds 'barrett-jackson' to the platforms the sync-live-auctions-houses job posts, appended to whatever list the job
--     carries now.
-- end_live_auction_lots comes from 20261022050000_mecum_live_board.sql.
-- Contract: supabase/sql/test_barrett_jackson_live_board.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note)
VALUES ('barrett-jackson', 'Barrett-Jackson', '^https?://([a-z0-9-]+\.)*barrett-jackson\.com/', true,
        'sync-live-auctions-houses, every five minutes: its calendar; inside an event, lots and bids from Barrett-Jackson Digital')
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
  IF NOT (v_body -> 'platforms') ? 'barrett-jackson' THEN
    v_body := jsonb_set(v_body, '{platforms}', (v_body -> 'platforms') || '["barrett-jackson"]'::jsonb);
    PERFORM cron.alter_job(job_id := v_job, command := replace(v_cmd, v_old, v_body::text));
  END IF;
END
$job$;

COMMIT;
