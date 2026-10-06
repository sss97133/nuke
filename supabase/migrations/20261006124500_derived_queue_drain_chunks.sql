-- drain-vehicle-derived-queues: chunked drains with a per-queue time slice, and completion retries that count.
-- Lane Q (queues), data-model shift 2026-10-06. Diagnosis: ~/nuke-logs/data-hygiene-20261005/Q-DIAGNOSIS.md (local).
--
-- WHAT IS WRONG (prod, read 2026-10-06 11:45-12:15Z):
--  * vehicle_completion_recompute_queue holds 86,537 vehicles, the oldest queued 2026-09-28. The drain is healthy
--    but capped: job 500 runs every 5 min and calls drain_vehicle_completion_queue(50) once, so it removes at most
--    600 rows/h. pg_stat_user_tables n_tup_del = 102,150 over the 170 h since the 09-29 09:20Z restart (~600/h);
--    the 11:50Z run removed exactly 50 in 5.65 s. Arrivals: 741-2,804 new vehicles/day on quiet days and 22,578 on
--    10-06 06:00-09:59Z from bulk vehicles writes. At 600/h the backlog needs ~6 days with no new arrivals.
--  * Job 500 failed 1 of 288 runs in the last 24 h (08:30Z): drain_vehicle_metric_queue(100) hit the 55 s
--    statement_timeout in its observation_count UPDATE. The job runs with lock_timeout 0, so one lock wait on a
--    vehicles row can spend the whole budget, and a 100-row metric call cannot be interrupted between vehicles.
--  * drain_vehicle_completion_queue re-queues a failed vehicle with attempts = 1 after its claim DELETE, so a vehicle
--    that always fails never reaches its own attempts >= 3 purge and is retried every run forever.
--
-- CHANGE 1, drain_vehicle_derived_queues (the cron row is unchanged):
--  * Budget = coalesce(p_budget_seconds, 45) clamped to 5..60, so a NULL or absurd budget cannot disable the time stop.
--  * Order metric, stats, value, completion. Metric starts chunks only in the first third of the budget (15 s of 45);
--    every queue stops starting chunks at half the budget (22.5 s), so a slow last chunk still lands inside it.
--    Stats (50) and value (100, off) make one call each before completion, so neither starves behind a completion
--    backlog, and a metric backlog cannot take completion's slice.
--  * Chunks: metric 10 rows per call up to 500 per run; completion 25 per call up to 1,000 per run.
--  * A failed row does not end the loop; the inner drains re-queue it behind the backlog (queued_at = now()).
--    A queue stops for the run after 3 chunks with failures, or when failed rows exceed 20% of the rows it claimed.
--    errored is the cumulative count of failed rows; -1 still marks a whole-call failure (earlier chunks are kept,
--    each chunk has its own exception block). query_canceled still propagates. The return type is unchanged.
--  * lock_timeout 2 s through set_config(..., true): it lasts until the calling transaction ends (the cron job's
--    own transaction) and then reverts; a caller inside a longer transaction keeps it until that one ends.
--    A vehicles row held by another writer fails that one vehicle, which the inner drain re-queues.
--  * Worst case against the 55 s cap: a run overruns only if ~16 of one completion chunk's 25 rows (or every row of a
--    metric chunk with a heavy fold) are each held > 2 s by other writers. Then the run rolls back and the next run
--    retries, which is today's behavior for every overrun.
-- CHANGE 2, drain_vehicle_completion_queue: the claim returns attempts and a failure re-queues with attempts + 1.
--    The third failure is purged by the function's existing DELETE ... attempts >= 3. Nothing else changes.
--
-- EXPECTED RATE (completion): 12 ms per claimed row when the value is unchanged, 36-113 ms when it is written
-- (11:40-11:50Z runs: 1.82-5.65 s per 50 written rows). With a quiet metric queue completion gets ~22 s per run:
-- ~220-640 rows, 2,600-7,700/h; during a metric burst ~7.5 s: 1,100-2,800/h. Enqueue: ~40/h on quiet days,
-- ~5,600/h in the 10-06 burst. The 86.5K backlog clears in roughly 11-33 h. 63% of today's queued rows need no write.
-- LOCK EXPOSURE: rows claimed early in a run stay locked until the run commits, up to ~25 s instead of ~5 s.
-- The claim is oldest-first, so the exposure falls on cold 09-28/29 archive vehicles until the backlog is gone.
--
-- Drift guard: PRE is md5(pg_get_functiondef) of each live definition, read from prod 2026-10-06 11:46Z and 12:09Z
-- through the session pooler and reproduced byte for byte on a throwaway PostgreSQL 17.9 cluster. POST is the md5 of
-- each new body on PostgreSQL 17. A mismatch refuses to run (fail closed); an already-applied body is a no-op notice.
--   select md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure));
--   select md5(pg_get_functiondef('public.drain_vehicle_completion_queue(integer)'::regprocedure));
-- CREATE OR REPLACE keeps each owner, ACL and SECURITY INVOKER.
-- Contract: supabase/sql/test_vehicle_derived_queue_chunks.sql (PG17, wired into frontend-tests.yml).
-- SCHEMA_LAW: no new table, column or schedule. Forward-only. Applied by CI, never by hand.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure));
  IF f = '8a90f979b6556121efc905b8e6d44fc6' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE NOTICE 'drain_vehicle_derived_queues already has per-queue slices';
  ELSIF f <> 'a31ee089871fefb2b1896a0bdad83027' THEN -- gitleaks:allow (live fingerprint read from prod 2026-10-06, not a secret)
    RAISE EXCEPTION 'drain_vehicle_derived_queues body drifted since 2026-10-06 (md5 %); review before replacement', f;
  END IF;
  f := md5(pg_get_functiondef('public.drain_vehicle_completion_queue(integer)'::regprocedure));
  IF f = 'f78c859a15440aed6ce40531333274a7' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE NOTICE 'drain_vehicle_completion_queue already carries attempts';
  ELSIF f <> '60882c706b57faca9e2434081eb04a99' THEN -- gitleaks:allow (live fingerprint read from prod 2026-10-06, not a secret)
    RAISE EXCEPTION 'drain_vehicle_completion_queue body drifted since 2026-10-06 (md5 %); review before replacement', f;
  END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.drain_vehicle_completion_queue(p_batch_size integer DEFAULT 50)
 RETURNS TABLE(processed integer, errored integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  r record;
  n_processed int := 0;
  n_errored   int := 0;
  v_pct numeric;
  v_data jsonb;
BEGIN
  -- Tell the BEFORE UPDATE trigger to skip enqueueing on our writeback.
  -- set_config(..., true) = transaction-local. The trigger's
  -- current_setting('app.skip_completion_enqueue', true) reads it.
  PERFORM set_config('app.skip_completion_enqueue', '1', true);

  FOR r IN
    DELETE FROM public.vehicle_completion_recompute_queue
    WHERE vehicle_id IN (
      SELECT vehicle_id
      FROM public.vehicle_completion_recompute_queue
      ORDER BY queued_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    RETURNING vehicle_id, attempts
  LOOP
    BEGIN
      v_data := public.calculate_vehicle_completion_algorithmic(r.vehicle_id);
      IF v_data IS NOT NULL AND v_data ? 'completion_percentage' THEN
        v_pct := (v_data->>'completion_percentage')::numeric;
        UPDATE public.vehicles
        SET completion_percentage = ROUND(v_pct)::int
        WHERE id = r.vehicle_id
          AND completion_percentage IS DISTINCT FROM ROUND(v_pct)::int;
      END IF;
      n_processed := n_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      n_errored := n_errored + 1;
      INSERT INTO public.vehicle_completion_recompute_queue (vehicle_id, queued_at, attempts, last_error)
      VALUES (r.vehicle_id, now(), coalesce(r.attempts, 0) + 1, SQLERRM)
      ON CONFLICT (vehicle_id) DO UPDATE SET
        attempts   = public.vehicle_completion_recompute_queue.attempts + 1,
        last_error = EXCLUDED.last_error,
        queued_at  = EXCLUDED.queued_at;
      DELETE FROM public.vehicle_completion_recompute_queue
      WHERE vehicle_id = r.vehicle_id AND attempts >= 3;
    END;
  END LOOP;

  RETURN QUERY SELECT n_processed, n_errored;
END;
$function$;
CREATE OR REPLACE FUNCTION public.drain_vehicle_derived_queues(p_include_value boolean DEFAULT false, p_budget_seconds integer DEFAULT 45)
 RETURNS TABLE(queue text, processed integer, errored integer, skipped boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  -- A NULL or absurd budget cannot switch the time stop off.
  v_budget integer := least(greatest(coalesce(p_budget_seconds, 45), 5), 60);
  v_t0     timestamptz := clock_timestamp();
  v_until  timestamptz;
  v_p      integer;
  v_e      integer;
  v_chunk  integer;
  v_cap    integer;
  v_failed_chunks integer;
  v_name   text;
BEGIN
  -- The drains' writebacks must not re-enqueue completion recomputes (update_vehicle_completion reads this).
  PERFORM set_config('app.skip_completion_enqueue', '1', true);
  -- Transaction-local (set_config(..., true)): it reverts when the calling transaction, the cron job's own, ends.
  -- A vehicles row held by another writer fails that one vehicle after 2 s; the drain re-queues it.
  PERFORM set_config('lock_timeout', '2s', true);

  -- Metric starts chunks only in the first third of the budget; every queue stops starting chunks at half the
  -- budget so a slow last chunk still lands. Stats and value (one call each) run before completion.
  FOREACH v_name IN ARRAY ARRAY['metric', 'stats', 'value', 'completion'] LOOP
    queue := v_name; processed := 0; errored := 0; skipped := false; v_failed_chunks := 0;
    v_until := v_t0 + make_interval(secs => v_budget / CASE WHEN v_name = 'metric' THEN 3.0 ELSE 2.0 END);

    IF v_name = 'value' AND NOT p_include_value THEN
      skipped := true;                       -- off until the sale data is clean
    ELSIF clock_timestamp() >= v_until THEN
      skipped := true;                       -- this queue's slice is spent; the next run continues
    ELSE
      -- chunk = rows per inner call; cap = rows per run. Stats and value make one call.
      v_chunk := CASE v_name WHEN 'metric' THEN 10 WHEN 'completion' THEN 25 WHEN 'stats' THEN 50 ELSE 100 END;
      v_cap   := CASE v_name WHEN 'metric' THEN 500 WHEN 'completion' THEN 1000 ELSE v_chunk END;
      LOOP
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
            RAISE;                           -- the job's own budget fired; fail loudly, do not swallow
          WHEN OTHERS THEN
            errored := -1;                   -- whole-call failure; earlier chunks of this run stay done
            RAISE WARNING 'drain_vehicle_%_queue failed: %', v_name, SQLERRM;
        END;
        EXIT WHEN errored = -1;
        processed := processed + coalesce(v_p, 0);
        errored   := errored + coalesce(v_e, 0);
        IF coalesce(v_e, 0) > 0 THEN v_failed_chunks := v_failed_chunks + 1; END IF;
        IF v_failed_chunks >= 3 OR errored > 0.2 * (processed + errored) THEN
          RAISE WARNING 'drain_vehicle_%_queue stopped for this run: % failed rows in % chunks', v_name, errored, v_failed_chunks;
          EXIT;
        END IF;
        -- Stop when the queue ran short, the cap is reached, or this queue's slice has no time for another chunk.
        EXIT WHEN coalesce(v_p, 0) + coalesce(v_e, 0) < v_chunk
               OR processed + errored >= v_cap
               OR clock_timestamp() >= v_until;
      END LOOP;
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$function$;
COMMENT ON FUNCTION public.drain_vehicle_derived_queues(boolean, integer) IS
  'One 5-minute pass over the metric, stats, value (when p_include_value) and completion recompute queues. Budget coalesce(p_budget_seconds,45) clamped 5..60. Metric (10/call, 500/run) starts chunks in the first third of the budget; stats and value make one call; completion (25/call, 1,000/run) takes the rest; no chunk starts after half the budget. A queue stops for the run after 3 failed chunks or >20% failed rows. lock_timeout 2 s, transaction-local. Cron: drain-vehicle-derived-queues. 2026-09-27, chunked 2026-10-06.';
DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure)) <> '8a90f979b6556121efc905b8e6d44fc6' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'drain_vehicle_derived_queues replacement did not produce the expected body; rolling back';
  END IF;
  IF md5(pg_get_functiondef('public.drain_vehicle_completion_queue(integer)'::regprocedure)) <> 'f78c859a15440aed6ce40531333274a7' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'drain_vehicle_completion_queue replacement did not produce the expected body; rolling back';
  END IF;
END;
$post$;
COMMIT;
