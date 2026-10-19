-- bonhams-typesense-land (job 527): one call of 50 lots per run (was 100, landed as 2 x 50), after the 2026-10-15
-- database overload. The job STAYS INACTIVE here; the lead re-enables it. Typesense pages become 50 lots, so the
-- cursor (metadata.ts_page of the latest landed event) counts 50-lot pages from the next run on.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $mig$
DECLARE
  cur text;
  old_body constant text := $b$'{"mode": "land", "batch_size": 100}'$b$;
  new_body constant text := $b$'{"mode": "land", "batch_size": 50}'$b$;
BEGIN
  SELECT command INTO cur FROM cron.job WHERE jobname = 'bonhams-typesense-land';
  IF cur IS NULL THEN RAISE EXCEPTION 'job bonhams-typesense-land not found'; END IF;
  IF position(old_body in cur) = 0 THEN RAISE EXCEPTION 'job body does not hold batch_size 100'; END IF;
  PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'bonhams-typesense-land'),
                         command := replace(cur, old_body, new_body), active := false);
END $mig$;

DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bonhams-typesense-land' AND NOT active AND command LIKE '%"batch_size": 50%') THEN
    RAISE EXCEPTION 'job 527 not set to 50 and inactive';
  END IF;
END $check$;
COMMIT;
