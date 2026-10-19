-- extract-bonhams deep_lots reads its queue as: Bonhams episodes landed by the Typesense lander whose lot page has not been read
-- (metadata->>'deep_at' IS NULL), newest sale first. With only idx_vehicle_events_platform to use, that read fetched and detoasted all
-- ~36k Bonhams rows to keep 20 (24 s measured 2026-10-18 02:45Z) and the deep_lots run after the #1890/#1896 deploy failed with
-- "canceling statement due to statement timeout". This partial index holds only the queue (~32k rows, shrinking as lots are read)
-- in the order the read wants.
-- No BEGIN: CREATE INDEX CONCURRENTLY cannot run in a transaction block, and it does not block the lanes writing vehicle_events.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_events_bonhams_deep_queue;
SET statement_timeout = '300s';
SET lock_timeout = '10s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_events_bonhams_deep_queue
  ON public.vehicle_events (ended_at DESC NULLS LAST)
  WHERE source_platform = 'bonhams' AND extraction_source = 'bonhams-typesense' AND (metadata ->> 'deep_at') IS NULL;
