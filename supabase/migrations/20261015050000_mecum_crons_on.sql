-- Turn the Mecum jobs back on: mecum-targets-landing (*/5, 25 lots, 2 s apart) and mecum-upcoming-roster (hourly).
--
-- Both were paused on 2026-10-15 while the database was unreachable (job 500's statement budget). The cadence is the held one
-- (20261015034500_mecum_landing_held_cadence.sql); only active changes here. mecum-reverify-enqueue stays retired.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname IN ('mecum-targets-landing', 'mecum-upcoming-roster');

COMMIT;
