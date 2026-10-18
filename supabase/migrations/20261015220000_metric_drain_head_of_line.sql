-- Metric drain: a heavy vehicle can no longer hold the head of the queue.
--
-- MEASURED (prod, 2026-10-15 09:06 to 09:26Z, after #1493): drain-metric-a 11 of 20 runs failed, b 3 of 20, c 13 of 20, job 500 8 of 10, all
-- with a statement timeout. The oldest queue entries (queued 08:56Z, attempts 0) are vehicles with thousands of observations; a
-- capped count of the first read 400 rows with 400 heap fetches in 261 ms (visibility map 51.8 percent, PR for autovacuum thresholds
-- #1508). One such vehicle in a chunk outlasts the 10 s CALL, the CALL is cancelled, its rows return to the queue and the next run
-- starts on the same vehicles (ORDER BY queued_at).
--
-- WHAT (same writes, different order and bookkeeping).
--  1. claim_metric_queue_ids(min, max, limit): picks queue rows with attempts between min and max, ORDER BY attempts, queued_at
--     (fresh first), FOR UPDATE SKIP LOCKED, adds 1 to attempts and returns the ids. The chunked procedure commits that mark
--     before it does any work, so a cancelled CALL leaves it behind.
--  2. drain_vehicle_metric_queue_ids(ids): the #1493 drain over exactly those ids (a copy of drain_vehicle_metric_queue with the
--     claim replaced; a vehicle row another writer holds goes back with its claim mark returned).
--  3. drain_vehicle_metric_queue_chunked: loops claim(0,1,chunk), COMMIT, drain the ids, COMMIT. A vehicle whose run was cancelled
--     twice has attempts 2 and leaves the fast lane.
--  4. Cron job drain-metric-slow, every 5 minutes: claims one vehicle with attempts of 2 or more (lowest attempts first), commits the mark,
--     then drains it under statement_timeout 30 s (a multi-statement command with an explicit COMMIT between the mark and the work).
--     A vehicle that still times out keeps climbing in attempts and goes behind lighter ones.
--  5. drain_vehicle_metric_queue (job 500's controller) takes ORDER BY attempts, queued_at too.
-- Guarded by the md5 prefix of the body this was written against.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF (SELECT left(md5(prosrc), 16) FROM pg_proc WHERE oid = 'public.drain_vehicle_metric_queue(integer)'::regprocedure) IS DISTINCT FROM '1c687c8a1c39228c' THEN
    RAISE EXCEPTION 'drain_vehicle_metric_queue changed since this migration was written; re-read it';
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
        ORDER BY coalesce(attempts,0),queued_at,vehicle_id LIMIT p_batch_size FOR UPDATE SKIP LOCKED)
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

CREATE OR REPLACE FUNCTION public.drain_vehicle_metric_queue_ids(p_ids uuid[])
 RETURNS TABLE(processed integer, errored integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r record; n_processed integer := 0; n_errored integer := 0;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) > 1000 THEN
    RAISE EXCEPTION 'metric drain ids must be 0..1000 vehicles' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    WITH d AS (
      DELETE FROM public.vehicle_metric_recompute_queue
      WHERE vehicle_id IN (SELECT vehicle_id FROM public.vehicle_metric_recompute_queue
        WHERE vehicle_id = ANY (p_ids) ORDER BY vehicle_id FOR UPDATE SKIP LOCKED)
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
        VALUES (r.vehicle_id,r.live_metrics_dirty,r.observation_count_dirty,r.queued_at,greatest(coalesce(r.attempts,1)-1,0))  -- a held row gives its claim mark back
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

CREATE OR REPLACE FUNCTION public.claim_metric_queue_ids(p_min_attempts integer, p_max_attempts integer, p_limit integer)
RETURNS uuid[]
LANGUAGE sql
AS $$
  WITH c AS (
    SELECT vehicle_id FROM public.vehicle_metric_recompute_queue
    WHERE coalesce(attempts, 0) BETWEEN p_min_attempts AND p_max_attempts
    ORDER BY coalesce(attempts, 0), queued_at, vehicle_id
    LIMIT least(greatest(p_limit, 1), 50) FOR UPDATE SKIP LOCKED),
  u AS (
    UPDATE public.vehicle_metric_recompute_queue q SET attempts = coalesce(q.attempts, 0) + 1
    FROM c WHERE q.vehicle_id = c.vehicle_id RETURNING q.vehicle_id)
  SELECT coalesce(array_agg(vehicle_id), '{}'::uuid[]) FROM u
$$;

CREATE OR REPLACE PROCEDURE public.drain_vehicle_metric_queue_chunked(p_budget_seconds integer DEFAULT 7, p_chunk integer DEFAULT 10)
LANGUAGE plpgsql
AS $proc$
DECLARE
  v_until timestamptz := clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_budget_seconds, 7), 3), 8));
  v_chunk integer := least(greatest(coalesce(p_chunk, 10), 1), 50);
  v_ids uuid[];
  v_p integer;
  v_e integer;
  v_processed integer := 0;
  v_errored integer := 0;
BEGIN
  LOOP
    v_ids := public.claim_metric_queue_ids(0, 1, v_chunk);
    COMMIT;                                   -- the claim mark outlives a cancelled CALL
    EXIT WHEN coalesce(cardinality(v_ids), 0) = 0;
    PERFORM set_config('app.skip_completion_enqueue', '1', true);
    PERFORM set_config('lock_timeout', '2s', true);
    SELECT d.processed, d.errored INTO v_p, v_e FROM public.drain_vehicle_metric_queue_ids(v_ids) d;
    COMMIT;
    v_processed := v_processed + coalesce(v_p, 0);
    v_errored := v_errored + coalesce(v_e, 0);
    EXIT WHEN cardinality(v_ids) < v_chunk OR clock_timestamp() >= v_until;
  END LOOP;
  RAISE NOTICE 'drain_vehicle_metric_queue_chunked processed=% errored=%', v_processed, v_errored;
END
$proc$;

REVOKE ALL ON FUNCTION public.claim_metric_queue_ids(integer, integer, integer), public.drain_vehicle_metric_queue_ids(uuid[]) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'drain-metric-slow';
SELECT cron.schedule('drain-metric-slow', '*/5 * * * *',
  $job$SET statement_timeout = '30s'; SET lock_timeout = '2s'; SELECT set_config('app.skip_completion_enqueue', '1', false), set_config('nuke.slow_id', coalesce((public.claim_metric_queue_ids(2, 1000000, 1))[1]::text, ''), false); COMMIT; SELECT * FROM public.drain_vehicle_metric_queue_ids(CASE WHEN current_setting('nuke.slow_id') = '' THEN '{}'::uuid[] ELSE ARRAY[current_setting('nuke.slow_id')::uuid] END);$job$);

DO $verify$
BEGIN
  IF (SELECT left(md5(prosrc), 16) FROM pg_proc WHERE oid = 'public.drain_vehicle_metric_queue(integer)'::regprocedure) IS DISTINCT FROM 'ce5ff62dc2ca3811' THEN
    RAISE EXCEPTION 'drain_vehicle_metric_queue is not the body this migration wrote';
  END IF;
END
$verify$;

COMMIT;
