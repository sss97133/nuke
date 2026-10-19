-- drain_worker: a NOLOGIN role for cron job 500 so its CALL gets its own statement_timeout, plus a probe of whether pg_cron
-- will run a job as it. Measured 2026-10-15 on PostgreSQL 17: statement_timeout covers a whole CALL and neither the
-- procedure's COMMITs nor set_config extend it, and a procedure with a SET clause cannot commit. A role-level setting is
-- the one lever left: ALTER ROLE drain_worker SET statement_timeout. NOLOGIN, no password, no membership: not a credential.
-- This migration only creates the role (timeouts, no table grants) and a temporary probe job that fails on purpose with the
-- session facts in its message; cron.job_run_details shows them. A following migration moves job 500 or removes the role.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drain_worker') THEN
    CREATE ROLE drain_worker NOLOGIN NOINHERIT;
  END IF;
END
$role$;
ALTER ROLE drain_worker SET statement_timeout = '50s';
ALTER ROLE drain_worker SET lock_timeout = '2s';
GRANT USAGE ON SCHEMA public TO drain_worker;

CREATE OR REPLACE PROCEDURE public.cron_role_probe()
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1;
  COMMIT;
  RAISE EXCEPTION 'probe session_user=% current_user=% statement_timeout=% lock_timeout=%',
    session_user, current_user, current_setting('statement_timeout'), current_setting('lock_timeout');
END
$$;
REVOKE ALL ON PROCEDURE public.cron_role_probe() FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE public.cron_role_probe() TO drain_worker;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cron-role-probe';
SELECT cron.schedule('cron-role-probe', '* * * * *', $job$CALL public.cron_role_probe();$job$);
SELECT cron.alter_job(jobid, username := 'drain_worker') FROM cron.job WHERE jobname = 'cron-role-probe';
