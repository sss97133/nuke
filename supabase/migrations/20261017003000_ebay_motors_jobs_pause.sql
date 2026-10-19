-- ebay-motors-discover-t1, -t2 and ebay-motors-endcheck: pause (active := false).
--
-- Owner, 2026-10-15: "ebay is low quality." All eBay Firecrawl spend stops. The 1,121 landed listings stay; this deletes nothing.
-- eBay hides sold versus unsold, lists dealers as private sellers and carries typed-VIN noise. The jobs come back only when the
-- Firecrawl allowance function ranks eBay among the best targets.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname IN ('ebay-motors-discover-t1', 'ebay-motors-discover-t2', 'ebay-motors-endcheck');

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE 'ebay-motors%' AND active) THEN
    RAISE EXCEPTION 'an ebay-motors job is still active';
  END IF;
END $check$;
COMMIT;
