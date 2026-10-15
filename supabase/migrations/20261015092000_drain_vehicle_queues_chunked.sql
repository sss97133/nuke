-- drain_vehicle_derived_queues_chunked: the same sequential drain, one transaction per chunk.
--
-- MEASURED (prod, 2026-10-15 04:15Z): ingest_bat_live_events, 4,117 calls, mean 334 ms, max 21.6 s. Its slow calls waited on
-- the pg_cron transaction of job 500, which holds the vehicle_metric_recompute_queue rows it deleted FOR UPDATE SKIP LOCKED
-- until the whole drain commits; observation inserts upsert those same rows (update_vehicle_live_metrics,
-- update_vehicle_observation_count). A procedure that COMMITs after each chunk holds a queue row for one chunk, not for the run.
--
-- WHAT. Procedure drain_vehicle_derived_queues_chunked(p_include_value, p_budget_seconds default 8), a copy of
-- drain_vehicle_derived_queues with its slice logic, chunk sizes, caps, retry circuit and 2 s lock timeout, plus a COMMIT
-- after every chunk (outside the exception block, which cannot commit). Transaction-local settings are set again for each
-- chunk, since a commit ends them. The function is left in place and unchanged.
-- LIMIT (measured on PostgreSQL 17): statement_timeout covers a whole CALL and the commits do not restart it, a procedure
-- with a SET clause cannot commit, and a lone CALL is needed for transaction control (a multi-statement cron command is
-- one implicit transaction). So the job is the lone CALL under the role default of 10 s, and the budget is clamped to 5..9 s;
-- the job runs every minute instead of every two. Value queue stays off.
-- Cost against before: 45 s of drain per 2 min (22 percent) becomes 8 s per minute (13 percent) with row locks held for
-- one chunk (about a second) instead of up to 55 s.
CREATE OR REPLACE PROCEDURE public.drain_vehicle_derived_queues_chunked(p_include_value boolean DEFAULT false, p_budget_seconds integer DEFAULT 8)
LANGUAGE plpgsql
AS $proc$
DECLARE
  v_budget integer := least(greatest(coalesce(p_budget_seconds, 8), 5), 9);
  v_t0     timestamptz := clock_timestamp();
  v_until  timestamptz;
  v_p      integer;
  v_e      integer;
  v_chunk  integer;
  v_cap    integer;
  v_failed_chunks integer;
  v_name   text;
  v_processed integer;
  v_errored   integer;
  v_out    text := '';
BEGIN
  FOREACH v_name IN ARRAY ARRAY['metric', 'stats', 'value', 'completion'] LOOP
    v_processed := 0; v_errored := 0; v_failed_chunks := 0;
    v_until := v_t0 + make_interval(secs => v_budget / CASE WHEN v_name = 'metric' THEN 2.0 ELSE 1.5 END);

    IF v_name = 'value' AND NOT p_include_value THEN
      CONTINUE;
    ELSIF clock_timestamp() >= v_until THEN
      CONTINUE;
    END IF;

    v_chunk := CASE v_name WHEN 'metric' THEN 10 WHEN 'completion' THEN 25 WHEN 'stats' THEN 50 ELSE 100 END;
    v_cap   := CASE v_name WHEN 'metric' THEN 500 WHEN 'completion' THEN 1000 ELSE v_chunk END;
    LOOP
      -- the previous commit ended the transaction-local settings; set them for this chunk
      PERFORM set_config('app.skip_completion_enqueue', '1', true);
      PERFORM set_config('lock_timeout', '2s', true);
      BEGIN
        v_p := NULL; v_e := NULL;
        CASE v_name
          WHEN 'metric'     THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_metric_queue(v_chunk) d;
          WHEN 'completion' THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_completion_queue(v_chunk) d;
          WHEN 'stats'      THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_stats_queue(v_chunk) d;
          WHEN 'value'      THEN SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_value_queue(v_chunk) d;
        END CASE;
      EXCEPTION
        WHEN query_canceled THEN
          RAISE;
        WHEN OTHERS THEN
          v_errored := -1;
          RAISE WARNING 'drain_vehicle_%_queue failed: %', v_name, SQLERRM;
      END;
      COMMIT;   -- the chunk's queue-row locks end here
      EXIT WHEN v_errored = -1;
      v_processed := v_processed + coalesce(v_p, 0);
      v_errored   := v_errored + coalesce(v_e, 0);
      IF coalesce(v_e, 0) > 0 THEN v_failed_chunks := v_failed_chunks + 1; END IF;
      IF v_failed_chunks >= 3 OR v_errored > 0.2 * (v_processed + v_errored) THEN
        RAISE WARNING 'drain_vehicle_%_queue stopped for this run: % failed rows in % chunks', v_name, v_errored, v_failed_chunks;
        EXIT;
      END IF;
      EXIT WHEN coalesce(v_p, 0) + coalesce(v_e, 0) < v_chunk
             OR v_processed + v_errored >= v_cap
             OR clock_timestamp() >= v_until;
    END LOOP;
    v_out := v_out || format(' %s=%s/%s', v_name, v_processed, v_errored);
  END LOOP;
  RAISE NOTICE 'drain_vehicle_derived_queues_chunked processed/errored:%', v_out;
END
$proc$;

REVOKE ALL ON PROCEDURE public.drain_vehicle_derived_queues_chunked(boolean, integer) FROM PUBLIC, anon, authenticated;
COMMENT ON PROCEDURE public.drain_vehicle_derived_queues_chunked(boolean, integer) IS
  'Sequential metric/stats/value/completion drain that commits after every chunk, so queue-row locks last one chunk. Budget clamped 5..9 s (statement_timeout covers a whole CALL). Same slices, caps, retry circuit and 2 s lock timeout as drain_vehicle_derived_queues. Called alone from cron job 500.';

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobid = 500 AND jobname = 'drain-vehicle-derived-queues' AND active) THEN
    RAISE EXCEPTION 'cron job 500 is not the active drain-vehicle-derived-queues; re-read it first';
  END IF;
END
$check$;

-- a lone CALL: pg_cron sends a multi-statement string as one implicit transaction, which cannot commit
SELECT cron.alter_job(
  500,
  schedule := '* * * * *',
  command := $job$CALL public.drain_vehicle_derived_queues_chunked(false, 8);$job$
);
