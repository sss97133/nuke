-- REVERT of 20261126073000_organization_vehicles_readable_backfill_job.sql: unschedules the job and drops both functions
-- and the rule and state rows. Values already written stay (the stamp and relay triggers of 20261126071500 keep them).
-- Apply only through a migration that copies it.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'org-vehicles-readable-backfill';
DROP FUNCTION IF EXISTS public.organization_vehicles_readable_backfill_run();
DROP FUNCTION IF EXISTS public.organization_vehicles_readable_backfill_gauge();
DELETE FROM public.platform_config WHERE config_key IN ('org_vehicles_readable_backfill', 'org_vehicles_readable_backfill_state');
COMMIT;
