-- vehicles: partial indexes on the public, priced, dated rows by make and model, so get_model_price_history
-- reads the cohort's sales instead of every row of the model.
--
-- get_model_price_history(make, model, limit, year_min, year_max) draws the cohort chart on every vehicle profile
-- (PriceHistoryChart asks for +/- 3 years, 300 rows). pg_stat_statements since 2026-09-29: anon 512 calls, mean 810 ms,
-- max 8,735 ms. It is SECURITY DEFINER, so it already reads through indexes; the cost is the heap. The model arms
-- (lower(model) = m OR lower(normalized_model) = m) and the year window are index conditions, but is_public,
-- sale_price > 0, sale_date IS NOT NULL and deleted_at IS NULL are only filters on the heap row, so the bitmap scan
-- reads every row of the make and model in those years and keeps the few that were sold and dated.
-- Ford Mustang 1963-1969, 2026-10-14: the scan reads 16,583 heap blocks for 15,612 rows to return 2,013
-- (cold 4,644 ms with 16,800 buffers read; warm 254 ms). The same rows restricted to the partial predicate below are
-- 2,026 rows in 2,019 heap blocks (counted on production, read only). Other cohorts, cold then warm:
-- Porsche 911 1984-1990 636 -> 143 ms, Chevrolet C10 1969-1975 2,012 -> 84 ms, Chevrolet Blazer 1974-1980 47 -> 18 ms.
--
-- After: two partial indexes with the function's own predicate, one per model arm. No function change: the same
-- statement now finds the rows from the index alone. Local rehearsal on PG17 with 600,000 synthetic vehicles of the same
-- shape (68% public, 30% priced, skewed makes and models): the plan moves from a BitmapAnd of idx_vehicles_year with the
-- two model indexes (3,115 heap blocks, 3,592 rows filtered away) to a BitmapOr of the two new indexes (230 heap blocks,
-- 138 rows filtered away); with the year bounds unknown (a generic plan) it still uses them, with 2,035 blocks.
-- Expected on production for the Mustang window: about 2,000 heap blocks instead of 16,600, so cold about 0.6 s instead of
-- 4.6 s and warm about 40 ms instead of 254 ms. Re-measure after the build.
--
-- Cost: each index holds the 208,617 of 1,014,364 vehicles that are public, undeleted, priced and dated (2026-10-14);
-- at about 40 bytes an entry that is an estimated 8-10 MB each (not measured). Writes to rows outside that set do not
-- touch them.
-- Build: CONCURRENTLY, so writers keep writing; the heap is 11 GB, so each build is one sequential pass. lock_timeout
-- covers the wait for older snapshots. This file is not wrapped in a transaction (CONCURRENTLY cannot be).
SET statement_timeout = '900s';
SET lock_timeout = '180s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_priced_sales_make_model
  ON public.vehicles (lower(make), lower(model), year)
  WHERE is_public AND deleted_at IS NULL AND sale_price > 0 AND sale_date IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_priced_sales_make_normalized_model
  ON public.vehicles (lower(make), lower(normalized_model), year)
  WHERE is_public AND deleted_at IS NULL AND sale_price > 0 AND sale_date IS NOT NULL;

-- An interrupted concurrent build leaves an INVALID index that IF NOT EXISTS would then skip.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indexrelid IN ('public.idx_vehicles_priced_sales_make_model'::regclass,
                           'public.idx_vehicles_priced_sales_make_normalized_model'::regclass)
      AND NOT i.indisvalid
  LOOP
    RAISE EXCEPTION '% is INVALID; DROP INDEX CONCURRENTLY public.% and re-run', r.relname, r.relname;
  END LOOP;
END $$;

-- Live verification (after apply), as anon through PostgREST:
--   POST /rest/v1/rpc/get_model_price_history {"p_make":"Ford","p_model":"Mustang","p_limit":300,"p_year_min":1963,"p_year_max":1969}
--     -- 300 rows (the Mustang window holds 2,013 sales), cold under 1 s, warm under 100 ms (before: 4.6 s cold, 254 ms warm)
--   scripts/data/q.sh "select indexrelid::regclass, indisvalid from pg_index where indexrelid::regclass::text like 'idx_vehicles_priced_sales%'"  -- both valid
