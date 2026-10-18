-- bonhams-typesense-land (job 527): 100 lots a run, read as two consecutive search pages of 50 (the function was changed to do that in the same
-- change; a single page of 100 would have doubled the cursor, which counts pages of 50). The Mecum walk ended 2026-10-16 02:57Z. Command only:
-- schedule 4-59/5 and active state are untouched (#1706 moved the start minute off 0).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $mig$
DECLARE
  cur text;
  old_body constant text := $b$'{"mode": "land", "batch_size": 50}'$b$;
  new_body constant text := $b$'{"mode": "land", "batch_size": 100}'$b$;
BEGIN
  SELECT command INTO cur FROM cron.job WHERE jobname = 'bonhams-typesense-land';
  IF cur IS NULL THEN RAISE EXCEPTION 'job bonhams-typesense-land not found'; END IF;
  IF position(old_body in cur) = 0 THEN RAISE EXCEPTION 'job body does not hold batch_size 50'; END IF;
  PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'bonhams-typesense-land'),
                         command := replace(cur, old_body, new_body));
END $mig$;

DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bonhams-typesense-land' AND schedule = '4-59/5 * * * *' AND command LIKE '%"batch_size": 100%') THEN
    RAISE EXCEPTION 'job 527 not set to 100 with schedule 4-59/5';
  END IF;
END $check$;
COMMIT;
