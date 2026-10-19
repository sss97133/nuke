-- Index the intake dedupe lookup on auction_events: WHERE source = $1 AND source_url = ANY($2).
--
-- No index served it (idx_auction_events_vehicle_source_url leads with vehicle_id), so every check read the
-- source's share of the 395 MB heap. 2026-10-15 12:02Z (skylar-83): three such PostgREST lookups at 38 s each,
-- 13 of 23 active backends in IO, and the public Sold reader failing cold at 15.7 s / 5.1 s.
--
-- CREATE INDEX CONCURRENTLY: no lock that blocks reads or writes. supabase-deploy applies each file with plain
-- psql -f (no transaction block), so CONCURRENTLY is allowed. It waits for transactions older than itself, so
-- lock_timeout is generous; a failed run leaves an INVALID index, hence the DROP ... IF EXISTS first (a no-op on
-- the first apply). statement_timeout bounded, never 0.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_auction_events_source_source_url;
SET lock_timeout = '120s';
SET statement_timeout = '900s';

DROP INDEX CONCURRENTLY IF EXISTS public.idx_auction_events_source_source_url;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auction_events_source_source_url
  ON public.auction_events (source, source_url);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'public.idx_auction_events_source_source_url'::regclass AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'idx_auction_events_source_source_url is missing or invalid';
  END IF;
END $$;
