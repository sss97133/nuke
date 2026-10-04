-- Preserve failures in the existing receipt-derived value-score queue.
-- The value cron remains paused; this is not a dollar-valuation/revision worker.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $repair$
DECLARE
  existing_body text;
  replacement_body text:=$body$
DECLARE
  r record;
  n_processed int := 0;
  n_errored int := 0;
BEGIN
  PERFORM set_config('app.skip_completion_enqueue', '1', true);
  FOR r IN
    SELECT vehicle_id, attempts
    FROM public.vehicle_value_recompute_queue
    WHERE attempts < 3
    ORDER BY queued_at, vehicle_id
    LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 100), 0), 1000)
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.compute_vehicle_value(r.vehicle_id);
      DELETE FROM public.vehicle_value_recompute_queue WHERE vehicle_id = r.vehicle_id;
      n_processed := n_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.vehicle_value_recompute_queue
      SET attempts = r.attempts + 1, last_error = SQLERRM
      WHERE vehicle_id = r.vehicle_id;
      n_errored := n_errored + 1;
    END;
  END LOOP;
  RETURN QUERY SELECT n_processed, n_errored;
END;
$body$;
BEGIN
  SELECT prosrc INTO existing_body FROM pg_proc
  WHERE oid='public.drain_vehicle_value_queue(integer)'::regprocedure
    AND NOT prosecdef AND proconfig IS NULL;
  IF existing_body IS NULL OR (
    encode(sha256(convert_to(existing_body,'UTF8')),'base64') <> 'NWMwIwbJUxWpPsgQ0cpjKqPgliZlunJFCbf2F7KOBK8='
    AND existing_body IS DISTINCT FROM replacement_body
  ) THEN
    RAISE EXCEPTION 'Expected reviewed original/repaired receipt value-queue invoker body';
  END IF;
  IF existing_body IS DISTINCT FROM replacement_body THEN
    EXECUTE format('CREATE OR REPLACE FUNCTION public.drain_vehicle_value_queue(p_batch_size integer DEFAULT 100)
      RETURNS TABLE(processed integer, errored integer) LANGUAGE plpgsql AS %L',replacement_body);
  END IF;
END;
$repair$;
SELECT count(*) AS lock_waiters FROM pg_stat_activity WHERE wait_event_type='Lock';
COMMIT;
