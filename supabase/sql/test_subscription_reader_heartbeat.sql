-- Subscription reader heartbeat (20261112120000): the service role records one reading per reader; anon and signed-in users
-- cannot; the assay passes with two fresh readings, raises when one is missing or stale; the watch is scheduled; the revert
-- removes it all.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_subscription_reader_heartbeat%' OR to_regclass('public.job_assay_readings') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_subscription_reader_heartbeat* database';
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

\i supabase/migrations/20261112120000_subscription_reader_heartbeat.sql

-- grants
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.record_reader_heartbeat(text, jsonb, integer)', 'EXECUTE'), 'anon cannot record');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.record_reader_heartbeat(text, jsonb, integer)', 'EXECUTE'), 'signed-in users cannot record');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.record_reader_heartbeat(text, jsonb, integer)', 'EXECUTE'), 'the service role records');
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job WHERE jobname = 'subscription-reader-watch' AND schedule = '6-59/10 * * * *') = 1, 'the watch is scheduled every 10 minutes');

-- a signed-in caller is refused even if granted by mistake
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000aa"}', false);
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.record_reader_heartbeat('subscription-document-reader', '{}'::jsonb, 0)$$) LIKE '%service admission required%', 'body refuses a non-service caller');

-- the service role records both readers; the assay passes
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.record_reader_heartbeat('subscription-document-reader', '{"frames": 20, "read": 20, "page": 20, "landed": 2, "errors": 0}'::jsonb, 410000);
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.assay_subscription_readers()$$) LIKE '%subscription-frame-classifier%', 'one reader silent: the assay raises and names it');
SELECT public.record_reader_heartbeat('subscription-frame-classifier', '{"frames": 20, "read": 20, "accepted": 19, "classifier_rejected": 1, "errors": 0}'::jsonb, 380000);
SELECT public.assay_subscription_readers() AS a \gset
SELECT pg_temp.assert_true((:'a')::jsonb->>'status' = 'passed' AND (:'a')::jsonb->'subscription-document-reader'->'reading'->>'landed' = '2', 'both fresh: the assay passes and carries the readings');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.job_assay_readings) = 2 AND (SELECT fresh_for FROM public.job_assay_readings WHERE jobname='subscription-document-reader') = interval '40 minutes', 'one row per reader, 40 minute freshness');

-- a second fire upserts the same row
SELECT public.record_reader_heartbeat('subscription-document-reader', '{"frames": 20, "read": 18, "errors": 2}'::jsonb, 300000);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.job_assay_readings WHERE jobname='subscription-document-reader') = 1
  AND (SELECT reading->>'errors' FROM public.job_assay_readings WHERE jobname='subscription-document-reader') = '2', 'a later fire replaces the reading');

-- bad input
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.record_reader_heartbeat('some-other-job', '{}'::jsonb, 0)$$) LIKE '%unknown reader%', 'only the two readers');
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.record_reader_heartbeat('subscription-document-reader', '[1,2]'::jsonb, 0)$$) LIKE '%json object%', 'the reading is an object');

-- a stale reading fails the assay
UPDATE public.job_assay_readings SET assayed_at = now() - interval '2 hours' WHERE jobname = 'subscription-frame-classifier';
SELECT pg_temp.assert_true(pg_temp.raises($$SELECT public.assay_subscription_readers()$$) LIKE '%subscription-frame-classifier%', 'a reading older than 40 minutes is silent');

-- revert
\i supabase/sql/revert_20261112120000_subscription_reader_heartbeat.sql
SELECT pg_temp.assert_true(to_regprocedure('public.record_reader_heartbeat(text, jsonb, integer)') IS NULL AND to_regprocedure('public.assay_subscription_readers()') IS NULL
  AND (SELECT count(*) FROM cron.job WHERE jobname = 'subscription-reader-watch') = 0 AND (SELECT count(*) FROM public.job_assay_readings) = 2, 'revert removes the functions and the watch, keeps the readings');
SELECT 'subscription reader heartbeat contract: ok' AS result;
