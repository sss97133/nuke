-- eBay Motors on the live auctions board: the auctions reader's schedule and its live_board_houses row.
--
-- extract-ebay-motors action `auctions` (browseAuctions.ts, PR #2423) reads eBay's open auction-format car listings
-- (Browse search, category 6001, buyingOptions:{AUCTION}, ending soonest, 200 a page) and writes held lots' live state
-- through upsert_live_auction_vehicles (sale_status auction_live, high_bid only when a bid exists, auction_end_date,
-- origin_metadata.currency); unheld lots land through landItem, vintage first; after a complete pass, held lots absent
-- and past their end become 'ended' (end_live_auctions_absent), never an outcome.
--   ebay-motors-auctions        every 15 minutes: the 200 lots ending soonest (about the next 5 hours) + 2 landings
--                               = at most 3 Browse calls, 288 a day; keeps vehicles.updated_at inside the board's 6 h gate
--   ebay-motors-auctions-pass   every 6 hours: the whole open list (3,528 lots = 18 pages on 2026-10-20) + 2 landings
--                               = at most 20 calls, 80 a day; the only run that ends lots
-- About 370 Browse calls a day of the app's 5,000 (the sweep, revisit and census used about 4,350 on 2026-10-20); the
-- action also stops at 400 a Pacific day (rate_limits ebay-auctions:browse:<date>) and under 200 left by eBay's count.
-- The house row makes market_pulse_live_houses read vehicles with platform_source 'ebay-motors' (or an ebay.com listing
-- URL). Before the action ran, 0 auction_live rows matched either (2026-10-20); its first full pass (20:41Z, 20 Browse
-- calls) made 198 held eBay rows auction_live (54 with a bid), all platform_source 'ebay-motors', so no other house's
-- row joins the board through the host pattern.
-- Off with: select cron.alter_job(job_id := jobid, active := false) from cron.job where jobname like 'ebay-motors-auctions%';
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note) VALUES
  ('ebay-motors', 'eBay Motors', '^https?://([a-z0-9-]+\.)*ebay\.com/', true,
   'extract-ebay-motors auctions (Browse API): ebay-motors-auctions every 15 minutes, ebay-motors-auctions-pass every 6 hours')
ON CONFLICT (house) DO UPDATE SET enabled = true;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('ebay-motors-auctions', 'ebay-motors-auctions-pass');
SELECT cron.schedule('ebay-motors-auctions', '8-59/15 * * * *', $c$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/extract-ebay-motors',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
    body := '{"action": "auctions", "max_pages": 1, "max_items": 2}'::jsonb,
    timeout_milliseconds := 150000
  );
$c$);
SELECT cron.schedule('ebay-motors-auctions-pass', '3 */6 * * *', $c$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/extract-ebay-motors',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
    body := '{"action": "auctions", "max_pages": 20, "max_items": 2}'::jsonb,
    timeout_milliseconds := 150000
  );
$c$);

DO $check$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('ebay-motors-auctions', 'ebay-motors-auctions-pass') AND active) <> 2 THEN
    RAISE EXCEPTION 'ebay-motors-auctions and ebay-motors-auctions-pass must both be scheduled and active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.live_board_houses WHERE house = 'ebay-motors' AND enabled
                 AND 'https://ebay.com/itm/100000000001' ~* host_pattern AND 'https://www.ebay.com/itm/100000000001' ~* host_pattern) THEN
    RAISE EXCEPTION 'live_board_houses has no enabled ebay-motors row that matches eBay item URLs';
  END IF;
END $check$;
COMMIT;
