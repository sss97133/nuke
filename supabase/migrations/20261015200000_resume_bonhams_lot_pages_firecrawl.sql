-- bonhams-lot-pages (job 551): resumed, now reading lot pages through Firecrawl (extract-bonhams deep_lots). Bonhams answers
-- 403 to the edge function's address, so the edge fetch landed nothing; the lot page now comes through Firecrawl rawHtml,
-- 1 credit a page, every response retained in the listing-snapshots bucket and listing_page_snapshots first.
-- Credit bound: the function reads /v1/team/credit-usage before each run and stops when remaining credits minus the run's
-- pages would fall below 5,000 (the Cars & Bids reserve). 20 lots every 10 minutes at most (2,880 a day), ended by the floor.
-- Stop rule: select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'bonhams-lot-pages'), active := false)
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'bonhams-lot-pages'), active := true);
COMMIT;
