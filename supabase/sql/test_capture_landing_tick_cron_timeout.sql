-- Contract: 20261115150000 wraps capture-sets-landing-tick so the SELECT starts at 120s.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_landing_tick_cron_timeout%' THEN
    RAISE EXCEPTION 'refusing: not a disposable contract database';
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY,
  jobname text UNIQUE,
  schedule text,
  command text,
  username name DEFAULT 'postgres',
  active boolean DEFAULT true
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL,
  username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET schedule = coalesce(alter_job.schedule, job.schedule), command = coalesce(alter_job.command, job.command),
         active = coalesce(alter_job.active, job.active) WHERE job.jobid = alter_job.job_id $$;
CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobid = p_id RETURNING true $$;

SELECT cron.schedule('capture-sets-landing-tick', '*/10 * * * *', $c$select public.capture_landing_tick()$c$);

\i supabase/migrations/20261115150000_capture_landing_tick_cron_timeout.sql
SELECT pg_temp.assert_true(
  (SELECT btrim(command) FROM cron.job WHERE jobname = 'capture-sets-landing-tick')
    = 'SET statement_timeout = ''120s''; SELECT public.capture_landing_tick()',
  'cron command starts the tick under a 120s statement_timeout');

\i supabase/sql/revert_20261115150000_capture_landing_tick_cron_timeout.sql
SELECT pg_temp.assert_true(
  (SELECT btrim(command) FROM cron.job WHERE jobname = 'capture-sets-landing-tick')
    = 'select public.capture_landing_tick()',
  'revert restores the unwrapped select');

\i supabase/migrations/20261115150000_capture_landing_tick_cron_timeout.sql
SELECT pg_temp.assert_true(
  (SELECT btrim(command) FROM cron.job WHERE jobname = 'capture-sets-landing-tick')
    = 'SET statement_timeout = ''120s''; SELECT public.capture_landing_tick()',
  're-apply is idempotent');
SELECT 'capture landing tick cron timeout contract: ok' AS result;
