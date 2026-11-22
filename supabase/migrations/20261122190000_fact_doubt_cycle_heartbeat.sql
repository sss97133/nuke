-- The fact-doubt loop's heartbeat, beside the two subscription readers' (20261112120000).
--
-- scripts/doubts/fact-doubt-cycle.mjs now runs on every full fire of com.nuke.subscription-reader
-- (scripts/photo-pipeline/subscription-reader-batch.sh): it raises fact doubts for the owner's vehicles and answers
-- pending ones blind on the subscription, so neither waits for an agent to start a script. The wrapper posts one
-- heartbeat per step through record_reader_heartbeat; this admits the third name, and assay_subscription_readers (the
-- cron job subscription-reader-watch, every 10 minutes) now also raises when the loop has been silent for 40 minutes.
-- Both bodies are the 20261112120000 bodies with the name added; nothing else changes.
-- Contract: supabase/sql/test_fact_doubt_cycle_heartbeat.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.record_reader_heartbeat(p_jobname text, p_reading jsonb, p_elapsed_ms integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'record_reader_heartbeat: service admission required' USING ERRCODE = '42501';
  END IF;
  IF p_jobname IS NULL OR p_jobname NOT IN ('subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle') THEN
    RAISE EXCEPTION 'record_reader_heartbeat: unknown reader %', coalesce(p_jobname, '?');
  END IF;
  IF jsonb_typeof(p_reading) IS DISTINCT FROM 'object' OR octet_length(p_reading::text) > 20000 THEN
    RAISE EXCEPTION 'record_reader_heartbeat: reading must be a json object under 20 kB';
  END IF;
  INSERT INTO job_assay_readings (jobname, reading, assayed_at, elapsed_ms, attempted_at, attempt_error, refresh_every, fresh_for)
  VALUES (p_jobname, p_reading, now(), greatest(0, coalesce(p_elapsed_ms, 0)), now(), NULL, interval '10 minutes', interval '40 minutes')
  ON CONFLICT (jobname) DO UPDATE
    SET reading = EXCLUDED.reading, assayed_at = EXCLUDED.assayed_at, elapsed_ms = EXCLUDED.elapsed_ms,
        attempted_at = EXCLUDED.attempted_at, attempt_error = NULL, refresh_every = EXCLUDED.refresh_every, fresh_for = EXCLUDED.fresh_for;
  RETURN jsonb_build_object('jobname', p_jobname, 'assayed_at', now());
END $fn$;
REVOKE ALL ON FUNCTION public.record_reader_heartbeat(text, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_reader_heartbeat(text, jsonb, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.assay_subscription_readers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_out jsonb := '{}'::jsonb;
  v_stale text[] := '{}';
BEGIN
  FOR r IN SELECT n AS jobname, a.assayed_at, a.reading
           FROM unnest(ARRAY['subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle']) AS n
           LEFT JOIN job_assay_readings a ON a.jobname = n LOOP
    v_out := v_out || jsonb_build_object(r.jobname, jsonb_build_object('assayed_at', r.assayed_at, 'reading', r.reading));
    IF r.assayed_at IS NULL OR r.assayed_at < now() - interval '40 minutes' THEN
      v_stale := v_stale || r.jobname;
    END IF;
  END LOOP;
  IF cardinality(v_stale) > 0 THEN
    RAISE EXCEPTION 'subscription reader silent: % (no heartbeat within 40 minutes; is com.nuke.subscription-reader loaded and the Mac awake?)', array_to_string(v_stale, ', ');
  END IF;
  RETURN v_out || jsonb_build_object('status', 'passed', 'checked_at', now());
END $fn$;
REVOKE ALL ON FUNCTION public.assay_subscription_readers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assay_subscription_readers() TO service_role;
