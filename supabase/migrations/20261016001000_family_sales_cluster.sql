-- mv_family_sales: store each family's sales together, so a family's sales chart reads its own pages.
--
-- MEASURED 2026-10-15 08:03Z, logged out: treemap_family_sales for the 911 (10,703 sales in five years, one jsonb since
-- 20261015234500) took 3.47 s cold and 0.41 s warm. The fold (29 MB, 212,723 rows on 08:08Z) is stored in the order
-- its query produced, so the family's rows sit across most of its ~3,700 pages and a cold read fetches nearly all of
-- them (11,267 buffer visits for the 911).
--
-- CHANGE: CLUSTER the fold on its (brand, family_key, sale_date DESC) index: each family's rows become contiguous
-- (about 190 pages for the 911) and the index is marked as the fold's clustering index. The daily refresh is
-- CONCURRENTLY (unique index on vehicle_id), which keeps unchanged rows in place and appends the day's new sales, so
-- the order holds with slow drift. No data or definition changes. Takes an exclusive lock on the fold for the rewrite
-- (seconds); readers wait behind lock_timeout. Contract: supabase/sql/test_family_sales_cluster.sql.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.mv_family_sales_family_date') IS NULL THEN
    RAISE EXCEPTION 'mv_family_sales_family_date is missing; apply 20261015213000_family_sales_fold.sql first';
  END IF;
END $guard$;

CLUSTER public.mv_family_sales USING mv_family_sales_family_date;
ANALYZE public.mv_family_sales;

COMMIT;
