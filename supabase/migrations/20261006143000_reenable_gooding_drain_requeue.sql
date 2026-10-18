-- Re-enable the Gooding drain (job 457) with the lander fix, and re-queue the lots that landed without an episode.
-- Ships in the same PR as the extract-gooding / extract-rmsothebys episode writer (_shared/vehicleEventWrite.ts):
-- update-then-insert by the partial unique key idx_vehicle_events_dedup, fill-only clocks, respect for
-- metadata.clock_locked_by_supersession, and no sold_at from a Gooding placeholder session.
-- Paused by 20261006134000_pause_gooding_drain.sql after 60 of 60 lots (12:10–13:00Z) landed a vehicle but no
-- vehicle_events row ("no unique or exclusion constraint matching the ON CONFLICT specification").
--
-- Order matters: CI applies migrations BEFORE it deploys the changed functions. So every pending Gooding row, re-queued
-- or not, is held 15 min (next_attempt_at) and no claim reaches the old extract-gooding; claim_import_queue_batch skips
-- rows whose next_attempt_at is in the future.
-- Re-queue scope: Gooding-source rows completed since 12:00Z whose vehicle has no gooding vehicle_events row. That is
-- 60 when paused at 13:00Z, plus any later run before the pause; the count is printed. A re-run resolves the same vehicle
-- (discovery_url exact) and writes its episode.
-- Bounded: ~60–70 re-queued rows and ~214 held rows, one statement each (import_queue is a queue, not testimony).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

WITH requeued AS (
  UPDATE public.import_queue iq
     SET status = 'pending', locked_at = NULL, locked_by = NULL, next_attempt_at = now() + interval '15 minutes'
   WHERE iq.source_id = 'ce74e304-d190-4041-9cce-cb950652b9c4'
     AND iq.status = 'complete'
     AND iq.processed_at >= '2026-10-06 12:00:00+00'
     AND iq.vehicle_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.vehicle_events ve
                      WHERE ve.vehicle_id = iq.vehicle_id AND ve.source_platform = 'gooding')
  RETURNING iq.id)
SELECT count(*) AS gooding_rows_requeued FROM requeued;

UPDATE public.import_queue
   SET next_attempt_at = now() + interval '15 minutes'
 WHERE source_id = 'ce74e304-d190-4041-9cce-cb950652b9c4' AND status = 'pending'
   AND (next_attempt_at IS NULL OR next_attempt_at < now() + interval '15 minutes');

SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname = 'process-import-queue-batch-2';
COMMIT;

-- Verify after the deploy (read-only):
--   select active from cron.job where jobname = 'process-import-queue-batch-2';                                  -- t
--   select status, count(*) from import_queue where source_id = 'ce74e304-d190-4041-9cce-cb950652b9c4'
--      and created_at > '2026-10-06' group by 1;                                                                 -- pending falls 10 per 10 min
--   select count(*) from vehicle_events where source_platform = 'gooding' and created_at > now() - interval '1 hour';  -- rises with complete
--   select count(*) from vehicle_events where source_platform = 'gooding' and created_at > '2026-10-06 14:00'
--      and metadata->>'sold_at_basis' = 'placeholder_session' and sold_at is not null;                            -- 0
-- Stop: if extract-gooding logs "vehicle_event not written", pause 457 again.
