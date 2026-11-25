-- record_reader_start accepts the fifth reader. #3827 (20261124195000) added answer-receipt-parts to
-- record_reader_heartbeat, assay_subscription_readers and the batch; record_reader_start (20261125003000) still
-- listed four names, so every start the batch posts for answer-receipt-parts is refused and the stuck check never
-- sees that reader. The name list now matches record_reader_heartbeat's, read live 2026-11-25. Nothing else changes.
-- REVERT: re-run the record_reader_start definition in 20261125003000_reader_start_heartbeat.sql.
-- Contract: supabase/sql/test_reader_start_names.sql.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.record_reader_start(p_jobname text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $fn$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'record_reader_start: service admission required' USING ERRCODE = '42501';
  END IF;
  IF p_jobname IS NULL OR p_jobname NOT IN ('subscription-document-reader', 'subscription-frame-classifier', 'fact-doubt-cycle',
                                            'reconcile-receipt-work', 'answer-receipt-parts') THEN
    RAISE EXCEPTION 'record_reader_start: unknown reader %', coalesce(p_jobname, '?');
  END IF;
  INSERT INTO job_assay_readings (jobname, run_started_at, refresh_every, fresh_for)
  VALUES (p_jobname, now(), interval '10 minutes', interval '40 minutes')
  ON CONFLICT (jobname) DO UPDATE SET run_started_at = EXCLUDED.run_started_at;
  RETURN jsonb_build_object('jobname', p_jobname, 'run_started_at', now());
END $fn$;
REVOKE ALL ON FUNCTION public.record_reader_start(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_reader_start(text) TO service_role;
