-- Job 646 (map-facts-nightly, '20 9 * * *') stops stalling the pg_cron launcher. Same cause and change as
-- 20261125041500_cron_526_no_client_notices.sql (job 526).
--
-- MEASURED: on 11-24, "cron job 646 COMMAND completed: SET" was logged at 09:23:30.2Z, 210 s into the run. pg_cron
-- then started no job until 646 ended at 09:25:35.5Z, a gap of 149 s. The 11-22 and 11-23 runs left the same
-- zero-start minutes at 09:23-09:24Z. The early result is flushed by a NOTICE: fold_map_facts_listing, _sale,
-- _vehicle, _photo and _organization each run CREATE TEMP TABLE IF NOT EXISTS map_fold_entities, and from the
-- second call in a session on, that raises "relation already exists, skipping".
--
-- CHANGE (one cron.job row; no function changes): the command begins with SET client_min_messages = error. The
-- server log still records notices. Idempotent.
-- PROOF after deploy: 0 zero-start minutes at 09:23-09:26Z the next night.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE c text;
BEGIN
  SELECT command INTO c FROM cron.job WHERE jobid = 646 AND jobname = 'map-facts-nightly';
  IF c IS NULL THEN RAISE EXCEPTION 'job 646 map-facts-nightly not found'; END IF;
  IF c NOT LIKE 'SET client_min_messages = error;%' THEN
    PERFORM cron.alter_job(job_id := 646, command := 'SET client_min_messages = error; ' || c);
  END IF;
END $$;
COMMIT;
