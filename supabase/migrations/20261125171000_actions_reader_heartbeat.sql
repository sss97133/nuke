-- The GitHub Actions host gets its own reader heartbeat, and the reader watch fails when that host goes quiet while
-- there is work for it.
--
-- Since #3823 the stages job of .github/workflows/photo-keys.yml (every 20 minutes) runs the same frame reader as the
-- Mac's launchd job, against the same image_stage_work queue. record_reader_heartbeat admitted one name for that reader,
-- so each Actions fire overwrote the Mac's subscription-frame-classifier row (reading.host = 'github_actions' said which
-- one wrote it). job_assay_readings is one row per jobname (primary key), so a host gets a row by its own name.
--  1. record_reader_heartbeat admits 'subscription-frame-classifier-actions'. The stages job posts under it, and the
--     Mac's row is the Mac's again.
--  2. assay_subscription_readers (cron subscription-reader-watch; its run status is that job's row in v_job_health)
--     fails when that row is missing or older than 1 hour while image_stage_work holds queued, due rows of the stages
--     the reader claims (classifier, deep_reading, keyed_values). The new name is not added to the watch's 40-minute
--     list: an Actions schedule drifts by many minutes, and the Mac's readers keep their own rule.
-- Both live bodies are patched at anchors found exactly once, and only when their md5 (prosrc) is the body read from
-- production on 2026-11-25 or this migration's own result (a replay passes). Nothing reads an image or calls a model.
-- REVERT: supabase/sql/revert_20261125171000_actions_reader_heartbeat.sql.
-- Contract: supabase/sql/test_actions_reader_heartbeat.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  r record;
  d text;
  n int;
  a1 text := $a$'reconcile-receipt-work', 'answer-receipt-parts')$a$;
  r1 text := $a$'reconcile-receipt-work', 'answer-receipt-parts', 'subscription-frame-classifier-actions')$a$;
  a2 text := $a$  v_dry jsonb;
$a$;
  r2 text := $a$  v_dry jsonb;
  v_actions_at timestamptz; /* actions_reader_v1 */
$a$;
  a3 text := $a$  -- The loop reports in but answers nothing$a$;
  r3 text := $a$  -- The GitHub Actions host (photo-keys.yml, job stages, every 20 minutes) reads the same queue and posts as
  -- subscription-frame-classifier-actions. It fails the watch when it has not reported for an hour while the stages it
  -- reads hold queued, due work (a fire that fails posts nothing, so a failing job shows here too).
  SELECT a.assayed_at INTO v_actions_at FROM job_assay_readings a WHERE a.jobname = 'subscription-frame-classifier-actions';
  IF (v_actions_at IS NULL OR v_actions_at < now() - interval '1 hour')
     AND EXISTS (SELECT 1 FROM image_stage_work w
                  WHERE w.status = 'queued' AND w.not_before <= now()
                    AND w.stage IN ('classifier', 'deep_reading', 'keyed_values')) THEN
    RAISE EXCEPTION 'subscription reader silent on GitHub Actions: subscription-frame-classifier-actions last reported % while image_stage_work holds queued work (is photo-keys.yml stages scheduled and passing?)',
      coalesce(to_char(v_actions_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI"Z"'), 'never');
  END IF;
  v_out := v_out || jsonb_build_object('subscription-frame-classifier-actions', jsonb_build_object('assayed_at', v_actions_at));
  -- The loop reports in but answers nothing$a$;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.record_reader_heartbeat(text,jsonb,integer)', '7e56b94a78a0e24d8a29cf81cc4d9160', 'ab24353244eec44b1689ee0e2dd4de5f'),
      ('public.assay_subscription_readers()', '762d8679eec150ef52f9c5593add68a4', '2050ae85b2106aa5b277ee9764552f79')) AS t(fn, md5_before, md5_after) LOOP
    IF coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure(r.fn)), 'missing') NOT IN (r.md5_before, r.md5_after) THEN
      RAISE EXCEPTION '% is not the body this migration patches (md5 %); review before applying', r.fn,
        coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure(r.fn)), 'missing');
    END IF;
  END LOOP;

  d := pg_get_functiondef('public.record_reader_heartbeat(text, jsonb, integer)'::regprocedure);
  IF position('subscription-frame-classifier-actions' IN d) = 0 THEN
    IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'record_reader_heartbeat: anchor not found exactly once'; END IF;
    EXECUTE replace(d, a1, r1);
  END IF;

  d := pg_get_functiondef('public.assay_subscription_readers()'::regprocedure);
  IF position('actions_reader_v1' IN d) = 0 THEN
    FOR n IN SELECT (length(d) - length(replace(d, a, ''))) / length(a) FROM unnest(ARRAY[a2, a3]) a LOOP
      IF n <> 1 THEN RAISE EXCEPTION 'assay_subscription_readers: anchor drifted (% matches)', n; END IF;
    END LOOP;
    EXECUTE replace(replace(d, a2, r2), a3, r3);
  END IF;
END $patch$;

DO $chk$
BEGIN
  IF position('subscription-frame-classifier-actions' IN pg_get_functiondef('public.record_reader_heartbeat(text, jsonb, integer)'::regprocedure)) = 0
     OR position('actions_reader_v1' IN pg_get_functiondef('public.assay_subscription_readers()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'actions reader heartbeat: patch not in place';
  END IF;
  IF has_function_privilege('anon', 'public.record_reader_heartbeat(text, jsonb, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_reader_heartbeat(text, jsonb, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'record_reader_heartbeat must be service_role only';
  END IF;
END $chk$;
