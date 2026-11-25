-- data-set-grades-backfill (cron, 20261124194600) runs with client_min_messages = error.
--
-- WHY. data_set_grades_backfill_v1 calls data_set_grade_vehicle once per vehicle, and that function's
-- CREATE TEMP TABLE IF NOT EXISTS _dsg raises a NOTICE on every call after the first in a session (599 a run). A NOTICE
-- inside a multi-statement cron command makes the libpq-mode launcher (cron.use_background_workers = off) wait on the
-- rest of that command's results; ta-skeptic traced the 04:25-04:29Z stall to the same shape in job 526 (#3840).
-- Measured 2026-11-25: the three launch gaps over 35 s in the last 3 h (03:00, 03:37, 03:45Z, 36-45 s) each began with
-- this job among those starting.
-- WHAT. Same schedule and call, the command first sets client_min_messages = error. Errors are still reported.
-- REVERT: reschedule without the first SET. Contract: supabase/sql/test_grades_backfill_quiet.sql.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-set-grades-backfill') THEN
    PERFORM cron.schedule('data-set-grades-backfill', '* * * * *',
      $cmd$SET client_min_messages = error; SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.data_set_grades_backfill_v1(600);$cmd$);
  END IF;
END $cron$;
