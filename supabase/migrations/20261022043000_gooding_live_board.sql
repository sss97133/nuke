-- Gooding's live-bid reader on the live board: its source row, its board row and its place in the five-minute houses job.
--
-- sync-live-auctions now reads Gooding's open timed lots from the house's bidding platform, bid.goodingco.com (Auction
-- Mobility): the /ajax/lots JSON of every lot of a timed sale that has not ended, with the standing bid, the lot's own
-- close (extensions included), estimate and currency; identity comes from the house catalog (cdn.goodingco.com/graphql).
-- It hands that complete list to live_auction_board_sync('gooding', ...), which refuses a slug live_auction_sources
-- lacks, and live_auction_sources had no 'gooding' row (2026-10-20). In-room sales take bids only in the room and are not
-- on the list.
-- Measured 2026-10-20 19:45Z: no lot of a timed sale is upcoming or open on the platform (the last timed sale was Geared
-- Online | Spring Automobilia, 2025-04-11..18, sale 1-9QGHT2); the catalog's sales still ahead are in-room (Geneva, 8 Nov,
-- CHF, 17 lots; Retromobile New York, 20-21 Nov, USD, 161 lots, registered through christies.com; Retromobile Paris,
-- Feb 2027, 1 lot). The board shows no Gooding lot until a timed sale opens.
--   * live_auction_sources: the 'gooding' row (a five-minute JSON read; a house of live and online sales).
--     organization_id stays empty: four organizations rows name Gooding (98a2e93e, a0edcd0e, bc8ca0f9, 29d2afda).
--   * live_board_houses: Gooding enabled; its lots are recognised by platform_source 'gooding' or a goodingco.com link.
--   * sync-live-auctions-houses: 'gooding' appended to the job's platform list, keeping every house the job posts now.
-- Contract: supabase/sql/test_market_pulse_live_houses.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_auction_sources (slug, display_name, base_url, sync_method, auction_format, default_poll_interval_ms, notes, scraping_config)
VALUES ('gooding', 'Gooding Christie''s', 'https://www.goodingco.com', 'polling_api', 'hybrid', 300000,
  '2026-10-20: live bids from the bidding platform bid.goodingco.com (Auction Mobility) /ajax/lots JSON, timed sales only; '
  'identity from the catalog cdn.goodingco.com/graphql. In-room sales take bids only in the room.',
  jsonb_build_object('live_board', jsonb_build_object(
    'reader', 'sync-live-auctions syncGooding',
    'lots', 'https://bid.goodingco.com/ajax/lots/?lotsRange=upcoming&auction_type=timed+timed_then_live')))
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note) VALUES
  ('gooding', 'Gooding Christie''s', '^https?://([a-z0-9-]+\.)*goodingco\.com/', true,
   'sync-live-auctions-houses, every five minutes: open timed lots; in-room sales are not bid online. '
   'Shows 0 lots on 2026-10-20: no Gooding timed sale is open (the last closed 2025-04-18)')
ON CONFLICT (house) DO NOTHING;

-- Append 'gooding' to the job's body, changing nothing else in its command (other readers append their houses the same way).
DO $do$
DECLARE
  v_job  bigint;
  v_cmd  text;
  v_lit  text;
  v_body jsonb;
BEGIN
  SELECT jobid, command INTO v_job, v_cmd FROM cron.job WHERE jobname = 'sync-live-auctions-houses';
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'sync-live-auctions-houses is not scheduled (20261019021000_live_auction_board_sync_health schedules it)';
  END IF;
  v_lit := substring(v_cmd from $re$body := '(\{[^']*\})'::jsonb$re$);
  v_body := v_lit::jsonb;
  IF v_body IS NULL OR jsonb_typeof(v_body -> 'platforms') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'sync-live-auctions-houses: no platforms list in its command';
  END IF;
  IF NOT (v_body -> 'platforms') ? 'gooding' THEN
    v_body := jsonb_set(v_body, '{platforms}', (v_body -> 'platforms') || '["gooding"]'::jsonb);
    PERFORM cron.alter_job(v_job, command := replace(v_cmd, 'body := ''' || v_lit || '''::jsonb', 'body := ' || quote_literal(v_body::text) || '::jsonb'));
  END IF;
END
$do$;

COMMIT;
