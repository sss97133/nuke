-- batch-extract-barrett-jackson (jobid 418): re-enable at every 10 minutes (was every 5, inactive).
--
-- Measured 2026-10-15: the job was inactive and Barrett-Jackson landed 0 lots in the previous 12 h. After the identity
-- fill-only guard (#1438, deployed 07:44Z) a 10-snapshot gate at 07:53Z ran with 0 errors, 2 updated, 4 skipped,
-- 1 vin conflict held, 0 lock waiters. Same body as before: 25 snapshots, sparse, queue, no AI.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.alter_job(jobid, schedule := '2-59/10 * * * *', active := true) FROM cron.job WHERE jobname = 'batch-extract-barrett-jackson';

COMMIT;
