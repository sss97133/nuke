-- Job 526 (snapshot-stack-dominoes, '25 4 * * *') stops stalling the pg_cron launcher every night.
--
-- MEASURED 2026-11-18..25 (cron.job_run_details, postgres_logs). Every night pg_cron started no job from about
-- 04:25:11Z until 526 ended, between 04:28:14Z and 04:30:28Z: a gap of 194-328 s with zero starts, then a burst
-- of 40-93 back-to-back starts. Tonight's gap was 04:25:11 -> 04:29:18Z. bat-live-pull's minute-26..29 runs started
-- 3m18s-3m42s late, at 04:29:18, :31, :37 and :42.
--
-- CAUSE. pg_cron runs without background workers (cron.use_background_workers = off), so the launcher sends each
-- command over libpq and reads its results. A multi-statement command sends nothing back until it ends, unless a
-- NOTICE flushes the output early. snapshot_stack_dominoes_begin runs DROP TABLE IF EXISTS pg_temp... in a fresh
-- session, and that raises the NOTICE "table does not exist, skipping". The launcher logged "cron job 526 COMMAND
-- completed: SET" at 04:25:24.5Z, while it was mid-run. From that point it waited on 526's later results and served
-- no other job until 04:29:18Z. Control: job 175 (treemap-refresh, two statements, 714 s on 11-24) raises no
-- notice and caused no gap, with 19-23 starts in every minute it ran.
--
-- CHANGE (one cron.job row; no function changes). The command now begins with SET client_min_messages = error, so
-- nothing reaches the launcher before the last statement. The server log still records notices and warnings
-- (log_min_messages is unchanged). Idempotent: a command that already begins with it is left as it is.
--
-- PROOF after deploy: zero-start minutes at 04:26-04:29Z go to 0, and the gap between consecutive starts in
-- cron.job_run_details around 04:25Z is at most 35 s.
-- REVERT: cron.alter_job(526, command := <command without the leading SET client_min_messages = error; >).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE c text;
BEGIN
  SELECT command INTO c FROM cron.job WHERE jobid = 526 AND jobname = 'snapshot-stack-dominoes';
  IF c IS NULL THEN RAISE EXCEPTION 'job 526 snapshot-stack-dominoes not found'; END IF;
  IF c NOT LIKE 'SET client_min_messages = error;%' THEN
    PERFORM cron.alter_job(job_id := 526, command := 'SET client_min_messages = error; ' || c);
  END IF;
END $$;
COMMIT;
