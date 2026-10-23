-- idx_vehicles_lower_make_year: btree on public.vehicles (lower(make), year) for get_comps_scored.
--
-- WHY. get_comps_scored filters lower(v.make) = lower(p_make) AND v.year BETWEEN ..; idx_vehicles_make_year on (make, year)
-- cannot serve lower(make), so each comps call scans vehicles (1.33M rows, 2.4 GB) and times out under load.
--
-- HOW. Autocommit on purpose: the deploy applies this file with psql -f, one statement at a time, and CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction. The session SETs below govern the build (statement_timeout stays at
-- the 120 s Hard Rule #12 ceiling). Preflight drops an INVALID leftover from an earlier canceled build and refuses when
-- another index build is running on vehicles. IF NOT EXISTS makes a pre-built valid index a no-op. Verify fails the
-- deploy if the index is not valid; a re-run of this file then drops the invalid one and builds again.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_lower_make_year;
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
  -- An invalid index holds no reads; a plain DROP takes the lock briefly (bounded by lock_timeout above).
  IF EXISTS (SELECT FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicles_lower_make_year') AND NOT indisvalid) THEN
    DROP INDEX public.idx_vehicles_lower_make_year;
  END IF;
END
$drop_invalid$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_lower_make_year ON public.vehicles (lower(make), year);
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicles_lower_make_year')
                 AND indisvalid AND indisready AND indislive) THEN
    RAISE EXCEPTION 'idx_vehicles_lower_make_year is not valid after the build';
  END IF;
END
$verify$;
COMMENT ON INDEX public.idx_vehicles_lower_make_year IS
'btree on vehicles (lower(make), year): serves get_comps_scored''s lower(make) = lower(p_make) AND year BETWEEN filter. Built CONCURRENTLY by 20261023110000.';
RESET maintenance_work_mem;
RESET statement_timeout;
RESET lock_timeout;
