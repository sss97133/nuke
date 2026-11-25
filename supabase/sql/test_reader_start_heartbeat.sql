-- Contract for 20261125003000_reader_start_heartbeat (empty disposable PG17; auth.role and the table stubbed; the watch is
-- the production body from the revert file). Asserts: a reader started 31 minutes ago with no report since is named
-- stuck; one that reported after its start is not; the silent check still runs; only the service role may record a
-- start; applied twice (patched once); the revert restores the old body byte for byte.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.job_assay_readings') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE TABLE public.job_assay_readings (jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms int,
  attempted_at timestamptz, attempt_error text, refresh_every interval NOT NULL, fresh_for interval NOT NULL);
\ir revert_20261125003000_reader_start_heartbeat.sql
CREATE TABLE public.before_def AS SELECT md5(pg_get_functiondef('public.assay_subscription_readers()'::regprocedure)) AS h;
INSERT INTO public.job_assay_readings (jobname, reading, assayed_at, refresh_every, fresh_for)
SELECT n, '{}', now() - interval '35 minutes', '10 minutes', '40 minutes'
  FROM unnest(ARRAY['subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work']) n;

\ir ../migrations/20261125003000_reader_start_heartbeat.sql
\ir ../migrations/20261125003000_reader_start_heartbeat.sql

DO $$
DECLARE msg text; ok boolean := false;
BEGIN
  ASSERT (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.assay_subscription_readers()'::regprocedure), 'reader_stuck_v1', 'g')) = 1, 'patched once';
  ASSERT public.assay_subscription_readers() ->> 'status' = 'passed', 'all reported 35 minutes ago, nothing started: passes';
  PERFORM set_config('test.role', 'service_role', false);
  PERFORM public.record_reader_start('subscription-frame-classifier');
  UPDATE public.job_assay_readings SET run_started_at = now() - interval '31 minutes' WHERE jobname = 'subscription-document-reader';
  UPDATE public.job_assay_readings SET run_started_at = now() - interval '36 minutes' WHERE jobname = 'fact-doubt-cycle';  -- reported after it started
  BEGIN PERFORM public.assay_subscription_readers(); EXCEPTION WHEN others THEN msg := SQLERRM; END;
  ASSERT msg LIKE 'subscription reader stuck: subscription-document-reader started %', 'stuck reader named; got ' || coalesce(msg, 'passed');
  ASSERT msg NOT LIKE '%fact-doubt-cycle%' AND msg NOT LIKE '%frame-classifier%', 'a reader that reported, or started a moment ago, is not stuck: ' || msg;
  UPDATE public.job_assay_readings SET assayed_at = now() WHERE jobname = 'subscription-document-reader';
  ASSERT public.assay_subscription_readers() ->> 'status' = 'passed', 'a report after the start clears it';
  UPDATE public.job_assay_readings SET assayed_at = now() - interval '41 minutes', run_started_at = NULL WHERE jobname = 'reconcile-receipt-work';
  msg := NULL; BEGIN PERFORM public.assay_subscription_readers(); EXCEPTION WHEN others THEN msg := SQLERRM; END;
  ASSERT msg LIKE 'subscription reader silent: reconcile-receipt-work%', 'the silent check still runs; got ' || coalesce(msg, 'passed');
  PERFORM set_config('test.role', 'anon', false);
  BEGIN PERFORM public.record_reader_start('fact-doubt-cycle'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'only the service role records a start';
END $$;
\ir revert_20261125003000_reader_start_heartbeat.sql
DO $$ BEGIN
  ASSERT md5(pg_get_functiondef('public.assay_subscription_readers()'::regprocedure)) = (SELECT h FROM public.before_def), 'revert restores the old body';
  ASSERT to_regprocedure('public.record_reader_start(text)') IS NULL, 'revert drops the writer';
END $$;
\echo reader_start_heartbeat: ok
