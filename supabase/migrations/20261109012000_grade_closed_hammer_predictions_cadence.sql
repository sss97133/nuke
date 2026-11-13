-- grade-closed-hammer-predictions: every 15 minutes with a 20 s budget instead of hourly with 40 s.
--
-- The first run (2026-11-08 18:20Z) wrote 498 rows in 10 grader calls (12 model 32 and 12 model 33 lots closed
-- 18:01-18:19Z, plus model 31 rows) and took 48.4 s against the job's 55 s statement_timeout: the call that started just
-- inside the 40 s budget ran about 8 s (the same ranges' reads take 0.1-0.9 s warm, so the first run read cold). A call
-- that runs past 55 s rolls back the whole run, and the next run would meet the same rows. A shorter budget leaves 35 s
-- for the last call; four runs an hour keep the throughput (80 s an hour) and hand each run a quarter of the closes.
-- No change to grade_closed_hammer_predictions() (20261109010000) or the grader.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE j bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'grade-closed-hammer-predictions' LOOP PERFORM cron.unschedule(j); END LOOP;
  PERFORM cron.schedule('grade-closed-hammer-predictions', '5,20,35,50 * * * *',
    $cmd$SET statement_timeout = '55s'; SELECT public.grade_closed_hammer_predictions(20000);$cmd$);
END $$;

COMMIT;
