-- vehicles: a covering partial index for cohort lookups by make and model year over public vehicles.
--
-- A cohort (the comparable sales of a vehicle's make, model year and model) is found by make (lower(make)), a year or
-- year range, and a model match (lower(model) = a name, or lower(model) ~ a word regex). Neither the make nor the year
-- index can carry the model test, so every plan reads the heap row of every public vehicle of that make and years, then
-- tests the model there. Measured 2026-10-14 as the deploy role (the definer readers' access path), K5 Blazer scope,
-- Chevrolet 1976-1980: 4,620 heap blocks, 3,468 read from disk, to return 275 members; as anon the same scan, under the row
-- policies, read 44,390 heap blocks (24,960 from disk). Ford 1966 Mustang cohort scan, the same way: 1,352 buffers, 703 read.
-- popup_vehicle_intel and valuation_by_ymm both start with this lookup.
--
-- After: an index on (lower(make), year) that INCLUDEs id, make, model and listing_kind and holds only public, undeleted
-- vehicles (the rule every cohort reader states), so the cohort query is an index-only scan: the make and year range are the
-- index condition, the model test and the listing_kind test run on the index entry, and the heap is touched only for pages
-- the visibility map does not mark all-visible (81.3% of the table's pages are, 2026-10-14). `make` is INCLUDEd because the
-- planner will not run an index-only scan over lower(make) without the column it is computed from.
-- Rehearsed on PG17 with 600,000 synthetic vehicles: the Ford 1963-1969 regex cohort (1,920 rows of 9,298 entries) took
-- 85 buffers and 0 heap fetches instead of 6,238 buffers with a bitmap heap scan.
--
-- Cost: one entry per public, undeleted vehicle (about 689,000 of 1,014,364 on 2026-10-14) at roughly 75 bytes, an
-- estimated 50-60 MB (not measured). `vehicles` has about 60 indexes and 3% of its updates are HOT, so most updates already
-- write every index; this adds one more entry to those for public rows.
-- Build: CONCURRENTLY, so writers keep writing; the heap is 2.4 GB (11 GB with indexes and TOAST), one sequential pass.
-- lock_timeout covers the wait for older snapshots. This file is not wrapped in a transaction (CONCURRENTLY cannot be).
-- Contract: supabase/sql/test_vehicles_public_cohort_probe_index.sql (CI job vehicles-public-cohort-index-contract).
SET statement_timeout = '900s';
SET lock_timeout = '180s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_public_cohort_probe
  ON public.vehicles (lower(make), year)
  INCLUDE (id, make, model, listing_kind)
  WHERE is_public AND deleted_at IS NULL;

-- An interrupted concurrent build leaves an INVALID index that IF NOT EXISTS would then skip.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'public.idx_vehicles_public_cohort_probe'::regclass AND NOT i.indisvalid
  ) THEN
    RAISE EXCEPTION 'idx_vehicles_public_cohort_probe is INVALID; DROP INDEX CONCURRENTLY public.idx_vehicles_public_cohort_probe and re-run';
  END IF;
END $$;

-- Live verification (after apply):
--   scripts/data/q.sh "select indexrelid::regclass, indisvalid, pg_size_pretty(pg_relation_size(indexrelid)) from pg_index where indexrelid = 'public.idx_vehicles_public_cohort_probe'::regclass"
--   scripts/data/q.sh "explain (analyze, buffers) select v.id from vehicles v where lower(v.make)='chevrolet' and v.year between 1976 and 1980 and lower(v.model) ~ E'\\\\y(blazer|k5)\\\\y' and v.listing_kind is distinct from 'non_vehicle_item' and v.is_public and v.deleted_at is null"
--     -- Index Only Scan using idx_vehicles_public_cohort_probe; compare "Heap Fetches" with the 275 members
