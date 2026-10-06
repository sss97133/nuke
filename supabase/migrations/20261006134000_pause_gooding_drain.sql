-- Pause the Gooding drain (job 457, process-import-queue-batch-2) until the lander writes episodes.
-- Re-enabled 2026-10-06 by 20261006123000_enable_gooding_intake.sql (PR #681).
-- Measured 12:10–13:00Z: 60 of 60 lots landed with a vehicle but no vehicle_events episode. function_logs shows 60 of
-- "[gooding] Failed to upsert vehicle_event: there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". extract-gooding upserts with onConflict 'source_platform,source_listing_id'. The listing key is the
-- PARTIAL unique index idx_vehicle_events_dedup (vehicle_id, source_platform, source_listing_id)
-- WHERE source_listing_id IS NOT NULL, which no PostgREST onConflict can target.
-- The re-enable ships with the lander fix (PR #697, update-then-insert by the key), with the 60 landed URLs re-queued.
-- Job 371 (sitemap enqueue) stays on: it only adds pending rows.
SET statement_timeout = '30s';
SET lock_timeout = '5s';
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'process-import-queue-batch-2';
RESET lock_timeout;
RESET statement_timeout;
-- Verify: select active from cron.job where jobname = 'process-import-queue-batch-2';   -- f
