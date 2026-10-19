-- Live market intake: poll-listing-feeds every 5 minutes, up to 100 feeds an invocation.
--
-- Measured 2026-10-15 01:00-01:30Z: an invocation is bound by its own 110 s worker budget, not by the ingest cap
-- (runs of 70-101 s with 15-38 ingests), and pg_cron started one every 15 minutes, so the worker ran about 12% of the
-- time. Every run is paced by the function (Craigslist: one request per 2 s, search pages and posts alike) and a run
-- stops itself at 110 s, so five-minute starts cannot overlap and the per-site rate does not change; only the idle time
-- between runs goes. Feeds keep their own poll_interval_minutes, so nothing is polled more often than it was declared.
-- max_feeds goes from 40 to 100 (the code's cap): with 2 s pacing a run reaches about 40 feeds anyway, and the
-- budget guard defers the rest, so the larger number only matters when most feeds are quick.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '8s';

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'poll-listing-feeds'),
  schedule := '*/5 * * * *'
);

UPDATE platform_config
SET config_value = jsonb_set(config_value, '{max_feeds}', '100'::jsonb), updated_at = now()
WHERE config_key = 'source_intake';
