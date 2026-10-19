-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_sales -f this-file.sql (from supabase/sql)
-- Contract for 20261016003000_treemap_refresh_split.sql. Synthetic rows only; never production.
-- Runs the family-sales chain (fold, one-value reader, cluster), applies the change twice, and requires: the map's refresh
-- keeps its views through mv_brand_market and no longer refreshes the two family folds; it notes each view's seconds; and
-- each family fold has its own daily job, after the map's, under the same 20 min limit, scheduled once.
\set ON_ERROR_STOP on
\ir test_family_sales_cluster.sql

\ir ../migrations/20261016003000_treemap_refresh_split.sql
\ir ../migrations/20261016003000_treemap_refresh_split.sql

CREATE TEMP TABLE refresh_src AS SELECT prosrc AS s FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure;
SELECT pg_temp.ok('the map''s refresh keeps its views through mv_brand_market',
  (SELECT s LIKE '%''mv_treemap_by_brand''%' AND s LIKE '%''mv_treemap_outcomes''%' AND s LIKE '%''mv_treemap_sale_brands''%'
     AND s LIKE '%''mv_brand_market''%' FROM refresh_src));
SELECT pg_temp.ok('the map''s refresh no longer refreshes the family folds',
  (SELECT s NOT LIKE '%''mv_family_market''%' AND s NOT LIKE '%''mv_family_sales''%' FROM refresh_src));
SELECT pg_temp.ok('the map''s refresh notes each view''s seconds',
  (SELECT s LIKE '%timings := timings || format(%' AND s LIKE '%array_to_string(timings%' FROM refresh_src));
SELECT pg_temp.ok('each family fold has its own job after the map''s 09:10 and the year-price fold''s 09:40, under a 20 min limit, scheduled once',
  (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-family-market' AND schedule = '50 9 * * *'
     AND command LIKE '%statement_timeout = ''20min''%' AND command LIKE '%REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market') = 1
  AND (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-family-sales' AND schedule = '10 10 * * *'
     AND command LIKE '%statement_timeout = ''20min''%' AND command LIKE '%REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales') = 1);
