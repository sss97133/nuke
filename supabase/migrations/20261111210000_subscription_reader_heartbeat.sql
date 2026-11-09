-- The subscription readers' heartbeat, visible in v_job_health.
--
-- Owner decision 2026-11-08: AI reading runs on the owner's Mac under his Claude Code login (launchd
-- com.nuke.subscription-reader, scripts/photo-pipeline/subscription-reader-batch.sh), not in a cron job. v_job_health
-- lists cron jobs only, and job_assay_readings is written only by refresh_job_health (service_role may SELECT it, nothing
-- more). A dead reader would therefore be silent. Two pieces close that:
--  1. record_reader_heartbeat(jobname, reading, elapsed_ms): the writer the wrapper calls after each fire, service_role
--     only, one upserted job_assay_readings row per reader (fresh 40 min, refresh 10 min: the plist fires every 10).
--  2. assay_subscription_readers(): raises when either reader has no heartbeat within 40 minutes, so the cron job
--     subscription-reader-watch (every 10 minutes) fails and v_job_health shows it failed; passes with both readings.
-- Nothing here reads an image or calls a model. Revert: supabase/sql/revert_20261111210000_subscription_reader_heartbeat.sql.
-- Contract: supabase/sql/test_subscription_reader_heartbeat.sql.
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
  IF p_jobname IS NULL OR p_jobname NOT IN ('subscription-document-reader', 'subscription-frame-classifier') THEN
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
COMMENT ON FUNCTION public.record_reader_heartbeat(text, jsonb, integer) IS
  'The subscription readers (launchd, the owner''s Mac) record one job_assay_readings row each after a fire: outcome counts, fresh for 40 minutes. Service role only.';

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
           FROM unnest(ARRAY['subscription-document-reader', 'subscription-frame-classifier']) AS n
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

DO $$
DECLARE j bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'subscription-reader-watch' LOOP PERFORM cron.unschedule(j); END LOOP;
  PERFORM cron.schedule('subscription-reader-watch', '6-59/10 * * * *',
    $cmd$SET statement_timeout = '20s'; SELECT public.assay_subscription_readers();$cmd$);
END $$;

DO $chk$
BEGIN
  IF to_regprocedure('public.record_reader_heartbeat(text, jsonb, integer)') IS NULL THEN RAISE EXCEPTION 'record_reader_heartbeat missing'; END IF;
  IF to_regprocedure('public.assay_subscription_readers()') IS NULL THEN RAISE EXCEPTION 'assay_subscription_readers missing'; END IF;
  IF has_function_privilege('anon', 'public.record_reader_heartbeat(text, jsonb, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_reader_heartbeat(text, jsonb, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'record_reader_heartbeat must be service_role only';
  END IF;
END $chk$;
