-- Revert 20261125171000_actions_reader_heartbeat: both bodies as read from production on 2026-11-25, before it. Grants are
-- kept by CREATE OR REPLACE. Run it with the stages job posting as subscription-frame-classifier again, or the job's
-- heartbeat is refused (it does not fail the job).
SET lock_timeout = '5s';
SET statement_timeout = '60s';
CREATE OR REPLACE FUNCTION public.record_reader_heartbeat(p_jobname text, p_reading jsonb, p_elapsed_ms integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'record_reader_heartbeat: service admission required' USING ERRCODE = '42501';
  END IF;
  IF p_jobname IS NULL OR p_jobname NOT IN ('subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work', 'answer-receipt-parts') THEN
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
END $function$

;
CREATE OR REPLACE FUNCTION public.assay_subscription_readers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_out jsonb := '{}'::jsonb;
  v_stale text[] := '{}';
  v_stuck text[] := '{}'; /* reader_stuck_v1 */
  v_dry jsonb;
BEGIN
  FOR r IN SELECT n AS jobname, a.assayed_at, a.reading, a.run_started_at
           FROM unnest(ARRAY['subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work', 'answer-receipt-parts']) AS n
           LEFT JOIN job_assay_readings a ON a.jobname = n LOOP
    v_out := v_out || jsonb_build_object(r.jobname, jsonb_build_object('assayed_at', r.assayed_at, 'reading', r.reading));
    IF r.run_started_at IS NOT NULL AND r.run_started_at > coalesce(r.assayed_at, '-infinity'::timestamptz)
       AND r.run_started_at < now() - interval '30 minutes' THEN
      v_stuck := v_stuck || (r.jobname || ' started ' || to_char(r.run_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI"Z"'));
    END IF;
    IF r.assayed_at IS NULL OR r.assayed_at < now() - interval '40 minutes' THEN
      v_stale := v_stale || r.jobname;
    END IF;
  END LOOP;
  IF cardinality(v_stuck) > 0 THEN
    RAISE EXCEPTION 'subscription reader stuck: % and has not reported (a live process with no result, or it failed; read ~/nuke/logs/subscription-reader.log)', array_to_string(v_stuck, '; ');
  END IF;
  IF cardinality(v_stale) > 0 THEN
    RAISE EXCEPTION 'subscription reader silent: % (no heartbeat within 40 minutes; is com.nuke.subscription-reader loaded and the Mac awake?)', array_to_string(v_stale, ', ');
  END IF;
  -- The loop reports in but answers nothing: reader-heartbeat.mjs carries zero_read_since / zero_read_fires across fires
  -- in which it took up doubts (frames) and answered none (read). Three such fires over two hours fail the watch.
  SELECT a.reading INTO v_dry FROM job_assay_readings a
   WHERE a.jobname = 'fact-doubt-cycle'
     AND jsonb_typeof(a.reading -> 'zero_read_fires') = 'number' AND (a.reading ->> 'zero_read_fires')::numeric >= 3
     AND (a.reading ->> 'zero_read_since') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
     AND (a.reading ->> 'zero_read_since')::timestamptz < now() - interval '2 hours';
  IF v_dry IS NOT NULL THEN
    RAISE EXCEPTION 'fact-doubt-cycle has taken up doubts and answered none since % (% runs); failures by type: %',
      v_dry ->> 'zero_read_since', v_dry ->> 'zero_read_fires', coalesce(v_dry -> 'error_classes', '{}'::jsonb);
  END IF;
  RETURN v_out || jsonb_build_object('status', 'passed', 'checked_at', now());
END $function$

;
