-- Contract for 20261125171000_actions_reader_heartbeat (empty disposable PG17; auth.role and the two tables stubbed; the
-- two bodies are production's, from the revert file, and their md5 is checked against the migration's guard).
-- Asserts: the Actions host posts under its own name and the Mac's row is untouched; an unknown name is still refused;
-- the watch passes while the Actions row is fresh, or stale with no due work for its stages; it fails, naming the host,
-- when the row is over an hour old or missing while classifier, deep_reading or keyed_values work is queued and due;
-- the Mac's 40-minute rule still runs and is not applied to the Actions row; only the service role posts; applied
-- twice (patched once); a body someone changed is refused; the revert restores both bodies byte for byte.
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
  attempted_at timestamptz, attempt_error text, refresh_every interval NOT NULL, fresh_for interval NOT NULL,
  run_started_at timestamptz);
CREATE TABLE public.image_stage_work (id bigserial PRIMARY KEY, stage text NOT NULL, status text NOT NULL,
  not_before timestamptz NOT NULL DEFAULT now());
\ir revert_20261125171000_actions_reader_heartbeat.sql
-- as in production
REVOKE ALL ON FUNCTION public.record_reader_heartbeat(text, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_reader_heartbeat(text, jsonb, integer) TO service_role;
REVOKE ALL ON FUNCTION public.assay_subscription_readers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assay_subscription_readers() TO service_role;
DO $$ BEGIN
  ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.record_reader_heartbeat(text,jsonb,integer)'::regprocedure) = '7e56b94a78a0e24d8a29cf81cc4d9160', 'the fixture is production''s heartbeat body';
  ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.assay_subscription_readers()'::regprocedure) = '762d8679eec150ef52f9c5593add68a4', 'the fixture is production''s watch body';
END $$;
CREATE TABLE public.before_def AS
  SELECT md5(pg_get_functiondef('public.record_reader_heartbeat(text, jsonb, integer)'::regprocedure)) AS hb,
         md5(pg_get_functiondef('public.assay_subscription_readers()'::regprocedure)) AS watch;
-- the five Mac readers reported a minute ago; the Mac's frame-reader row says nothing about a host
INSERT INTO public.job_assay_readings (jobname, reading, assayed_at, refresh_every, fresh_for)
SELECT n, '{"frames": 3}', now() - interval '1 minute', '10 minutes', '40 minutes'
  FROM unnest(ARRAY['subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work',
                    'answer-receipt-parts']) n;

\ir ../migrations/20261125171000_actions_reader_heartbeat.sql
\ir ../migrations/20261125171000_actions_reader_heartbeat.sql

DO $$
DECLARE msg text; ok boolean := false; mac_before record; mac_after record;
BEGIN
  ASSERT (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.assay_subscription_readers()'::regprocedure), 'actions_reader_v1', 'g')) = 1, 'watch patched once';
  ASSERT (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.record_reader_heartbeat(text, jsonb, integer)'::regprocedure), 'subscription-frame-classifier-actions', 'g')) = 1, 'name admitted once';
  ASSERT (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.assay_subscription_readers()'::regprocedure), $r$'answer-receipt-parts'\]$r$, 'g')) = 1,
    'the 40-minute list is unchanged';

  -- no Actions row yet, nothing queued: passes
  ASSERT public.assay_subscription_readers() ->> 'status' = 'passed', 'no Actions row and no work: passes';

  -- the Actions host posts under its own name; the Mac row keeps its reading and clock
  SELECT reading, assayed_at INTO mac_before FROM public.job_assay_readings WHERE jobname = 'subscription-frame-classifier';
  PERFORM set_config('test.role', 'service_role', false);
  PERFORM public.record_reader_heartbeat('subscription-frame-classifier-actions', '{"frames": 0, "host": "github_actions"}', 900);
  SELECT reading, assayed_at INTO mac_after FROM public.job_assay_readings WHERE jobname = 'subscription-frame-classifier';
  ASSERT mac_after.reading = mac_before.reading AND mac_after.assayed_at = mac_before.assayed_at, 'the Mac row is untouched';
  ASSERT (SELECT reading ->> 'host' FROM public.job_assay_readings WHERE jobname = 'subscription-frame-classifier-actions') = 'github_actions', 'Actions row landed';
  BEGIN PERFORM public.record_reader_heartbeat('subscription-frame-classifier-mac2', '{}'); EXCEPTION WHEN others THEN msg := SQLERRM; END;
  ASSERT msg = 'record_reader_heartbeat: unknown reader subscription-frame-classifier-mac2', 'unknown name refused; got ' || coalesce(msg, 'accepted');

  -- fresh Actions row with due work: passes, and the pass reading carries the Actions clock
  INSERT INTO public.image_stage_work (stage, status) VALUES ('deep_reading', 'queued');
  ASSERT public.assay_subscription_readers() -> 'subscription-frame-classifier-actions' ->> 'assayed_at' IS NOT NULL, 'fresh: passes and reports the Actions clock';

  -- 50 minutes old (the Mac rule would raise at 40; this one waits for an hour): passes
  UPDATE public.job_assay_readings SET assayed_at = now() - interval '50 minutes' WHERE jobname = 'subscription-frame-classifier-actions';
  ASSERT public.assay_subscription_readers() ->> 'status' = 'passed', 'the 40-minute rule is not applied to the Actions host';

  -- 61 minutes old with due work: fails, naming the host
  UPDATE public.job_assay_readings SET assayed_at = now() - interval '61 minutes' WHERE jobname = 'subscription-frame-classifier-actions';
  msg := NULL; BEGIN PERFORM public.assay_subscription_readers(); EXCEPTION WHEN others THEN msg := SQLERRM; END;
  ASSERT msg LIKE 'subscription reader silent on GitHub Actions: subscription-frame-classifier-actions last reported 20%Z while image_stage_work holds queued work%',
    'stale Actions host with due work fails; got ' || coalesce(msg, 'passed');

  -- the same stale row, but the only queued work is not due, or belongs to a stage this reader does not claim: passes
  UPDATE public.image_stage_work SET not_before = now() + interval '1 hour';
  INSERT INTO public.image_stage_work (stage, status) VALUES ('exif', 'queued'), ('receipt_ocr', 'queued'), ('classifier', 'done');
  ASSERT public.assay_subscription_readers() ->> 'status' = 'passed', 'no due work for its stages: passes';

  -- due classifier work and no Actions row at all: fails with "never"
  INSERT INTO public.image_stage_work (stage, status) VALUES ('classifier', 'queued');
  DELETE FROM public.job_assay_readings WHERE jobname = 'subscription-frame-classifier-actions';
  msg := NULL; BEGIN PERFORM public.assay_subscription_readers(); EXCEPTION WHEN others THEN msg := SQLERRM; END;
  ASSERT msg LIKE 'subscription reader silent on GitHub Actions: subscription-frame-classifier-actions last reported never %', 'missing row fails; got ' || coalesce(msg, 'passed');

  -- the Mac's own rule still runs first
  UPDATE public.job_assay_readings SET assayed_at = now() - interval '41 minutes' WHERE jobname = 'subscription-frame-classifier';
  msg := NULL; BEGIN PERFORM public.assay_subscription_readers(); EXCEPTION WHEN others THEN msg := SQLERRM; END;
  ASSERT msg LIKE 'subscription reader silent: subscription-frame-classifier (no heartbeat within 40 minutes%', 'the Mac rule still runs; got ' || coalesce(msg, 'passed');

  PERFORM set_config('test.role', 'anon', false);
  BEGIN PERFORM public.record_reader_heartbeat('subscription-frame-classifier-actions', '{}'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'only the service role posts';
  ASSERT NOT has_function_privilege('anon', 'public.record_reader_heartbeat(text, jsonb, integer)', 'EXECUTE'), 'grants kept';
END $$;

-- a body someone changed since 2026-11-25 is refused, not patched over
\ir revert_20261125171000_actions_reader_heartbeat.sql
CREATE OR REPLACE FUNCTION public.assay_subscription_readers() RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN RETURN '{}'; END $f$;
\echo 'Expected next: the guard refuses a changed body (its ERROR).'
\set ON_ERROR_STOP off
\ir ../migrations/20261125171000_actions_reader_heartbeat.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  ASSERT (SELECT prosrc FROM pg_proc WHERE oid = 'public.assay_subscription_readers()'::regprocedure) = ' BEGIN RETURN ''{}''; END ', 'a changed watch body is left alone';
  ASSERT position('subscription-frame-classifier-actions' IN pg_get_functiondef('public.record_reader_heartbeat(text, jsonb, integer)'::regprocedure)) = 0,
    'and nothing else is patched when one body is refused';
END $$;

\ir revert_20261125171000_actions_reader_heartbeat.sql
DO $$ BEGIN
  ASSERT md5(pg_get_functiondef('public.record_reader_heartbeat(text, jsonb, integer)'::regprocedure)) = (SELECT hb FROM public.before_def), 'revert restores the heartbeat body';
  ASSERT md5(pg_get_functiondef('public.assay_subscription_readers()'::regprocedure)) = (SELECT watch FROM public.before_def), 'revert restores the watch body';
END $$;
\echo actions_reader_heartbeat: ok
