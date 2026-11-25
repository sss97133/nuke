-- A subscription reader that started and never reported is named as stuck, apart from one that never started.
--
-- WHY. 2026-11-25 02:28Z: the document reader blocked in open() on a macOS privacy prompt (a local paper under a gated
-- folder). Because the batch skips every fire while a reader process is alive, the frame classifier, the fact-doubt loop
-- and the document reader all stopped. subscription-reader-watch raised "silent ... is com.nuke.subscription-reader
-- loaded and the Mac awake?", which reads the same for a sleeping Mac and a live, stuck process.
--
-- WHAT.
--   job_assay_readings.run_started_at: when the batch last started this reader. It is written only by
--     record_reader_start and never by the generic assay refresh, which owns attempted_at.
--   record_reader_start(p_jobname): service role only, with the same four names as record_reader_heartbeat. The batch
--     calls it just before it runs each reader.
--   assay_subscription_readers: a reader whose run_started_at is newer than its last heartbeat and more than 30 minutes
--     old raises "subscription reader stuck: <name> started <time> and has not reported" ahead of the silent check.
--     The body is patched at three anchors, exactly once each; nothing else changes.
-- REVERT: supabase/sql/revert_20261125003000_reader_start_heartbeat.sql. Contract: supabase/sql/test_reader_start_heartbeat.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.job_assay_readings ADD COLUMN IF NOT EXISTS run_started_at timestamptz;
COMMENT ON COLUMN public.job_assay_readings.run_started_at IS
  'reader_stuck_v1: when subscription-reader-batch.sh last started this reader (record_reader_start). Newer than assayed_at for 30 minutes = stuck.';

CREATE OR REPLACE FUNCTION public.record_reader_start(p_jobname text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'record_reader_start: service admission required' USING ERRCODE = '42501';
  END IF;
  IF p_jobname IS NULL OR p_jobname NOT IN ('subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work') THEN
    RAISE EXCEPTION 'record_reader_start: unknown reader %', coalesce(p_jobname, '?');
  END IF;
  INSERT INTO job_assay_readings (jobname, run_started_at, refresh_every, fresh_for)
  VALUES (p_jobname, now(), interval '10 minutes', interval '40 minutes')
  ON CONFLICT (jobname) DO UPDATE SET run_started_at = EXCLUDED.run_started_at;
  RETURN jsonb_build_object('jobname', p_jobname, 'run_started_at', now());
END $fn$;
REVOKE ALL ON FUNCTION public.record_reader_start(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_reader_start(text) TO service_role;

DO $patch$
DECLARE
  d text;
  a1 text := $a$SELECT n AS jobname, a.assayed_at, a.reading
$a$;
  r1 text := $a$SELECT n AS jobname, a.assayed_at, a.reading, a.run_started_at
$a$;
  a2 text := $a$  v_stale text[] := '{}';
$a$;
  r2 text := $a$  v_stale text[] := '{}';
  v_stuck text[] := '{}'; /* reader_stuck_v1 */
$a$;
  a3 text := $a$    IF r.assayed_at IS NULL OR r.assayed_at < now() - interval '40 minutes' THEN
$a$;
  r3 text := $a$    IF r.run_started_at IS NOT NULL AND r.run_started_at > coalesce(r.assayed_at, '-infinity'::timestamptz)
       AND r.run_started_at < now() - interval '30 minutes' THEN
      v_stuck := v_stuck || (r.jobname || ' started ' || to_char(r.run_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI"Z"'));
    END IF;
    IF r.assayed_at IS NULL OR r.assayed_at < now() - interval '40 minutes' THEN
$a$;
  a4 text := $a$  IF cardinality(v_stale) > 0 THEN
$a$;
  r4 text := $a$  IF cardinality(v_stuck) > 0 THEN
    RAISE EXCEPTION 'subscription reader stuck: % and has not reported (a live process with no result, or it failed; read ~/nuke/logs/subscription-reader.log)', array_to_string(v_stuck, '; ');
  END IF;
  IF cardinality(v_stale) > 0 THEN
$a$;
  n int;
BEGIN
  d := pg_get_functiondef('public.assay_subscription_readers()'::regprocedure);
  IF position('reader_stuck_v1' IN d) > 0 THEN RETURN; END IF;
  FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a1, a2, a3, a4]) a LOOP
    IF n <> 1 THEN RAISE EXCEPTION 'assay_subscription_readers: anchor drifted (% matches)', n; END IF;
  END LOOP;
  EXECUTE replace(replace(replace(replace(d, a1, r1), a2, r2), a3, r3), a4, r4);
END $patch$;
