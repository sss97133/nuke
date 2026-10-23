-- eBay Motors bulk landing from search pages: its schedule, and the sweep resized so the app's 5,000 Browse calls a day hold both.
--
-- extract-ebay-motors action `bulk` (browseBulk.ts; PRs #2437, #2439, #2442, #2444, #2445) walks every open Cars & Trucks listing
-- (category 6001) by Model Year, vintage first, 200 listings a Browse call, and lands the ones we do not hold from the search
-- summary (a blip when year, make or model is unresolved); held listings whose seller's price or bid count moved are updated.
-- Measured live, called by hand with the bodies below:
--   2026-10-20 23:55Z  4 calls (2 plan + 2 pages)  30 landed, 3 updated   15 s
--   2026-10-21 00:42Z  2 calls                     60 landed, 5 updated   77 s, one wait on the per-trace function-call budget
--                                                  (32 ingest calls a minute; each landing calls ingest once)
--   120 landings on 120 listings, 120 vehicles, 0 duplicate episodes; 4 pages stored, none naming a member handle.
--   Database during the 00:42Z run: active backends median 1 (max 9), lock waits max 2, firecrawl_io_gate closed in 1 of 26
--   samples (baseline with no bulk traffic, 23:34Z: 1 of 28).
--   ebay-motors-bulk   every 10 minutes: at most 8 Browse calls and 60 landings a run, 100 s; at most 1,200 calls a Pacific day
--                      (rate_limits ebay-bulk:browse:<date>), never under 450 left by eBay's count, nothing while the IO gate
--                      is closed. 60 a run is about 8,600 a day: the 35,430 listings the plan reaches in about 4 days.
-- The sweep spent 36 calls every 15 minutes (3,456 a day: 25 getItem + 11 search pages). Bulk now finds every listing, so the sweep
-- searches one page a tier and reads 20 listings in full a run, ranked across its own finds and bulk's summary-only landings
-- (from_held): about 25 calls a run, 2,400 a day.
-- A day: auctions about 370 + sweep about 2,400 + revisit, census and parts about 520 (2026-10-20) + bulk at most 1,200 = about 4,490.
-- Off with: select cron.alter_job(job_id := jobid, active := false) from cron.job where jobname = 'ebay-motors-bulk';
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ebay-motors-bulk';
SELECT cron.schedule('ebay-motors-bulk', '4-59/10 * * * *', $c$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/extract-ebay-motors',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
    body := '{"action": "bulk", "max_calls": 8, "daily_cap": 1200, "floor": 450, "max_land": 60, "budget_ms": 100000}'::jsonb,
    timeout_milliseconds := 150000
  );
$c$);

SELECT cron.alter_job(job_id := jobid, command := $c$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/extract-ebay-motors',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
    body := '{"action": "sweep", "max_items": 20, "max_search_pages": 1, "from_held": 200}'::jsonb,
    timeout_milliseconds := 150000
  );
$c$) FROM cron.job WHERE jobname = 'ebay-motors-sweep';

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-motors-bulk' AND active AND schedule = '4-59/10 * * * *'
                 AND command LIKE '%"action": "bulk"%' AND command LIKE '%"daily_cap": 1200%') THEN
    RAISE EXCEPTION 'ebay-motors-bulk must be scheduled and active every 10 minutes with its daily cap';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-motors-sweep' AND active AND command LIKE '%"from_held": 200%'
                 AND command LIKE '%"max_items": 20%' AND command LIKE '%"max_search_pages": 1%') THEN
    RAISE EXCEPTION 'ebay-motors-sweep must read 20 a run, one search page a tier, and rank bulk landings (from_held)';
  END IF;
END $check$;
COMMIT;
