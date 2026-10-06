-- Pause cron 457 (process-import-queue-batch-2, the Gooding-scoped drain enabled by 20261006123000) until the
-- vehicle_events writer is fixed.
--
-- Measured 2026-10-06 12:10–13:00Z (function_logs): all 60 Gooding lots the drain processed landed a vehicle but
-- failed the vehicle_events write with "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". The table's real key is the PARTIAL unique index idx_vehicle_events_dedup
-- (vehicle_id, source_platform, source_listing_id) WHERE source_listing_id IS NOT NULL, which PostgREST's
-- onConflict cannot target. The lander fix (update → insert → retry on 23505, shared helper) is PR #697; its
-- migration re-enables 457 and re-queues the 60 lots. Job 371 (sitemap, every 4 h) stays active: it only enqueues.
DO $do$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'process-import-queue-batch-2';
  IF v_id IS NULL THEN
    RAISE NOTICE 'process-import-queue-batch-2 not found; nothing paused';
  ELSE
    PERFORM cron.alter_job(job_id := v_id, active := false);
  END IF;
END
$do$;
