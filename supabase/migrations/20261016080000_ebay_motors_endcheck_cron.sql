-- ebay-motors-endcheck: how the eBay Motors listings we hold ended. Once a day: the live private-seller census for tier 1 and tier 2
-- (the facet search pages, 1 Firecrawl credit each, about 3 + 3), then one item page per held listing missing from the census
-- (at most 24), each confirmed "Ended" on its own page before the episode is closed. At most 30 credits a day, enforced in the
-- function by counting the day's census and endcheck snapshots. eBay's public page does not say sold or unsold, so the end state
-- records what the page shows (ended, auction with or without bids, the price and end time shown), never "sold".
-- Stop rule:  select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ebay-motors-endcheck'), active := false);
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-motors-endcheck') THEN
    PERFORM cron.schedule('ebay-motors-endcheck', '30 13 * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-ebay-motors',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
        body := '{"action": "endcheck", "tiers": [1, 2], "confirm_max": 24, "daily_cap": 30}'::jsonb,
        timeout_milliseconds := 150000
      );
    $c$);
  END IF;
END $job$;
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-motors-endcheck') THEN RAISE EXCEPTION 'ebay-motors-endcheck is not scheduled'; END IF;
END $check$;
COMMIT;
