-- Hagerty Marketplace's open auctions on the live board.
--
-- WHY (measured 2026-10-20 19:46Z): Hagerty Marketplace had 229 open timed auctions (its search, forSale + type
-- AUCTIONS), 219 with a current bid, all in USD, closing 2026-10-21 to 2026-11-03 with soft-close extensions in the
-- close time. 160 are vehicles; 69 are the parts lots of one collection sale (year "0000"). None was on the board:
-- live_auction_sources 'hagerty-marketplace' last synced 2026-02-18 and no reader wrote its lots.
--
-- WHAT: sync-live-auctions reads the search (page 1 server-rendered, every page from the site's Next.js data route,
-- last page first so a lot closing mid-read is read twice, never missed), upserts the vehicle lots through
-- upsert_live_auction_vehicles (platform_source 'hagerty-marketplace', the lot link on hagerty.com as the 125 vehicles
-- rows already spell it), ends lots that left the list (end_live_auctions_absent) and hands the complete list to
-- live_auction_board_sync. This migration
--   * adds Hagerty Marketplace to live_board_houses (enabled), so market_pulse_live_houses reads its lots;
--   * adds 'hagerty-marketplace' to the platforms the sync-live-auctions-houses job (every five minutes) posts,
--     appended to whatever list the job carries now, so another house's migration is never undone.
-- Contract: supabase/sql/test_hagerty_live_board.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note)
VALUES ('hagerty-marketplace', 'Hagerty Marketplace', '^https?://([a-z0-9-]+\.)*hagerty\.com/marketplace/auction/', true,
        'sync-live-auctions-houses, every five minutes: the open-auction search (vehicles only; parts lots carry no year)')
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
  IF NOT (v_body -> 'platforms') ? 'hagerty-marketplace' THEN
    v_body := jsonb_set(v_body, '{platforms}', (v_body -> 'platforms') || '["hagerty-marketplace"]'::jsonb);
    PERFORM cron.alter_job(job_id := v_job, command := replace(v_cmd, v_old, v_body::text));
  END IF;
END
$job$;

COMMIT;
