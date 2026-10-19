-- Re-issue of 20261018223000_vehicle_events_bonhams_deep_queue_idx. Its CREATE INDEX CONCURRENTLY failed on apply (supabase-deploy
-- 39091469585, 2026-10-18 02:51Z, "canceling statement due to lock timeout"): a concurrent build waits for every older transaction
-- on vehicle_events to end, and the 10 s lock_timeout was shorter than the 30-40 s transactions the lanes were running. It left
-- idx_vehicle_events_bonhams_deep_queue INVALID (maintained on every write, never used), so IF NOT EXISTS would keep the broken one.
-- Drop it and build again with lock_timeout 120 s (as 20261016180000_drop_redundant_hot_table_indexes.sql does for these tables).
-- No BEGIN: CONCURRENTLY cannot run in a transaction block, and neither statement blocks the lanes writing vehicle_events.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_events_bonhams_deep_queue;
SET statement_timeout = '300s';
SET lock_timeout = '120s';
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_events_bonhams_deep_queue;
CREATE INDEX CONCURRENTLY idx_vehicle_events_bonhams_deep_queue
  ON public.vehicle_events (ended_at DESC NULLS LAST)
  WHERE source_platform = 'bonhams' AND extraction_source = 'bonhams-typesense' AND (metadata ->> 'deep_at') IS NULL;
