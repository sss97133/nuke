-- Fact-doubt loop heartbeat (20261122190000) on top of the readers' heartbeat (20261112120000): the third name is admitted,
-- the assay names it when silent, passes with all three fresh, and still refuses an unknown name.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_fact_doubt_heartbeat%' OR to_regclass('public.job_assay_readings') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_fact_doubt_heartbeat* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

-- Stand-ins: the readings table as live (2026-11-08) and a pg_cron stand-in.
CREATE TABLE public.job_assay_readings(jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms integer,
  attempted_at timestamptz, attempt_error text, refresh_every interval, fresh_for interval,
  CONSTRAINT job_assay_readings_cadence_check CHECK (refresh_every > interval '0' AND fresh_for > refresh_every),
  CONSTRAINT job_assay_readings_clock_check CHECK ((assayed_at IS NULL) = (elapsed_ms IS NULL) AND elapsed_ms >= 0));
GRANT SELECT ON public.job_assay_readings TO service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobid = p_jobid RETURNING true $$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
CREATE FUNCTION pg_temp.raises(sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

\i supabase/migrations/20261122190000_fact_doubt_cycle_heartbeat.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.record_reader_heartbeat(text, jsonb, integer)', 'EXECUTE'), 'anon cannot record');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.record_reader_heartbeat('subscription-document-reader', '{"frames": 0, "errors": 0}'::jsonb, 1000);
SELECT public.record_reader_heartbeat('subscription-frame-classifier', '{"frames": 0, "errors": 0}'::jsonb, 1000);
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.assay_subscription_readers()$$) LIKE '%fact-doubt-cycle%', 'the loop silent: the assay names it');
SELECT public.record_reader_heartbeat('fact-doubt-cycle', '{"cli": "fact-doubt-cycle", "raised": 2, "answered": 1, "errors": 0}'::jsonb, 90000);
SELECT public.assay_subscription_readers() AS a \gset
SELECT pg_temp.assert_true((:'a')::jsonb->>'status' = 'passed' AND (:'a')::jsonb->'fact-doubt-cycle'->'reading'->>'raised' = '2', 'all three fresh: passes and carries the loop reading');
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.record_reader_heartbeat('some-other-job', '{}'::jsonb, 0)$$) LIKE '%unknown reader%', 'unknown names still refused');
UPDATE public.job_assay_readings SET assayed_at = now() - interval '2 hours', elapsed_ms = 0 WHERE jobname = 'fact-doubt-cycle';
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.assay_subscription_readers()$$) LIKE '%fact-doubt-cycle%', 'a stale loop reading fails the watch');
SELECT 'fact doubt cycle heartbeat contract: ok' AS result;
