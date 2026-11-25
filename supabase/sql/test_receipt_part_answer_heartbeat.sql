-- Contract for 20261124195000_receipt_part_answer_heartbeat (empty disposable PG17; auth.role and the table stubbed; the two
-- function bodies are the live ones' reader-name lists). Asserts: the fifth name is admitted, an unknown name still
-- refuses, the watch lists the new reader and raises while it has no heartbeat, passes once all five report; idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.job_assay_readings') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE TABLE public.job_assay_readings (jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms int,
  attempted_at timestamptz, attempt_error text, refresh_every interval, fresh_for interval);

CREATE FUNCTION public.record_reader_heartbeat(p_jobname text, p_reading jsonb, p_elapsed_ms integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service admission required'; END IF;
  IF p_jobname IS NULL OR p_jobname NOT IN ('subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work') THEN
    RAISE EXCEPTION 'record_reader_heartbeat: unknown reader %', coalesce(p_jobname, '?');
  END IF;
  INSERT INTO job_assay_readings (jobname, reading, assayed_at) VALUES (p_jobname, p_reading, now())
  ON CONFLICT (jobname) DO UPDATE SET reading = EXCLUDED.reading, assayed_at = EXCLUDED.assayed_at;
  RETURN jsonb_build_object('jobname', p_jobname);
END $fn$;
CREATE FUNCTION public.assay_subscription_readers()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE r record; v_out jsonb := '{}'::jsonb; v_stale text[] := '{}';
BEGIN
  FOR r IN SELECT n AS jobname, a.assayed_at, a.reading
           FROM unnest(ARRAY['subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work']) AS n
           LEFT JOIN job_assay_readings a ON a.jobname = n LOOP
    v_out := v_out || jsonb_build_object(r.jobname, jsonb_build_object('assayed_at', r.assayed_at));
    IF r.assayed_at IS NULL OR r.assayed_at < now() - interval '40 minutes' THEN v_stale := v_stale || r.jobname; END IF;
  END LOOP;
  IF cardinality(v_stale) > 0 THEN RAISE EXCEPTION 'subscription reader silent: %', array_to_string(v_stale, ', '); END IF;
  RETURN v_out || jsonb_build_object('status', 'passed');
END $fn$;

SELECT public.record_reader_heartbeat('subscription-document-reader', '{}'), public.record_reader_heartbeat('subscription-frame-classifier', '{}'),
       public.record_reader_heartbeat('fact-doubt-cycle', '{}'), public.record_reader_heartbeat('reconcile-receipt-work', '{}');

\ir ../migrations/20261124195000_receipt_part_answer_heartbeat.sql
\ir ../migrations/20261124195000_receipt_part_answer_heartbeat.sql

DO $$
DECLARE ok boolean := false; msg text;
BEGIN
  BEGIN PERFORM public.assay_subscription_readers(); EXCEPTION WHEN others THEN msg := SQLERRM; END;
  ASSERT msg LIKE '%answer-receipt-parts%', 'the watch raises while the new reader has no heartbeat; got ' || coalesce(msg, 'passed');
  PERFORM public.record_reader_heartbeat('answer-receipt-parts', '{"answered":6}');
  ASSERT public.assay_subscription_readers() ->> 'status' = 'passed', 'all five reported';
  BEGIN PERFORM public.record_reader_heartbeat('some-other-job', '{}'); EXCEPTION WHEN others THEN ok := SQLERRM LIKE '%unknown reader%'; END;
  ASSERT ok, 'an unknown name still refuses';
  ASSERT (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.assay_subscription_readers()'::regprocedure), 'answer-receipt-parts', 'g')) = 1,
    'patched once';
END $$;
\echo receipt_part_answer_heartbeat: ok
