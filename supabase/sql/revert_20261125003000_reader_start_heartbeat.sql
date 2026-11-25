-- Revert 20261125003000_reader_start_heartbeat: the watch as in production on 2026-11-25, before it; the writer and column go.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
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
  v_dry jsonb;
BEGIN
  FOR r IN SELECT n AS jobname, a.assayed_at, a.reading
           FROM unnest(ARRAY['subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work']) AS n
           LEFT JOIN job_assay_readings a ON a.jobname = n LOOP
    v_out := v_out || jsonb_build_object(r.jobname, jsonb_build_object('assayed_at', r.assayed_at, 'reading', r.reading));
    IF r.assayed_at IS NULL OR r.assayed_at < now() - interval '40 minutes' THEN
      v_stale := v_stale || r.jobname;
    END IF;
  END LOOP;
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
END $function$;
DROP FUNCTION IF EXISTS public.record_reader_start(text);
ALTER TABLE public.job_assay_readings DROP COLUMN IF EXISTS run_started_at;
