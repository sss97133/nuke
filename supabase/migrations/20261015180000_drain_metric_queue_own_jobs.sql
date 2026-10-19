-- vehicle_metric_recompute_queue: its own short drain jobs, a commit after every chunk (the same shape as the completion queue's).
--
-- MEASURED (prod, 2026-10-15): the queue rose 2,735 (06:22Z) to 5,968 (06:52Z) and stood at 5,339 at 07:02Z while the completion
-- queue emptied (20,049 at 05:49Z to 6 at 07:02Z after drain-completion-a/b/c). Rolled-back profile of the oldest-last queue
-- entries (6 vehicles): count 0 to 5 ms, comments 0 to 1 ms, detect_field_conflicts 12 to 34 ms, plus the vehicles
-- observation_count UPDATE and the live-metrics upsert through the row triggers (about 20 ms a row). So about 60 ms a vehicle, 10
-- vehicles about 0.6 s. Job 500's metric slice starts first but is capped at 500 rows a run and only while its budget lasts.
--
-- WHAT. Procedure drain_vehicle_metric_queue_chunked(p_budget_seconds default 7, p_chunk default 10): calls the existing
-- drain_vehicle_metric_queue(p_chunk), COMMITs after each call, until a call runs short or the budget is spent (clamped 3..8 s: the
-- role's 10 s statement_timeout covers a whole CALL). The skip-completion-enqueue flag and the 2 s lock timeout are set again after
-- each commit. Three jobs run it every minute; the drain deletes FOR UPDATE SKIP LOCKED, so concurrent runs take different rows.
-- Job 500 is unchanged.
CREATE OR REPLACE PROCEDURE public.drain_vehicle_metric_queue_chunked(p_budget_seconds integer DEFAULT 7, p_chunk integer DEFAULT 10)
LANGUAGE plpgsql
AS $proc$
DECLARE
  v_until timestamptz := clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_budget_seconds, 7), 3), 8));
  v_chunk integer := least(greatest(coalesce(p_chunk, 10), 1), 50);
  v_p integer;
  v_e integer;
  v_processed integer := 0;
  v_errored integer := 0;
BEGIN
  LOOP
    PERFORM set_config('app.skip_completion_enqueue', '1', true);
    PERFORM set_config('lock_timeout', '2s', true);
    SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_metric_queue(v_chunk) d;
    COMMIT;
    v_processed := v_processed + coalesce(v_p, 0);
    v_errored := v_errored + coalesce(v_e, 0);
    EXIT WHEN coalesce(v_p, 0) + coalesce(v_e, 0) < v_chunk OR clock_timestamp() >= v_until;
  END LOOP;
  RAISE NOTICE 'drain_vehicle_metric_queue_chunked processed=% errored=%', v_processed, v_errored;
END
$proc$;

REVOKE ALL ON PROCEDURE public.drain_vehicle_metric_queue_chunked(integer, integer) FROM PUBLIC, anon, authenticated;
COMMENT ON PROCEDURE public.drain_vehicle_metric_queue_chunked(integer, integer) IS
  'Drains vehicle_metric_recompute_queue in chunks, one transaction per chunk, within 3..8 s (the role statement_timeout covers a whole CALL). Called alone by the drain-metric-a/b/c cron jobs.';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('drain-metric-a', 'drain-metric-b', 'drain-metric-c');
SELECT cron.schedule(n, '* * * * *', $job$CALL public.drain_vehicle_metric_queue_chunked(7, 10);$job$)
FROM unnest(ARRAY['drain-metric-a', 'drain-metric-b', 'drain-metric-c']) AS n;
