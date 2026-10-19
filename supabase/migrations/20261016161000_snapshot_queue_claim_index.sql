-- Index claim_extraction_batch's pick: WHERE platform = $1 AND status = 'pending' ORDER BY vehicle_id LIMIT n.
--
-- snapshot_extraction_queue (~494k rows, 117 MB) has only idx_seq_status_platform (status, platform), so each claim
-- reads every pending row for the platform and sorts it by vehicle_id before taking the batch. 2026-10-15 14:13Z: a
-- PostgREST claim_extraction_batch call had run 46 s in IO wait (batch-extract-snapshots, e.g. Barrett-Jackson job 418).
-- (platform, status, vehicle_id) lets the planner walk the index in order and stop at the LIMIT.
--
-- CREATE INDEX CONCURRENTLY (supabase-deploy applies files with plain psql -f, no transaction block); invalid leftover
-- dropped first; validity checked after. statement_timeout bounded, never 0.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_seq_platform_status_vehicle;
SET lock_timeout = '120s';
SET statement_timeout = '900s';

DROP INDEX CONCURRENTLY IF EXISTS public.idx_seq_platform_status_vehicle;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_seq_platform_status_vehicle
  ON public.snapshot_extraction_queue (platform, status, vehicle_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'public.idx_seq_platform_status_vehicle'::regclass AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'idx_seq_platform_status_vehicle is missing or invalid';
  END IF;
END $$;
