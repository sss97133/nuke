-- Down for 20261108130000/130100/130200 (vehicles.source_listing_key). Run the data revert first (it is idempotent):
--   scripts/vehicles/revert_hagerty_listing_key_v1_20261102.sql
-- Order: index, key function users first, then column, function, log table. Run as a file with psql -f
-- (DROP INDEX CONCURRENTLY cannot run inside a transaction); the extractor change must be reverted first or it
-- selects/writes the dropped column.
SET lock_timeout = '8s';
SET statement_timeout = '60s';
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_source_listing_key_unique;
BEGIN;
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_source_listing_key_format;
ALTER TABLE public.vehicles DROP COLUMN IF EXISTS source_listing_key;
DROP FUNCTION IF EXISTS public.hagerty_listing_key(text);
DROP TABLE IF EXISTS public.source_listing_key_backfill_log;
COMMIT;
