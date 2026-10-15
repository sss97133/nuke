-- Craigslist job: every 5 minutes, and clear the first-reading rates.
--
-- 1. poll-craigslist started 2026-10-15 08:23Z at */10. Over the first two hours (08:25-10:30Z, 21 runs): 0 blocked feed
--    polls, 0 single-post 403s in 156 sweep checks (16 listings ended). Per the owner's rule that goes to */5. A run
--    still stops itself at 110 s, so runs cannot overlap.
-- 2. The first poll of a feed that had never been polled was read as a 10-minute gap, so its whole backlog became a rate:
--    16 tier-1 feeds carried rates summing to 468 posts an hour (poll-listing-feeds/schedule.ts now reads a first poll
--    as a day of posts). Those rates are cleared so the next poll sets them properly; a cleared feed is polled at the
--    10-minute floor until it has a reading.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'poll-craigslist'), schedule := '*/5 * * * *');

UPDATE listing_feeds
SET new_rate_per_hour = NULL, last_new_count = NULL, poll_interval_minutes = 10
WHERE source_slug = 'craigslist' AND new_rate_per_hour > 20;
