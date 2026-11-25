-- Contract for 20261125012000_reader_start_names: runs the reader-start contract (it ends reverted), re-applies
-- 20261125003000, then this migration twice. Asserts answer-receipt-parts records a start, an unknown name is refused,
-- and only the service role may call it.
\set ON_ERROR_STOP on
\ir test_reader_start_heartbeat.sql
\ir ../migrations/20261125003000_reader_start_heartbeat.sql
\ir ../migrations/20261125012000_reader_start_names.sql
\ir ../migrations/20261125012000_reader_start_names.sql
DO $$
DECLARE msg text; ok boolean := false;
BEGIN
  PERFORM set_config('test.role', 'service_role', false);
  PERFORM public.record_reader_start('answer-receipt-parts');
  ASSERT (SELECT run_started_at IS NOT NULL FROM public.job_assay_readings WHERE jobname = 'answer-receipt-parts'), 'the fifth reader records a start';
  BEGIN PERFORM public.record_reader_start('made-up-reader'); EXCEPTION WHEN others THEN msg := SQLERRM; END;
  ASSERT msg LIKE 'record_reader_start: unknown reader made-up-reader', 'unknown refused; got ' || coalesce(msg, 'accepted');
  PERFORM set_config('test.role', 'anon', false);
  BEGIN PERFORM public.record_reader_start('answer-receipt-parts'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, 'only the service role records a start';
END $$;
\echo reader_start_names: ok
