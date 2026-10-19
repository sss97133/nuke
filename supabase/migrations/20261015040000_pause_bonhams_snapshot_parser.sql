-- Pause job 376 (bonhams-snapshot-parser): its queue is empty (127 rows ended no_vehicle on 2026-10-14/15) and
-- bonhams-typesense-land (job 527) is the single Bonhams runner. Jobs 397, 444 and 449 were already paused.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT cron.alter_job(job_id := 376, active := false);
COMMIT;
