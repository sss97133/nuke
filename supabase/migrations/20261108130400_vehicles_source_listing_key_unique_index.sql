-- feat(vehicles): unique index on source_listing_key (additive, 3/3; replaces 20261108130200).
--
-- One live vehicle per platform-native listing key (the key is prefixed with its platform, so this is unique per
-- platform). Partial: only keyed, non-deleted rows, so the ~1.4M unkeyed vehicles cost nothing and a soft-deleted
-- duplicate frees its key. The known duplicate Hagerty listings do not block it: the backfill keyed only the earliest
-- row of each group (see source_listing_key_backfill_log, action skipped_duplicate).
--
-- Re-issued as 130400: the deploy applies only ADDED migration files, and the 130100 backfill failed mid-run, so 130200
-- never ran. 130200 is now a stub.
-- HOW. Autocommit on purpose (same as 20261023110000): CREATE INDEX CONCURRENTLY cannot run in a transaction.
-- Preflight refuses when another build runs on vehicles and drops an INVALID leftover; verify fails the deploy if the
-- index is not valid; a re-run drops the invalid one and builds again.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_source_listing_key_unique;
SET lock_timeout = '8s';
SET statement_timeout = '120s';
SET maintenance_work_mem = '256MB';
DO $preflight$
BEGIN
  IF EXISTS (SELECT FROM pg_stat_progress_create_index p WHERE p.relid = 'public.vehicles'::regclass) THEN
    RAISE EXCEPTION 'another index build is running on public.vehicles; retry when it finishes';
  END IF;
END
$preflight$;
DO $drop_invalid$
BEGIN
  IF EXISTS (SELECT FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicles_source_listing_key_unique') AND NOT indisvalid) THEN
    DROP INDEX public.idx_vehicles_source_listing_key_unique;
  END IF;
END
$drop_invalid$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_source_listing_key_unique
  ON public.vehicles (source_listing_key)
  WHERE source_listing_key IS NOT NULL AND deleted_at IS NULL;
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicles_source_listing_key_unique')
                 AND indisvalid AND indisready AND indislive) THEN
    RAISE EXCEPTION 'idx_vehicles_source_listing_key_unique is not valid after the build';
  END IF;
END
$verify$;
COMMENT ON INDEX public.idx_vehicles_source_listing_key_unique IS
'One live vehicle per platform-native listing key (vehicles.source_listing_key). Also serves the extractor lookup by key. Built CONCURRENTLY by 20261108130400.';
RESET maintenance_work_mem;
RESET statement_timeout;
RESET lock_timeout;
