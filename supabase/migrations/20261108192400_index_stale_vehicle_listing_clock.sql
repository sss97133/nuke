-- cleanup_stale_listings times out selecting its bounded 50 vehicle rows:
-- the live plan scans idx_vehicles_requires_improvement and sorts (cost 255520).
-- Match the existing clock, predicate and ordering without changing eligibility.
-- CI runs migration files with plain psql (no transaction wrapper), under its
-- existing 120s ceiling. Concurrent construction preserves ingestion writes.
-- Do not wrap this file in BEGIN or raise the deployment statement timeout.
SET lock_timeout = '2s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_stale_listing_clock
  ON public.vehicles (COALESCE(listing_updated_at, listing_posted_at, updated_at) ASC NULLS FIRST)
  WHERE is_for_sale IS TRUE AND deleted_at IS NULL;

-- A failed concurrent build can leave an INVALID index. Never silently accept
-- one on replay; investigate and repair that index through a reviewed migration.
DO $verify$
DECLARE definition text;
BEGIN
 SELECT pg_get_indexdef(i.indexrelid) INTO definition
 FROM pg_index i
 WHERE i.indexrelid='public.idx_vehicles_stale_listing_clock'::regclass
   AND i.indrelid='public.vehicles'::regclass AND i.indisvalid AND i.indisready;
 IF definition IS DISTINCT FROM 'CREATE INDEX idx_vehicles_stale_listing_clock ON public.vehicles USING btree (COALESCE(listing_updated_at, listing_posted_at, updated_at) NULLS FIRST) WHERE ((is_for_sale IS TRUE) AND (deleted_at IS NULL))' THEN
   RAISE EXCEPTION 'Stale listing index invalid or definition differs; inspect before retry';
 END IF;
END $verify$;
