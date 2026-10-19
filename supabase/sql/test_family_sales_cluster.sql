-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_sales -f this-file.sql (from supabase/sql)
-- Contract for 20261016001000_family_sales_cluster.sql. Synthetic rows only; never production.
-- Runs the one-value reader's contract (the family-sales chain plus 1,504 synthetic 911 sales), records every family's
-- reading, applies the change twice, and requires the same readings, the family index marked as the clustering index,
-- and the 911's rows stored in index order.
\set ON_ERROR_STOP on
\ir test_family_sales_one_value.sql

-- Runs of one family in storage order: as many as families when each family's rows are contiguous.
CREATE FUNCTION pg_temp.family_runs() RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM (
    SELECT (brand, family_key) IS DISTINCT FROM lag((brand, family_key)) OVER (ORDER BY ctid) AS starts
    FROM public.mv_family_sales) s WHERE starts
$$;
SELECT pg_temp.ok('before the change the fold holds a family in more than one run (the appended 911 sales)',
  pg_temp.family_runs() > (SELECT count(DISTINCT (brand, family_key)) FROM public.mv_family_sales));

CREATE TEMP TABLE before_cluster AS
  SELECT brand, family_key, public.treemap_family_sales(brand, family_key) AS j
  FROM (SELECT DISTINCT brand, family_key FROM public.mv_family_sales) f;

\ir ../migrations/20261016001000_family_sales_cluster.sql
\ir ../migrations/20261016001000_family_sales_cluster.sql

SELECT pg_temp.ok('every family reads the same value after the change',
  (SELECT count(*) FROM before_cluster) > 3
  AND NOT EXISTS (SELECT 1 FROM before_cluster b WHERE b.j IS DISTINCT FROM public.treemap_family_sales(b.brand, b.family_key)));
SELECT pg_temp.ok('the family index is the fold''s clustering index',
  (SELECT indisclustered FROM pg_index WHERE indexrelid = 'public.mv_family_sales_family_date'::regclass));
SELECT pg_temp.ok('the fold stores each family''s rows as one run (as many runs as families)',
  pg_temp.family_runs() = (SELECT count(DISTINCT (brand, family_key)) FROM public.mv_family_sales));
