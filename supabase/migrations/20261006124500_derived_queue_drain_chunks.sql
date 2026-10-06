-- drain-vehicle-derived-queues: loop the metric and completion drains in chunks inside the run's budget.
-- Lane Q (queues), data-model shift 2026-10-06. Diagnosis: ~/nuke-logs/data-hygiene-20261005/Q-DIAGNOSIS.md (local).
--
-- WHAT IS WRONG (prod, read 2026-10-06 11:45-12:00Z):
--  * vehicle_completion_recompute_queue holds 86,758 vehicles, the oldest queued 2026-09-28. The drain is healthy
--    but capped: job 500 runs every 5 min and calls drain_vehicle_completion_queue(50) once, so it removes at most
--    600 rows/h. pg_stat_user_tables n_tup_del = 102,150 over the 170 h since the 09-29 09:20Z restart (~600/h);
--    the 11:50Z run removed exactly 50 in 5.65 s. Arrivals: 741-2,804 new vehicles/day on quiet days and 22,578 on
--    10-06 06:00-09:59Z from bulk vehicles writes. At 600/h the backlog needs ~6 days with no new arrivals.
--  * Job 500 failed 1 of 288 runs in the last 24 h (08:30Z): drain_vehicle_metric_queue(100) hit the 55 s
--    statement_timeout in its observation_count UPDATE. The job runs with lock_timeout 0, so one lock wait on a
--    vehicles row can spend the whole budget, and a 100-row metric call cannot be interrupted between vehicles.
--
-- CHANGE (this function only; the inner drains, the queues and the cron row are unchanged):
--  1. Metric and completion are called repeatedly in chunks (metric 25, completion 50 rows per call) until the
--     queue runs short, a row fails, the per-run cap is reached (metric 500, completion 1,000) or two thirds of
--     the budget have passed (30 s of 45). No chunk starts after that point, so the chunk in flight ends inside
--     the 45 s budget and the 55 s statement_timeout. Stats (50) and value (100) still make one call each.
--  2. A chunk that reports any failed row ends that queue's loop for this run. The inner drains re-queue a failed
--     vehicle with queued_at = now(); without this rule the next chunk could claim it again in the same run.
--     Each failure still gets exactly one attempt per run, as before.
--  3. A whole-chunk failure keeps the earlier chunks' work (each chunk has its own exception block) and reports
--     errored = -1 as before. query_canceled still propagates.
--  4. lock_timeout is set to 5 s for the run's transaction (set_config(..., true)). A vehicles row held by another
--     writer fails that one vehicle, which the inner drain re-queues, instead of cancelling the run.
--
-- EXPECTED RATE (completion): measured cost per claimed row is 12 ms when the value is unchanged and 36-113 ms
-- when it is written (11:40-11:50Z runs: 1.82-5.65 s per 50 written rows). 30 s per run gives about 265-830 rows,
-- that is 3,200-10,000/h, capped at 12,000/h, against ~40/h of new rows on quiet days and 5,600/h during the 10-06
-- bulk burst. The 86,758 backlog clears in roughly 9-27 h. 63% of today's queued rows need no write.
-- LOCK EXPOSURE: rows claimed early in a run stay locked until the run commits, up to ~35 s instead of ~5 s.
-- Another writer that updates one of those vehicles waits that long. The claim is oldest-first (09-28/29 archive
-- vehicles first), so the exposure falls on cold rows until the backlog is gone.
--
-- Drift guard: PRE is md5(pg_get_functiondef) of the live definition, read from prod 2026-10-06 11:46Z through the
-- session pooler and reproduced byte for byte on a throwaway PostgreSQL 17.9 cluster. POST is the md5 of this body on
-- PostgreSQL 17. A mismatch refuses to run (fail closed); an already-applied body is a no-op notice.
--   select md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure));
-- CREATE OR REPLACE keeps the owner, ACL (postgres, service_role) and SECURITY INVOKER.
-- Contract: supabase/sql/test_vehicle_derived_queue_chunks.sql (PG17, wired into frontend-tests.yml).
-- SCHEMA_LAW: no new table, column or schedule. Forward-only. Applied by CI, never by hand.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure));
  IF f = '6e01a654bbff1503d8148d8e3d216f25' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE NOTICE 'drain_vehicle_derived_queues already loops in chunks';
  ELSIF f <> 'a31ee089871fefb2b1896a0bdad83027' THEN -- gitleaks:allow (live fingerprint read from prod 2026-10-06, not a secret)
    RAISE EXCEPTION 'drain_vehicle_derived_queues body drifted since 2026-10-06 (md5 %); review before replacement', f;
  END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.drain_vehicle_derived_queues(p_include_value boolean DEFAULT false, p_budget_seconds integer DEFAULT 45)
 RETURNS TABLE(queue text, processed integer, errored integer, skipped boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  -- No chunk starts after two thirds of the budget, so the chunk in flight ends inside it.
  v_last_start timestamptz := clock_timestamp() + make_interval(secs => p_budget_seconds * 2.0 / 3);
  v_p     integer;
  v_e     integer;
  v_chunk integer;
  v_cap   integer;
  v_name  text;
BEGIN
  -- The drains' writebacks must not re-enqueue completion recomputes (update_vehicle_completion reads this).
  PERFORM set_config('app.skip_completion_enqueue', '1', true);
  -- A vehicles row held by another writer fails that one vehicle (the drain re-queues it), not the whole run.
  PERFORM set_config('lock_timeout', '5s', true);

  FOREACH v_name IN ARRAY ARRAY['metric', 'completion', 'stats', 'value'] LOOP
    queue := v_name; processed := 0; errored := 0; skipped := false;

    IF v_name = 'value' AND NOT p_include_value THEN
      skipped := true;                       -- off until the sale data is clean
    ELSIF clock_timestamp() >= v_last_start THEN
      skipped := true;                       -- budget spent; the next run continues
    ELSE
      -- chunk = rows per inner call; cap = rows per run. Stats and value make one call.
      v_chunk := CASE v_name WHEN 'metric' THEN 25 WHEN 'completion' THEN 50 WHEN 'stats' THEN 50 ELSE 100 END;
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
            errored := -1;                   -- whole-chunk failure; earlier chunks of this run stay done
            RAISE WARNING 'drain_vehicle_%_queue failed: %', v_name, SQLERRM;
        END;
        EXIT WHEN errored = -1;
        processed := processed + coalesce(v_p, 0);
        errored   := errored + coalesce(v_e, 0);
        -- Stop when the queue ran short, a row failed (one attempt per failure per run), the cap is reached,
        -- or no time is left to start another chunk.
        EXIT WHEN coalesce(v_p, 0) + coalesce(v_e, 0) < v_chunk
               OR coalesce(v_e, 0) > 0
               OR processed + errored >= v_cap
               OR clock_timestamp() >= v_last_start;
      END LOOP;
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$function$;
COMMENT ON FUNCTION public.drain_vehicle_derived_queues(boolean, integer) IS
  'One 5-minute pass over the metric, completion, stats (and, when p_include_value, value) recompute queues with a wall-clock budget. Metric (25/call, 500/run) and completion (50/call, 1,000/run) loop in chunks; no chunk starts after 2/3 of the budget; a chunk with a failed row ends that queue for the run; lock_timeout 5 s for the run. Cron: drain-vehicle-derived-queues. 2026-09-27, chunked 2026-10-06.';
DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure)) <> '6e01a654bbff1503d8148d8e3d216f25' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'drain_vehicle_derived_queues replacement did not produce the expected body; rolling back';
  END IF;
END;
$post$;
COMMIT;
