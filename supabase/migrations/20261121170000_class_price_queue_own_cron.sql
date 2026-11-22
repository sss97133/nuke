-- class_price queue: its own cron statement and timeout; drain_vehicle_derived_queues back to its four slices.
--
-- Why. 20261121110000 added a fifth slice, class_price, to drain_vehicle_derived_queues (job 500: every 2 min, one
-- statement, statement_timeout 55 s, budget 30 s). A refresh checks its clock only between classification chunks, so
-- the parts outside that loop are not bounded. Measured 2026-11-21 (all read-only, warm and cold, on production):
--   * refreshes run by hand tonight (service role; nuke-logs garage-cleanup-20261120, field ms): 1967 Chevrolet Camaro
--     (4,695 members) 39.7 s with 0 members to classify and 19.6 s with 694; 1971 C10 37.6 s; 1971 Bronco 29.3 s with
--     488 (about 60 ms a member) and 11.3 s with 0.
--   * where the time goes for the Camaro with nothing stale (EXPLAIN ANALYZE, BUFFERS): cohort_members, one index scan
--     of every 1967 Chevrolet (15,363 heap rows, 4,695 kept by the model regex), 7.7 s cold (13,740 buffer reads, about
--     0.56 ms a read) and 79 ms warm; the price aggregate over the members' sold events 2.8 s partly cold (4,077 reads)
--     and 384 ms warm; the out-of-date member list 95 ms warm; the subject's own classification 62 ms; the resolver 28 ms.
--     So about 10.5 s cold and 0.65 s warm, all of it page reads, none of it inside the clock-checked loop. The rest of
--     the 39.7 s is not reproduced: the hand run shared the disk with the drains; that is a guess, not a measurement.
--   * job 500 since 08:16Z: 53 runs, all succeeded, longest 14.2 s, the class price queue empty throughout.
-- One run can therefore pass 55 s; the statement is then cancelled, all five slices and the queue claim roll back, and
-- the same vehicle is first in line two minutes later: the four older slices could starve. A statement_timeout set
-- inside a function does not cancel anything in PostgreSQL 17 (SET LOCAL, set_config(..., true) and a function SET
-- clause each let pg_sleep(3) finish under a 1 s setting, checked on 17.9), so a per-vehicle subtransaction cannot bound
-- a refresh; and a CALLed procedure cannot COMMIT when the command string sets a timeout first ("invalid transaction
-- termination"), while a CALL alone runs under the role's 10 s.
--
-- What this does:
--   1. drain_vehicle_derived_queues is restored to exactly its body before 20261121110000 (md5 f2e15e76..., the
--      20261006124500 body with the 20261009024034 slice change: rebuilt from both files, and equal to the live body
--      with the class_price block removed). Asserted below. Job 500 is not touched.
--   2. The class price queue gets its own cron job, drain-class-price-queue, odd minutes (job 500 runs on even ones),
--      in the shape job 574 (drain-metric-slow) already runs: one command string whose statements each get their own
--      timeout. Statement one (15 s) tops the queue up and claims one vehicle, marking it before any work: attempts + 1,
--      queued_at now (to the back of the line), reason 'running', last_error saying the refresh has not finished. COMMIT.
--      Statement two (55 s) refreshes that vehicle with a 20 s classification budget. A finished refresh dequeues it; an
--      incomplete one goes back as 'incomplete' with the attempt taken back; an error is kept with its message. If the
--      statement is cancelled, its own writes roll back and the committed mark is what remains: the attempt and its
--      error are recorded, and the vehicle waits behind the others. The retry policy is the queue's own (20261121110000):
--      fewer than 3 attempts, else once a day. A 'running' mark younger than 5 minutes is never claimed (the overlap
--      guard; pg_cron's documentation also says one job never runs twice at once, and no run of any job overlapped its
--      predecessor in cron.job_run_details for the 6 h before 10:20Z). The two timeouts sum to 70 s, inside the 2 minutes.
--      Latency: one vehicle a run (up to 720 a day, where job 500 took up to 20 a run), so the 138-row daily sweep takes
--      about 4.6 h and a receipt that lands during it waits behind it.
--   3. The daily top-up (stored rows older than 24 h, 50 a call) moves into top_up_vehicle_class_price_queue, called by
--      the claim, so it runs every two minutes from the new job and survives a cancelled refresh.
--      drain_vehicle_class_price_queue keeps its signature as the by-hand drain (one statement, no cron): it now claims
--      and refreshes through the same two functions, so there is one claim, one retry policy and one top-up.
--   4. refresh_vehicle_class_price is not changed: never blank holds as before (an unfinished cohort keeps a stored price).
--
-- Unchanged and not fixed here: cohort membership reads every vehicle of the year and make (an index on vehicles would
-- narrow it; not done here: no DDL on vehicles). No DDL on any table; no rows written except the cron row.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 0. Refuse to replace bodies that changed since they were read --------------------------------------------------------
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure));
  IF f NOT IN ('2bf3f88d02acaa3244e4312893d18fd9', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               'f2e15e76d18ecfdd966451635b0fa677') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'drain_vehicle_derived_queues changed since 2026-11-21 (md5 %); review before replacement', f;
  END IF;
  f := md5(pg_get_functiondef('public.drain_vehicle_class_price_queue(integer,integer)'::regprocedure));
  IF f NOT IN ('1132c06732d686ac866864c3686768a6', -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
               '5939098a9eedbe3ed77244091f321ece') THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'drain_vehicle_class_price_queue changed since 2026-11-21 (md5 %); review before replacement', f;
  END IF;
  -- The claimed refresh reads this body's answer (complete, status); it must be the one read.
  f := md5(pg_get_functiondef('public.refresh_vehicle_class_price(uuid,integer,integer,interval)'::regprocedure));
  IF f <> '3bb0a0f6c048f71bb4deda69adcdd993' THEN -- gitleaks:allow (function-definition fingerprint read 2026-11-21, not a secret)
    RAISE EXCEPTION 'refresh_vehicle_class_price changed since 20261121160000 (md5 %); review before relying on it', f;
  END IF;
END
$guard$;

-- 1. The controller, as it was before 20261121110000 (pg_get_functiondef text, verbatim) ---------------------------------
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

  -- Metric starts chunks in the first half; siblings stop starting chunks at two thirds of the budget.
  -- The reserved sixth lets stats and completion progress after a metric burst; the final third is headroom.
  FOREACH v_name IN ARRAY ARRAY['metric', 'stats', 'value', 'completion'] LOOP
    queue := v_name; processed := 0; errored := 0; skipped := false; v_failed_chunks := 0;
    v_until := v_t0 + make_interval(secs => v_budget / CASE WHEN v_name = 'metric' THEN 2.0 ELSE 1.5 END);

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
COMMENT ON FUNCTION public.drain_vehicle_derived_queues(boolean,integer) IS
  'Existing sequential metric/stats/value/completion controller. Budget coalesce45 clamped5..60; metric10/call,500/run starts through half the budget; siblings stats50/value100/completion25,1000/run start through two thirds, with final-third headroom. Existing retry circuit and transaction-local2s lock timeout. Value remains OFF in the unchanged every2min cron. Canonical metric owner and source clocks unchanged. Rebalanced2026-10-09 after >3h metric lag.';
DO $restored$
BEGIN
  IF md5(pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure))
     <> 'f2e15e76d18ecfdd966451635b0fa677' THEN -- gitleaks:allow (function-definition fingerprint, not a secret)
    RAISE EXCEPTION 'drain_vehicle_derived_queues is not the four-slice body it had before 20261121110000';
  END IF;
END
$restored$;

-- 2. The daily top-up, one copy ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.top_up_vehicle_class_price_queue(p_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_n integer;
BEGIN
  -- Stored rows older than 24 h (paper, text, year, make or model may have changed since), oldest first.
  INSERT INTO vehicle_class_price_recompute_queue (vehicle_id, queued_at, reason)
  SELECT p.vehicle_id, now(), 'stale'
    FROM vehicle_class_price p
   WHERE p.computed_at < now() - interval '24 hours'
     AND NOT EXISTS (SELECT 1 FROM vehicle_class_price_recompute_queue q WHERE q.vehicle_id = p.vehicle_id)
     AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = p.vehicle_id)
   ORDER BY p.computed_at
   LIMIT least(greatest(coalesce(p_limit, 50), 0), 500)
  ON CONFLICT (vehicle_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
COMMENT ON FUNCTION public.top_up_vehicle_class_price_queue(integer) IS
  'The class price daily sweep: queues stored vehicle_class_price rows older than 24 h (oldest first, p_limit a call, '
  'vehicles that still exist). Called by claim_vehicle_class_price_queue_id.';
REVOKE ALL ON FUNCTION public.top_up_vehicle_class_price_queue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.top_up_vehicle_class_price_queue(integer) TO service_role;

-- 3. Claim one vehicle and mark the attempt before any work ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_vehicle_class_price_queue_id(p_exclude uuid[] DEFAULT '{}')
 RETURNS uuid
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE v_id uuid; v_reason text;
BEGIN
  PERFORM public.top_up_vehicle_class_price_queue(50);
  SELECT q.vehicle_id, q.reason INTO v_id, v_reason
    FROM vehicle_class_price_recompute_queue q
   -- the queue's retry policy: an id that failed 3 times waits a day (new paper resets attempts)
   WHERE (q.attempts < 3 OR q.queued_at < now() - interval '24 hours')
     -- a refresh started under 5 minutes ago may still be running
     AND NOT (q.reason = 'running' AND q.queued_at > now() - interval '5 minutes')
     AND q.vehicle_id <> ALL (coalesce(p_exclude, '{}'))
   ORDER BY q.queued_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  -- The mark is the attempt. It is committed before the refresh starts (the cron command COMMITs between the two), so a
  -- cancelled or timed-out refresh leaves it: one more attempt, an error, and a place at the back of the line.
  UPDATE vehicle_class_price_recompute_queue
     SET attempts = least(attempts + 1, 32767), queued_at = now(), reason = 'running',
         last_error = format('refresh started %s UTC (queued as %s) and did not finish: cancelled, timed out or the session ended',
                             to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), coalesce(v_reason, 'unknown'))
   WHERE vehicle_id = v_id;
  RETURN v_id;
END;
$function$;
COMMENT ON FUNCTION public.claim_vehicle_class_price_queue_id(uuid[]) IS
  'Tops vehicle_class_price_recompute_queue up (top_up_vehicle_class_price_queue) and claims its oldest eligible id '
  '(attempts < 3, or queued over 24 h ago; not a running mark under 5 minutes old; SKIP LOCKED), marking it before any '
  'work: attempts + 1, queued_at now, reason running, last_error "did not finish". Commit the mark, then call '
  'refresh_claimed_vehicle_class_price, which clears or replaces it. Cron job drain-class-price-queue.';
REVOKE ALL ON FUNCTION public.claim_vehicle_class_price_queue_id(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_vehicle_class_price_queue_id(uuid[]) TO service_role;

-- 4. Refresh the claimed vehicle and settle its mark ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_claimed_vehicle_class_price(p_vehicle_id uuid, p_budget_ms integer DEFAULT 20000)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_t0      timestamptz := clock_timestamp();
  v_budget  integer := least(greatest(coalesce(p_budget_ms, 20000), 1000), 30000);
  v_mark    timestamptz;
  v_res     jsonb;
  v_attempt integer;
  v_n       integer;
BEGIN
  IF p_vehicle_id IS NULL THEN
    RETURN jsonb_build_object('vehicle_id', NULL, 'outcome', 'nothing_claimed');
  END IF;
  -- The claim's mark. Paper that arrives during the refresh re-queues the id (the trigger resets reason and attempts):
  -- the settle below then matches nothing and the row stays for another refresh.
  SELECT q.queued_at INTO v_mark FROM vehicle_class_price_recompute_queue q
   WHERE q.vehicle_id = p_vehicle_id AND q.reason = 'running';
  BEGIN
    -- Chunks of 50 members: the refresh checks its clock only between chunks (about 60 ms a member at worst, read
    -- 2026-11-21), so the classification loop overruns the budget by about 3 s at most; the reads around it do not stop.
    v_res := public.refresh_vehicle_class_price(p_vehicle_id, v_budget, 50);
    IF coalesce((v_res->>'complete')::boolean, false) THEN
      DELETE FROM vehicle_class_price_recompute_queue
       WHERE vehicle_id = p_vehicle_id AND reason = 'running' AND queued_at = v_mark;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_res := v_res || jsonb_build_object('outcome', 'complete', 'dequeued', v_n = 1);
    ELSE
      -- Unfinished cohort: progress, not a failure. Back in line with the attempt taken back.
      UPDATE vehicle_class_price_recompute_queue
         SET reason = 'incomplete', attempts = greatest(attempts - 1, 0), last_error = NULL
       WHERE vehicle_id = p_vehicle_id AND reason = 'running' AND queued_at = v_mark;
      v_res := v_res || jsonb_build_object('outcome', 'incomplete');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- query_canceled is not OTHERS: a cancel propagates, the statement rolls back, and the committed mark stays.
    UPDATE vehicle_class_price_recompute_queue
       SET reason = 'error', last_error = left(SQLERRM, 500)
     WHERE vehicle_id = p_vehicle_id AND reason = 'running' AND queued_at = v_mark
    RETURNING attempts INTO v_attempt;
    IF v_attempt >= 3 THEN
      RAISE WARNING 'class price refresh of % failed % times; next try in 24 h: %', p_vehicle_id, v_attempt, SQLERRM;
    END IF;
    v_res := jsonb_build_object('vehicle_id', p_vehicle_id, 'outcome', 'error', 'error', SQLERRM, 'attempts', v_attempt);
  END;
  RETURN v_res || jsonb_build_object('total_ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
END;
$function$;
COMMENT ON FUNCTION public.refresh_claimed_vehicle_class_price(uuid, integer) IS
  'Runs refresh_vehicle_class_price on an id claimed by claim_vehicle_class_price_queue_id (budget p_budget_ms, 1..30 s, '
  'members in chunks of 50) and settles the claim''s mark: complete dequeues, incomplete goes back with the attempt '
  'taken back, an error keeps the attempt with its message. A cancel rolls this back and leaves the committed mark. '
  'Settles nothing when the mark changed meanwhile (new paper) or was never made. Cron job drain-class-price-queue.';
REVOKE ALL ON FUNCTION public.refresh_claimed_vehicle_class_price(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_claimed_vehicle_class_price(uuid, integer) TO service_role;

-- 5. The by-hand drain: same signature, now through the claim and the claimed refresh -----------------------------------
CREATE OR REPLACE FUNCTION public.drain_vehicle_class_price_queue(p_batch_size integer DEFAULT 1, p_budget_ms integer DEFAULT 8000)
 RETURNS TABLE(processed integer, errored integer)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_t0     timestamptz := clock_timestamp();
  v_budget integer := least(greatest(coalesce(p_budget_ms, 8000), 0), 20000);
  v_batch  integer := least(greatest(coalesce(p_batch_size, 1), 1), 20);
  v_left   integer;
  v_id     uuid;
  v_seen   uuid[] := '{}';
  v_res    jsonb;
BEGIN
  processed := 0; errored := 0;
  -- One statement: the claims and refreshes commit or roll back together (the cron job commits each claim first).
  FOR i IN 1 .. v_batch LOOP
    v_left := v_budget - (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer;
    EXIT WHEN v_left < 1000;                 -- too little time to refresh anything: claim nothing
    v_id := public.claim_vehicle_class_price_queue_id(v_seen);
    EXIT WHEN v_id IS NULL;
    v_seen := v_seen || v_id;
    v_res := public.refresh_claimed_vehicle_class_price(v_id, v_left);
    IF v_res->>'outcome' = 'error' THEN errored := errored + 1; ELSE processed := processed + 1; END IF;
  END LOOP;
  RETURN NEXT;
END;
$function$;
COMMENT ON FUNCTION public.drain_vehicle_class_price_queue(integer, integer) IS
  'By-hand drain of vehicle_class_price_recompute_queue in one statement: up to p_batch_size ids (at most 20), each '
  'claimed by claim_vehicle_class_price_queue_id and refreshed by refresh_claimed_vehicle_class_price under what is left '
  'of p_budget_ms (at most 20 s; nothing is claimed with under 1 s left). Not scheduled: the cron job '
  'drain-class-price-queue runs the claim and the refresh as two statements with a COMMIT between.';
REVOKE ALL ON FUNCTION public.drain_vehicle_class_price_queue(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_vehicle_class_price_queue(integer, integer) TO service_role;

COMMENT ON TABLE public.vehicle_class_price_recompute_queue IS
  'Vehicles whose stored class price (vehicle_class_price) is due a refresh: enqueued by enqueue_vehicle_class_price_on_paper '
  '(receipts, work_sessions), by the daily top-up (top_up_vehicle_class_price_queue: stored rows older than 24 h) and by '
  'refreshes that came back incomplete. reason: receipt | work_session | stale | incomplete | error | running (claimed; '
  'a running row older than 5 minutes is a refresh that did not finish, with attempts and last_error kept). Drained by '
  'the cron job drain-class-price-queue (claim_vehicle_class_price_queue_id, COMMIT, '
  'refresh_claimed_vehicle_class_price). Written only by definers.';

-- 6. The job ----------------------------------------------------------------------------------------------------------------
-- One command string, as job 574 runs: each statement gets its own statement_timeout, and the COMMIT keeps the claim's
-- mark whatever happens to the refresh. app.writer names the job in v_job_health.declared_writer.
DO $cron$
BEGIN
  -- Nested, because a disposable contract database may have no cron schema.
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  EXECUTE $s$ SELECT cron.schedule('drain-class-price-queue', '1-59/2 * * * *', $c$SELECT set_config('app.writer', 'drain-class-price-queue', false); SET statement_timeout = '15s'; SET lock_timeout = '2s'; SELECT set_config('nuke.class_price_claim', coalesce(public.claim_vehicle_class_price_queue_id()::text, ''), false); COMMIT; SET statement_timeout = '55s'; SELECT public.refresh_claimed_vehicle_class_price(nullif(current_setting('nuke.class_price_claim'), '')::uuid, 20000);$c$) $s$;
END
$cron$;

NOTIFY pgrst, 'reload schema';
COMMIT;
