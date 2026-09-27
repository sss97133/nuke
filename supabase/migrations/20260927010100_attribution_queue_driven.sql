-- Cron accountability, part 2 of 5 — image→vehicle attribution runs only when there is new work.
-- Session cb179857 / jobs-rebuild, 2026-09-27. Job: derive-vehicle-image-attribution (499; was 471).
--
-- WHAT WAS WRONG (measured 2026-09-27):
--  * The driver in derive_vehicle_image_attribution_batch() walked every active subject observation
--    (20,367 rows in image_observations) and probed vehicle_images (43,037,656 rows, 34.7 GB heap) for
--    each one, EVERY MINUTE, whether or not anything new had been observed. 165 ms on the Large box in
--    July (20260727190000); on the 411 MiB box the probes are random disk reads and the statement dies at
--    the 10 s statement_timeout: 227 failed / 19 ok in the 4 h before the pause, 408/408 on 09-25.
--  * Each promotion then UPDATEs vehicle_images.vehicle_id, which fires has_photos (old+new vehicle),
--    image_count, value recompute and primary-image sync — five vehicles updates, each through the
--    38-trigger vehicles chain. 500 promotions per batch never fit in one statement here.
--
-- DESIGN (the same shape as the vehicle_*_recompute_queue family, which is the established pattern):
--  1. A trigger on image_observations enqueues image_id into vehicle_image_attribution_queue whenever a
--     qualifying subject claim is inserted or changed (also when an active claim is deactivated, so the
--     image can be re-judged). image_observations is small; the trigger is one PK-conflict insert.
--  2. derive_vehicle_image_attribution_batch() drains that queue (DELETE … RETURNING, SKIP LOCKED) with
--     per-image exception handling, attempts/last_error, a 3-attempt drop, and a 40 s wall-clock budget
--     so its progress commits before the job's 55 s statement_timeout.
--  3. derive_vehicle_image_attribution_sweep() is the OLD full scan, but it only ENQUEUES what it finds
--     (bounded) — a nightly catch-all for anything that bypassed the trigger (merges that move
--     vehicle_images.vehicle_id, rows that predate the trigger). Run it once after the gate to backfill:
--     SELECT public.derive_vehicle_image_attribution_sweep(5000) until it returns 0.
--  Behaviour that is deliberately unchanged: derive_vehicle_image_attribution() itself — humans always
--  win, a machine claim never clobbers a human one, confidence >= 0.85 is still required.
--
-- SCHEMA_LAW pre-mint checklist (new table vehicle_image_attribution_queue):
--  1. §1 search (pg_class/pg_proc 2026-09-27): no queue keyed by image_id exists. ars_recompute_queue is
--     keyed by vehicle_id (dimension text); derivation_queue is the registry-routed edge-function reader
--     path with user_id NOT NULL and an extractor FK — wrong shape for a SQL projection. The four
--     vehicle_*_recompute_queue tables are the sibling family; this is the fifth, identical shape.
--  2. §2 not a fact class — a transient work queue; rows are deleted as they are drained.
--  3. §3 no testimony, no trust/DNA columns.
--  4. §4 storage: at most one row per image with a pending promotion; expected tens.
--  5. §5 invariant at the data layer: PK on image_id (one pending judgement per image).
--  6. §6 writers: the trigger and the sweep enqueue; the batch dequeues. Nothing else.
--  7. §7 migration file; RLS on, anon/authenticated revoked (operator data).
--
-- Jobs: 499 is re-pointed at the batch every 5 minutes (stays PAUSED); a nightly sweep job is created
-- PAUSED. Re-enable after the health gate — 499 first, it is what puts Skylar's photos on his truck pages.

CREATE TABLE IF NOT EXISTS public.vehicle_image_attribution_queue (
  image_id   uuid PRIMARY KEY,
  queued_at  timestamptz NOT NULL DEFAULT now(),
  attempts   smallint NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_vehicle_image_attribution_queue_queued_at
  ON public.vehicle_image_attribution_queue (queued_at);

ALTER TABLE public.vehicle_image_attribution_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_image_attribution_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_image_attribution_queue TO service_role;

COMMENT ON TABLE public.vehicle_image_attribution_queue IS
  'Images whose vehicle attribution needs (re)judging. Fed by trg_enqueue_vehicle_image_attribution on image_observations and by derive_vehicle_image_attribution_sweep(); drained by derive_vehicle_image_attribution_batch() (cron derive-vehicle-image-attribution). Sibling of vehicle_*_recompute_queue. 2026-09-27.';

-- 1. Enqueue on observation change ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_vehicle_image_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.role = 'subject'
     AND NEW.vehicle_id IS NOT NULL
     AND NEW.confidence >= 0.85
     AND (NEW.is_active OR (TG_OP = 'UPDATE' AND OLD.is_active)) THEN
    INSERT INTO public.vehicle_image_attribution_queue (image_id)
    VALUES (NEW.image_id)
    ON CONFLICT (image_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_enqueue_vehicle_image_attribution'
      AND tgrelid = 'public.image_observations'::regclass
  ) THEN
    CREATE TRIGGER trg_enqueue_vehicle_image_attribution
      AFTER INSERT OR UPDATE OF vehicle_id, confidence, is_active, role
      ON public.image_observations
      FOR EACH ROW EXECUTE FUNCTION public.enqueue_vehicle_image_attribution();
  END IF;
END
$do$;

-- 2. Queue-driven batch (same signature as before; cron 499 calls it) ------------------------------
CREATE OR REPLACE FUNCTION public.derive_vehicle_image_attribution_batch(p_limit integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  r          record;
  v_count    int := 0;
  v_blocked  int := 0;
  v_error    int := 0;
  v_deferred int := 0;
  v_deadline timestamptz := clock_timestamp() + interval '40 seconds';
BEGIN
  FOR r IN
    DELETE FROM public.vehicle_image_attribution_queue
    WHERE image_id IN (
      SELECT image_id FROM public.vehicle_image_attribution_queue
      ORDER BY queued_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING image_id, attempts
  LOOP
    -- Wall-clock budget: re-queue what we did not reach and return normally so progress commits.
    IF clock_timestamp() > v_deadline THEN
      INSERT INTO public.vehicle_image_attribution_queue (image_id, queued_at, attempts)
      VALUES (r.image_id, now(), r.attempts)
      ON CONFLICT (image_id) DO NOTHING;
      v_deferred := v_deferred + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.derive_vehicle_image_attribution(r.image_id);
      v_count := v_count + 1;
    EXCEPTION
      WHEN unique_violation THEN
        -- Target vehicle already holds this file_hash: a redundant copy on a duplicate vehicle record.
        -- Shop-cleaning work, not an attribution failure; do not retry.
        v_blocked := v_blocked + 1;
      WHEN query_canceled THEN
        RAISE;
      WHEN OTHERS THEN
        v_error := v_error + 1;
        IF r.attempts + 1 < 3 THEN
          INSERT INTO public.vehicle_image_attribution_queue (image_id, queued_at, attempts, last_error)
          VALUES (r.image_id, now(), r.attempts + 1, left(SQLERRM, 500))
          ON CONFLICT (image_id) DO UPDATE SET
            attempts   = EXCLUDED.attempts,
            last_error = EXCLUDED.last_error,
            queued_at  = EXCLUDED.queued_at;
        ELSE
          RAISE WARNING 'attribution dropped after 3 attempts: image % (%)', r.image_id, SQLERRM;
        END IF;
    END;
  END LOOP;

  IF v_blocked > 0 OR v_error > 0 OR v_deferred > 0 THEN
    RAISE NOTICE 'attribution batch: promoted=% blocked_duplicate=% error=% deferred=%',
      v_count, v_blocked, v_error, v_deferred;
  END IF;

  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.derive_vehicle_image_attribution_batch(integer) IS
  'Drains vehicle_image_attribution_queue: promotes each queued image via derive_vehicle_image_attribution() with per-image retries (3) and a 40 s wall-clock budget. Cron derive-vehicle-image-attribution, every 5 min. Queue-driven since 2026-09-27; the full scan lives in _sweep().';

-- 3. Nightly sweep: the old scan, enqueue-only, bounded --------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_vehicle_image_attribution_sweep(p_limit integer DEFAULT 2000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_n int;
BEGIN
  INSERT INTO public.vehicle_image_attribution_queue (image_id)
  SELECT s.image_id
  FROM (
    SELECT DISTINCT io.image_id
    FROM public.image_observations io
    LEFT JOIN public.vehicle_images vi ON vi.id = io.image_id
    WHERE io.is_active = true
      AND io.role = 'subject'
      AND io.confidence >= 0.85
      AND io.vehicle_id IS NOT NULL
      AND (vi.vehicle_id IS NULL OR vi.vehicle_id IS DISTINCT FROM io.vehicle_id)
      -- No observed_at window on purpose (20260727190000, bug 1): a window orphans what an outage missed.
    ORDER BY io.image_id
    LIMIT p_limit
  ) s
  ON CONFLICT (image_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.derive_vehicle_image_attribution_sweep(integer) IS
  'Catch-all: scans image_observations for subject claims whose image sits on another vehicle and ENQUEUES them (bounded). Nightly cron derive-vehicle-image-attribution-sweep; also the one-time backfill after 2026-09-27.';

REVOKE ALL ON FUNCTION public.derive_vehicle_image_attribution_sweep(integer) FROM PUBLIC, anon, authenticated;

-- 4. Jobs (both stay PAUSED until the health gate) --------------------------------------------------
DO $do$
DECLARE
  v_id bigint;
  v_batch_cmd text := $cmd$SET statement_timeout = '55s'; SELECT public.derive_vehicle_image_attribution_batch(100);$cmd$;
  v_sweep_cmd text := $cmd$SET statement_timeout = '120s'; SELECT public.derive_vehicle_image_attribution_sweep(2000);$cmd$;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'derive-vehicle-image-attribution';
  IF v_id IS NULL THEN
    v_id := cron.schedule('derive-vehicle-image-attribution', '*/5 * * * *', v_batch_cmd);
    PERFORM cron.alter_job(job_id := v_id, active := false);
  ELSE
    PERFORM cron.alter_job(job_id := v_id, schedule := '*/5 * * * *', command := v_batch_cmd);
  END IF;

  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'derive-vehicle-image-attribution-sweep';
  IF v_id IS NULL THEN
    v_id := cron.schedule('derive-vehicle-image-attribution-sweep', '20 3 * * *', v_sweep_cmd);
    PERFORM cron.alter_job(job_id := v_id, active := false);
  ELSE
    PERFORM cron.alter_job(job_id := v_id, schedule := '20 3 * * *', command := v_sweep_cmd);
  END IF;
END
$do$;
