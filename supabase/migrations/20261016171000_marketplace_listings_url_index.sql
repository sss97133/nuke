-- Index marketplace_listings.url for the ingest lookup "WHERE url = $1 AND vehicle_id IS NOT NULL".
--
-- No index covers url, so each lookup read the 352 MB table (~115k rows): pg_stat_statements since the 03:00Z restart
-- on 2026-10-15 shows 1,462 calls at 841 ms mean and the most shared blocks read of any statement (5.1M).
--
-- CREATE INDEX CONCURRENTLY (supabase-deploy applies files with plain psql -f); invalid leftover dropped first;
-- validity checked after; statement_timeout bounded, never 0.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_marketplace_listings_url;
SET lock_timeout = '120s';
SET statement_timeout = '900s';

DROP INDEX CONCURRENTLY IF EXISTS public.idx_marketplace_listings_url;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marketplace_listings_url
  ON public.marketplace_listings (url);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'public.idx_marketplace_listings_url'::regclass AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'idx_marketplace_listings_url is missing or invalid';
  END IF;
END $$;
