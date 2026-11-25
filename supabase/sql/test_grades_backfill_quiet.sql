-- Contract for 20261124195600_grades_backfill_quiet (empty disposable PG17, cron.schedule stubbed). Asserts the job keeps
-- its schedule and call behind the client_min_messages prefix, a re-apply leaves one job, and an absent job is not created.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $f$;

\ir ../migrations/20261124195600_grades_backfill_quiet.sql
DO $$ BEGIN ASSERT (SELECT count(*) FROM cron.job) = 0, 'an absent job is not created'; END $$;

SELECT cron.schedule('data-set-grades-backfill', '* * * * *',
  $cmd$SET statement_timeout = '55s'; SET lock_timeout = '5s'; SELECT public.data_set_grades_backfill_v1(600);$cmd$);
CREATE TEMP TABLE c0 AS SELECT command FROM cron.job;
\ir ../migrations/20261124195600_grades_backfill_quiet.sql
\ir ../migrations/20261124195600_grades_backfill_quiet.sql
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cron.job) = 1, 'one job';
  ASSERT (SELECT schedule FROM cron.job) = '* * * * *', 'schedule unchanged';
  ASSERT (SELECT command FROM cron.job) = 'SET client_min_messages = error; ' || (SELECT command FROM c0), 'same call, notices quiet';
END $$;
\echo grades_backfill_quiet: ok
