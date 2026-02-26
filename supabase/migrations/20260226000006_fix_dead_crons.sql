-- Fix dead and redundant cron jobs
--
-- 1. overnight-discover-classic-sellers: function is archived, cron fires
--    16x/night and 404s every time. Kill it.
--
-- 2. craigslist-squarebodies-5m-hardcoded: fires every 5 min AND
--    daily-craigslist-squarebodies fires at 2am — same function, session-only
--    dedup, inserting duplicates constantly. Kill the 5-min hammer.

SELECT cron.unschedule('overnight-discover-classic-sellers') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'overnight-discover-classic-sellers'
);

SELECT cron.unschedule('craigslist-squarebodies-5m-hardcoded') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'craigslist-squarebodies-5m-hardcoded'
);

-- Verify both are gone
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN ('overnight-discover-classic-sellers', 'craigslist-squarebodies-5m-hardcoded');
