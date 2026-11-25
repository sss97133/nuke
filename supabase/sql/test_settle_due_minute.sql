-- Contract for 20261124195400_settle_due_minute (empty disposable PG17, cron.schedule stubbed). Asserts the job keeps its
-- command, gets minute 6, and a re-apply leaves one job.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $f$;
SELECT cron.schedule('field-evidence-settle-due', '7-59/10 * * * *',
  $cmd$SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.field_evidence_rank_settle_due_v1(40);$cmd$);
CREATE TEMP TABLE c0 AS SELECT command FROM cron.job;

\ir ../migrations/20261124195400_settle_due_minute.sql
\ir ../migrations/20261124195400_settle_due_minute.sql

DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cron.job) = 1, 'one job';
  ASSERT (SELECT schedule FROM cron.job) = '6-59/10 * * * *', 'minute 6';
  ASSERT (SELECT command FROM cron.job) = (SELECT command FROM c0), 'command unchanged';
END $$;
\echo settle_due_minute: ok
