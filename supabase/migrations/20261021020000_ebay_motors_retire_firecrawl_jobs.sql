-- ebay-motors-discover-t1, ebay-motors-discover-t2 and ebay-motors-endcheck: unschedule.
-- Owner, 2026-10-20: remove Firecrawl for eBay. They were paused on 2026-10-15 (20261017003000). The Browse API path (free, official)
-- covers live listings; archived pages land through the Wayback path. The function's discover, endcheck, reland and deep actions
-- and their files are deleted in the same change. The 1,121 listings already landed stay; this deletes no data.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('ebay-motors-discover-t1', 'ebay-motors-discover-t2', 'ebay-motors-endcheck');

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('ebay-motors-discover-t1', 'ebay-motors-discover-t2', 'ebay-motors-endcheck')) THEN
    RAISE EXCEPTION 'a Firecrawl ebay-motors job is still scheduled';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('ebay-motors-sweep', 'ebay-motors-revisit') AND active) <> 2 THEN
    RAISE EXCEPTION 'the Browse sweep and revisit must stay active';
  END IF;
END $check$;
COMMIT;
