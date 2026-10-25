-- STAGED, NOT APPLIED: needs Skylar's OK (index build on vehicles: 1.35M rows, 2.4 GB heap; too long for the 55 s limit).
-- Pairs with migration 20261028121100_comps_id_prefilter (get_comps_scored comp_ids pre-filter).
-- Covering index so comp_ids is an index-only scan (vehicles ~85% all-visible); heap is read only for matching ids.
-- Proxy test with idx_vehicles_public_cohort_probe (same shape, partial): Ford 1961-71 Mustang auction part 11.6 s -> 0.88 s.
-- Run with psql -f (autocommit; CONCURRENTLY cannot run inside a transaction). Does not block writers.
SET statement_timeout = '30min';
SET lock_timeout = '10min';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_comp_probe
  ON public.vehicles (lower(make), year) INCLUDE (id, make, model, listing_kind);
-- Check after: SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_vehicles_comp_probe'::regclass;
-- If invalid (failed build): DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_comp_probe; then rerun.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_comp_probe;
