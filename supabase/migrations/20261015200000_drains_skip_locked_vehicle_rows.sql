-- drain_vehicle_metric_queue and drain_vehicle_completion_queue: skip a vehicle row another writer holds, in one lock order.
--
-- MEASURED (prod, 2026-10-15 08:00 to 08:10Z, before drain-metric-d/e/f): 7 of about 30 metric-drain runs and 3 of about 30
-- completion-drain runs failed with "canceling statement due to statement timeout" in the UPDATE of public.vehicles; the
-- Mecum landing writes the same table through PostgREST (7,246 lots in 20 minutes, one UPDATE vehicles at 22 s) and load
-- reached 41 active queries and 22 lock waits at about 08:04Z. A drain chunk waited on a vehicle row Mecum held, and the whole
-- CALL (10 s role timeout) ran out.
--
-- WHAT. Both drains now (1) take the chunk's rows from the queue in vehicle_id order, so every drain locks vehicles in the
-- same order, and (2) lock the vehicle row FOR UPDATE SKIP LOCKED instead of waiting: a row that is held is put back in the
-- queue unchanged (same flags, same queued_at, attempts not bumped) and is taken by a later run; a vehicle that does not
-- exist follows the old path. Nothing that was computed is computed differently: the same rows get the same writes, a
-- skipped vehicle is just done later. The controller (drain_vehicle_derived_queues) and the chunked procedures call these
-- functions as before, and the return columns are unchanged.
-- The chunked jobs drop to chunks of 5 and a 6 s budget, so one chunk cannot run a CALL past the 10 s timeout.
-- Guarded: each function is replaced only from the body it was written against (first 16 hex of md5(prosrc)).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF (SELECT left(md5(prosrc), 16) FROM pg_proc WHERE oid = 'public.drain_vehicle_metric_queue(integer)'::regprocedure) IS DISTINCT FROM 'dd9413ade8f826cd' THEN
    RAISE EXCEPTION 'drain_vehicle_metric_queue changed since this migration was written; re-read it';
  END IF;
  IF (SELECT left(md5(prosrc), 16) FROM pg_proc WHERE oid = 'public.drain_vehicle_completion_queue(integer)'::regprocedure) IS DISTINCT FROM '8703596c076bb44b' THEN
    RAISE EXCEPTION 'drain_vehicle_completion_queue changed since this migration was written; re-read it';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.drain_vehicle_metric_queue(p_batch_size integer DEFAULT 100)
 RETURNS TABLE(processed integer, errored integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r record; n_processed integer := 0; n_errored integer := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'metric drain batch size must be 1..1000' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    WITH d AS (
      DELETE FROM public.vehicle_metric_recompute_queue
      WHERE vehicle_id IN (SELECT vehicle_id FROM public.vehicle_metric_recompute_queue
        ORDER BY queued_at,vehicle_id LIMIT p_batch_size FOR UPDATE SKIP LOCKED)
      RETURNING vehicle_id,live_metrics_dirty,observation_count_dirty,attempts,queued_at)
    SELECT * FROM d ORDER BY vehicle_id   -- one lock order for every drain
  LOOP
    BEGIN
      -- Match the direct fold's parent-first lock order before derived writes. A vehicle row another writer holds
      -- is skipped, not waited on: it goes back to the queue unchanged and is taken on a later run.
      PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM public.vehicles WHERE id = r.vehicle_id) THEN
        INSERT INTO public.vehicle_metric_recompute_queue
          (vehicle_id,live_metrics_dirty,observation_count_dirty,queued_at,attempts)
        VALUES (r.vehicle_id,r.live_metrics_dirty,r.observation_count_dirty,r.queued_at,coalesce(r.attempts,0))
        ON CONFLICT (vehicle_id) DO UPDATE SET
          live_metrics_dirty = vehicle_metric_recompute_queue.live_metrics_dirty OR EXCLUDED.live_metrics_dirty,
          observation_count_dirty = vehicle_metric_recompute_queue.observation_count_dirty OR EXCLUDED.observation_count_dirty,
          queued_at = least(vehicle_metric_recompute_queue.queued_at,EXCLUDED.queued_at);
        CONTINUE;
      END IF;
      IF r.observation_count_dirty THEN
        UPDATE public.vehicles v SET observation_count = (
          SELECT count(*) FROM public.vehicle_observations o WHERE o.vehicle_id = r.vehicle_id)
        WHERE v.id = r.vehicle_id;
      END IF;
      IF r.live_metrics_dirty THEN
        INSERT INTO public.vehicle_live_metrics
          (vehicle_id,observation_count,comment_count,last_observation_at,updated_at)
        SELECT r.vehicle_id,count(*),count(*) FILTER (WHERE kind = 'comment'),max(observed_at),clock_timestamp()
        FROM public.vehicle_observations WHERE vehicle_id = r.vehicle_id
        ON CONFLICT (vehicle_id) DO UPDATE SET
          observation_count = EXCLUDED.observation_count,comment_count = EXCLUDED.comment_count,
          last_observation_at = EXCLUDED.last_observation_at,updated_at = EXCLUDED.updated_at;
        PERFORM public.detect_field_conflicts(r.vehicle_id);
      END IF;
      n_processed := n_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      n_errored := n_errored + 1;
      INSERT INTO public.vehicle_metric_recompute_queue
        (vehicle_id,live_metrics_dirty,observation_count_dirty,queued_at,attempts,last_error)
      VALUES (r.vehicle_id,r.live_metrics_dirty,r.observation_count_dirty,now(),coalesce(r.attempts,0)+1,SQLERRM)
      ON CONFLICT (vehicle_id) DO UPDATE SET
        live_metrics_dirty = vehicle_metric_recompute_queue.live_metrics_dirty OR EXCLUDED.live_metrics_dirty,
        observation_count_dirty = vehicle_metric_recompute_queue.observation_count_dirty OR EXCLUDED.observation_count_dirty,
        attempts = greatest(vehicle_metric_recompute_queue.attempts,EXCLUDED.attempts),
        last_error = EXCLUDED.last_error,queued_at = EXCLUDED.queued_at;
      -- Keep failures visible/retryable; never drop an unmaterialized fold.
      RAISE WARNING 'metric fold failed for vehicle %, attempt %: %',r.vehicle_id,coalesce(r.attempts,0)+1,SQLERRM;
    END;
  END LOOP;
  RETURN QUERY SELECT n_processed,n_errored;
END;
$function$;

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
    WITH d AS (
      DELETE FROM public.vehicle_completion_recompute_queue
      WHERE vehicle_id IN (
        SELECT vehicle_id
        FROM public.vehicle_completion_recompute_queue
        ORDER BY queued_at
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
      )
      RETURNING vehicle_id, attempts, queued_at)
    SELECT * FROM d ORDER BY vehicle_id   -- one lock order for every drain
  LOOP
    BEGIN
      -- A vehicle row another writer holds is skipped, not waited on: it goes back to the queue unchanged.
      PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM public.vehicles WHERE id = r.vehicle_id) THEN
        INSERT INTO public.vehicle_completion_recompute_queue (vehicle_id, queued_at, attempts)
        VALUES (r.vehicle_id, r.queued_at, coalesce(r.attempts, 0))
        ON CONFLICT (vehicle_id) DO UPDATE SET
          queued_at = least(public.vehicle_completion_recompute_queue.queued_at, EXCLUDED.queued_at);
        CONTINUE;
      END IF;
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

SELECT cron.alter_job(jobid, command := $job$CALL public.drain_vehicle_metric_queue_chunked(6, 5);$job$)
FROM cron.job WHERE jobname IN ('drain-metric-a','drain-metric-b','drain-metric-c','drain-metric-d','drain-metric-e','drain-metric-f');
SELECT cron.alter_job(jobid, command := $job$CALL public.drain_vehicle_completion_queue_chunked(6, 10);$job$)
FROM cron.job WHERE jobname IN ('drain-completion-a','drain-completion-b','drain-completion-c');

DO $verify$
BEGIN
  IF (SELECT left(md5(prosrc), 16) FROM pg_proc WHERE oid = 'public.drain_vehicle_metric_queue(integer)'::regprocedure) IS DISTINCT FROM '1c687c8a1c39228c'
     OR (SELECT left(md5(prosrc), 16) FROM pg_proc WHERE oid = 'public.drain_vehicle_completion_queue(integer)'::regprocedure) IS DISTINCT FROM '667550068e95efbf' THEN
    RAISE EXCEPTION 'drain functions are not the bodies this migration wrote';
  END IF;
END
$verify$;

COMMIT;
