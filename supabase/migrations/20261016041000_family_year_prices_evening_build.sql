-- refresh-family-year-prices moves to 18:40 UTC, after the intake day's heaviest reads.
--
-- 2026-10-15 10:40Z: the first one-pass build (20261016015000) read vehicles at IO/DataFileRead while a PostgREST
-- insert into vehicles waited 30 s on the same disk (pg_stat_activity, 10:41:49Z and 10:42:2xZ). The intake lead
-- (skylar-f7) asked that a build which pushes inserts past 30 s run after 18Z: the Mecum index walk lands about 16k
-- lots an hour until about 17Z. The build was cancelled at 136 s (pg_cancel_backend; the view stays unbuilt and
-- unread). Only the schedule changes: the same function and the same 1,200 s cap.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

SELECT cron.alter_job(job_id := jobid, schedule := '40 18 * * *')
FROM cron.job WHERE jobname = 'refresh-family-year-prices';

COMMENT ON FUNCTION public.refresh_family_year_prices() IS
  'Refreshes mv_family_year_prices (CONCURRENTLY once built) without nested loops, planning for a heap read from disk '
  '(random_page_cost 4; see 20261016015000). Cron job refresh-family-year-prices, daily 18:40 UTC (20261016041000), '
  '1,200 s cap. Not callable by anon or authenticated.';

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-family-year-prices' AND schedule = '40 18 * * *'
                 AND command LIKE '%1200s%refresh_family_year_prices()%') THEN
    RAISE EXCEPTION 'refresh-family-year-prices is not scheduled at 18:40 UTC';
  END IF;
END $check$;

COMMIT;
