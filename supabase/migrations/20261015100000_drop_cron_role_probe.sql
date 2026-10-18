-- Removes the cron-role-probe left by 20261015093000_cron_role_probe.sql, whose last statement failed on deploy.
-- Result of the probe (cron.job_run_details, 2026-10-15 04:51 to 04:53Z): a lone CALL of a procedure that COMMITs runs under
-- pg_cron 1.6 (the procedure's COMMIT passed; its RAISE came after it). Setting a job's username needs a superuser
-- ("must be superuser to alter username"), so a dedicated role with its own statement_timeout cannot run job 500.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cron-role-probe';
DROP PROCEDURE IF EXISTS public.cron_role_probe();
DROP PROCEDURE IF EXISTS public.cron_commit_probe();
DROP OWNED BY drain_worker;
DROP ROLE IF EXISTS drain_worker;
