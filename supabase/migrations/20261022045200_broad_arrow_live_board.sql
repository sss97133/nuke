-- Broad Arrow's timed online sales on the live board.
--
-- WHY (read 2026-10-20 19:36Z): Broad Arrow sells in the room (Las Vegas 31 October, Zurich 7 November, Paris and Amelia
-- 2027: bid only during the sale, so never a live bid here) and in timed online sales on its bidding site,
-- bid.broadarrowauctions.com, where each lot shows its top bid and a close that a late bid pushes back (Global Icons:
-- Zoute Online 2026, 33 cars in EUR, closed 14 October, 19 of the 33 closes moved off their scheduled minute by late
-- bids; The Patina Collective, 40 cars in USD, August; Spring Online, 39 of 41 lots vehicles, May; Europe Online, 72 of
-- 74, January). No reader read them: live_auction_sources 'broad-arrow' last synced 2026-02-18 and held no open lot.
-- No timed car sale is open on 2026-10-20; the next timed sales (from 9 November) are memorabilia and art, which the
-- reader skips, so Broad Arrow reaches the board when its next online car sale opens.
--
-- WHAT: sync-live-auctions reads the bidding site's sale list (an hour-old capture serves) and each open timed sale's
-- lot list every run: vehicle lots that are active, started and not yet closed, with top bid, currency, estimate,
-- soft-close end, image and bidding-page link (platform_source 'broad-arrow'); it hands the complete list to
-- live_auction_board_sync. This migration
--   * adds Broad Arrow to live_board_houses (enabled), so market_pulse_live_houses reads its open lots;
--   * adds 'broad-arrow' to the platforms the sync-live-auctions-houses job (every five minutes) posts, appended to
--     whatever list the job carries now, so another house's migration is never undone.
-- Contract: supabase/sql/test_broad_arrow_live_board.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note)
VALUES ('broad-arrow', 'Broad Arrow', '^https?://([a-z0-9-]+\.)*broadarrowauctions\.com/', true,
        'sync-live-auctions-houses, every five minutes: timed online sales on bid.broadarrowauctions.com (vehicle lots); '
        'in-room sales are bid only in the room and are never live here')
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
  IF NOT (v_body -> 'platforms') ? 'broad-arrow' THEN
    v_body := jsonb_set(v_body, '{platforms}', (v_body -> 'platforms') || '["broad-arrow"]'::jsonb);
    PERFORM cron.alter_job(job_id := v_job, command := replace(v_cmd, v_old, v_body::text));
  END IF;
END
$job$;

COMMIT;
