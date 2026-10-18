-- Isolated PostgreSQL 17 contract for 20261018120000_treemap_drop_v1_chain.sql. Synthetic rows only; never production.
-- Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_drop_v1 && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_drop_v1 -f supabase/sql/test_treemap_drop_v1_chain.sql
-- Builds the swapped chain with the swap contract (20261016190000), then: the drop refuses while a view outside the old
-- chain reads a _v1 view and drops nothing; without one it drops all seven _v1 views, leaves the live chain and its
-- refreshes untouched, and a second application changes nothing.
\set ON_ERROR_STOP on
\ir test_treemap_outcomes_venue_swap.sql

CREATE VIEW public.reads_old_fold AS SELECT count(*) AS n FROM public.mv_treemap_outcomes_v1;
\set ON_ERROR_STOP off
\ir ../migrations/20261018120000_treemap_drop_v1_chain.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('the drop refuses while a view outside the old chain reads a _v1 view, and drops nothing',
  (SELECT bool_and(to_regclass(format('public.%I', v || '_v1')) IS NOT NULL) FROM chain));
DROP VIEW public.reads_old_fold;

CREATE TEMP TABLE live_before AS SELECT v, format('public.%I', v)::regclass::oid AS oid FROM chain;
\ir ../migrations/20261018120000_treemap_drop_v1_chain.sql
\ir ../migrations/20261018120000_treemap_drop_v1_chain.sql

SELECT pg_temp.ok('every _v1 view is gone, the live chain keeps its objects',
  NOT EXISTS (SELECT 1 FROM pg_class WHERE relname LIKE 'mv\_%\_v1')
  AND (SELECT bool_and(format('public.%I', v)::regclass::oid = oid) FROM live_before));

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_treemap_outcomes;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales;
SELECT pg_temp.ok('the live chain still refreshes concurrently after the drop', true);
