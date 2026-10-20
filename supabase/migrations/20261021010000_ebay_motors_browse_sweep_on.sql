-- ebay-motors-sweep and ebay-motors-revisit: switch on (active := true).
-- Both are the free eBay Browse API path (no Firecrawl). Production keys were granted 2026-10-19 and one bounded sweep
-- (25 items, 3 search pages, 39 of 5,000 daily calls) landed 17 listings with no errors; the identity guard held back the 7
-- listings whose VIN already belongs to a different car (revision queue, raised_by extract-ebay-motors).
-- Load: 25 items per 15 minutes, 150 revisits a day. The Firecrawl discover and endcheck jobs stay paused (20261017003000).
-- Off again with: select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ebay-motors-sweep'), active := false);
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.alter_job(job_id := jobid, active := true) FROM cron.job WHERE jobname IN ('ebay-motors-sweep', 'ebay-motors-revisit');

DO $check$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('ebay-motors-sweep', 'ebay-motors-revisit') AND active) <> 2 THEN
    RAISE EXCEPTION 'ebay-motors-sweep and ebay-motors-revisit must both be active';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('ebay-motors-discover-t1', 'ebay-motors-discover-t2', 'ebay-motors-endcheck') AND active) THEN
    RAISE EXCEPTION 'a Firecrawl ebay-motors job is active';
  END IF;
END $check$;
COMMIT;
