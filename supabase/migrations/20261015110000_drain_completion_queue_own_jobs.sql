-- vehicle_completion_recompute_queue: its own short drain jobs, a commit after every chunk.
--
-- MEASURED (prod, 2026-10-15): the queue stood at 2,024 at 04:54Z, 20,049 at 05:49Z (the intake gate ceiling is 2,000
-- to 20,000 depending on the writer). calculate_vehicle_completion_algorithmic costs 2 to 6 ms a vehicle (8 vehicles: 42, 5, 3,
-- 5, 6, 5, 4, 2 ms); the cost is the vehicles UPDATE it triggers (about 20 ms a row through the row triggers, profiled with
-- a forced-rollback EXPLAIN ANALYZE earlier today). The completion slice of job 500 starts only in the last part of its
-- budget behind the metric slice, so it got a few hundred rows a run, and every run held its queue-row locks for the whole
-- transaction.
--
-- WHAT. Procedure drain_vehicle_completion_queue_chunked(p_budget_seconds default 7, p_chunk default 25): calls the existing
-- drain_vehicle_completion_queue(p_chunk) and COMMITs after each call, until the queue runs short or the budget is spent;
-- a lone CALL is needed for the commit and the role's 10 s statement_timeout covers the whole CALL, so the budget is
-- clamped to 3..8 s. Three jobs run it every minute: the drain deletes with FOR UPDATE SKIP LOCKED, so concurrent runs take
-- different rows. Job 500 is left as it is. The retry circuit and the skip-enqueue flag live in the existing function.
CREATE OR REPLACE PROCEDURE public.drain_vehicle_completion_queue_chunked(p_budget_seconds integer DEFAULT 7, p_chunk integer DEFAULT 25)
LANGUAGE plpgsql
AS $proc$
DECLARE
  v_until timestamptz := clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_budget_seconds, 7), 3), 8));
  v_chunk integer := least(greatest(coalesce(p_chunk, 25), 1), 100);
  v_p integer;
  v_e integer;
  v_processed integer := 0;
  v_errored integer := 0;
BEGIN
  LOOP
    PERFORM set_config('lock_timeout', '2s', true);
    SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_completion_queue(v_chunk) d;
    COMMIT;
    v_processed := v_processed + coalesce(v_p, 0);
    v_errored := v_errored + coalesce(v_e, 0);
    EXIT WHEN coalesce(v_p, 0) + coalesce(v_e, 0) < v_chunk OR clock_timestamp() >= v_until;
  END LOOP;
  RAISE NOTICE 'drain_vehicle_completion_queue_chunked processed=% errored=%', v_processed, v_errored;
END
$proc$;

REVOKE ALL ON PROCEDURE public.drain_vehicle_completion_queue_chunked(integer, integer) FROM PUBLIC, anon, authenticated;
COMMENT ON PROCEDURE public.drain_vehicle_completion_queue_chunked(integer, integer) IS
  'Drains vehicle_completion_recompute_queue in chunks, one transaction per chunk, within a budget of 3..8 s (the role statement_timeout covers a whole CALL). Called alone by the drain-completion-a/b/c cron jobs.';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('drain-completion-a', 'drain-completion-b', 'drain-completion-c');
SELECT cron.schedule(n, '* * * * *', $job$CALL public.drain_vehicle_completion_queue_chunked(7, 25);$job$)
FROM unnest(ARRAY['drain-completion-a', 'drain-completion-b', 'drain-completion-c']) AS n;
