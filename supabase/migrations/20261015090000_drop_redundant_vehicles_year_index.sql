-- Phase 1 of the public.vehicles index audit (2026-10-15): drop the one index that is strictly redundant.
-- public.vehicles carries 58 indexes (4,149 MB on a 2,414 MB heap); every insert maintains all of them.
-- Measured from pg_index and pg_get_indexdef on 2026-10-15: no exact duplicates exist, and exactly one btree index is a
-- leading prefix of another with the same (empty) predicate, is not unique and backs no constraint:
--   idx_vehicles_year (year), 75 MB, is the leading prefix of idx_vehicles_ymm (year, make, model), 103 MB; both valid.
-- A (year) lookup, range or sort is answered by idx_vehicles_ymm. It is kept; idx_vehicles_year is dropped.
-- Revert (rebuilds 75 MB; run outside a transaction):
--   CREATE INDEX CONCURRENTLY idx_vehicles_year ON public.vehicles USING btree (year);
-- DROP INDEX CONCURRENTLY cannot run inside a transaction block, so this file has none.
SET statement_timeout = '120s';
SET lock_timeout = '5s';
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_year;
