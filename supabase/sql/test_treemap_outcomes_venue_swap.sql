-- Isolated PostgreSQL 17 contract for 20261016190000_treemap_outcomes_venue_swap.sql. Synthetic rows only; never production.
-- Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_venue_swap && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_venue_swap -f supabase/sql/test_treemap_outcomes_venue_swap.sql
-- Builds and fills the copies with the beside contract (20261016153000), then: the swap refuses while a copy is unfilled
-- and changes nothing; once all are filled it gives the live names to the copies (indexes too) and <name>_v1 to the old
-- chain, keeps the grants, unschedules the fill job, leaves every live view refreshable concurrently, and a second
-- application changes nothing.
\set ON_ERROR_STOP on
\ir test_treemap_outcomes_venue_beside.sql

CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = $1 RETURNING true $$;

CREATE TEMP TABLE grants_before AS
SELECT v, (SELECT array_agg(a.grantee::regrole::text || ':' || a.privilege_type ORDER BY 1) FROM pg_class c, aclexplode(c.relacl) a
           WHERE c.oid = format('public.%I', v)::regclass AND a.grantee <> c.relowner) AS g
FROM chain;

-- Refused while a copy is unfilled: nothing renamed.
REFRESH MATERIALIZED VIEW public.mv_family_year_prices_v2 WITH NO DATA;
\set ON_ERROR_STOP off
\ir ../migrations/20261016190000_treemap_outcomes_venue_swap.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('the swap refuses while a copy is unfilled and renames nothing',
  to_regclass('public.mv_treemap_outcomes_v1') IS NULL AND to_regclass('public.mv_treemap_outcomes_v2') IS NOT NULL
  AND pg_get_viewdef('public.mv_treemap_outcomes'::regclass) NOT LIKE '%market_venue_label%');
SELECT pg_temp.ok('refilled', public.market_venue_v2_fill('2026-10-15 20:00:00+00') LIKE 'filled mv_family_year_prices_v2%');

CREATE TEMP TABLE copy_oids AS SELECT v, format('public.%I', v || '_v2')::regclass::oid AS oid FROM chain;
\ir ../migrations/20261016190000_treemap_outcomes_venue_swap.sql
CREATE TEMP TABLE after_first AS SELECT c.oid, c.relname FROM pg_class c WHERE c.relname LIKE 'mv\_%';
\ir ../migrations/20261016190000_treemap_outcomes_venue_swap.sql

SELECT pg_temp.ok('the copies hold the live names; the old chain is <name>_v1; no _v2 name remains',
  (SELECT bool_and(format('public.%I', v)::regclass::oid = oid) FROM copy_oids)
  AND (SELECT bool_and(to_regclass(format('public.%I', v || '_v1')) IS NOT NULL) FROM chain)
  AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname LIKE 'mv\_%\_v2'));

SELECT pg_temp.ok('the live fold names houses with market_venue_label and holds the gained houses',
  pg_get_viewdef('public.mv_treemap_outcomes'::regclass) LIKE '%market_venue_label%'
  AND (SELECT count(*) FROM public.mv_treemap_outcomes WHERE source_name IN ('Cars & Bids', 'Barrett-Jackson', 'RM Sotheby''s')) = 5
  AND (SELECT count(*) FROM public.mv_treemap_outcomes_v1 WHERE source_name IN ('Barrett-Jackson', 'RM Sotheby''s')) = 0);

SELECT pg_temp.ok('the live family fold reads the live fold and the live family market (the copies, renamed)',
  (SELECT count(*) FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
   WHERE r.ev_class = 'public.mv_family_sales'::regclass
     AND d.refobjid IN ('public.mv_treemap_outcomes'::regclass, 'public.mv_family_market'::regclass)) > 0
  AND (SELECT count(*) FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
   WHERE r.ev_class = 'public.mv_family_sales'::regclass
     AND d.refobjid IN ('public.mv_treemap_outcomes_v1'::regclass, 'public.mv_family_market_v1'::regclass)) = 0);

SELECT pg_temp.ok('index names follow: the live names on the live views, <index>_v1 on the old chain',
  (SELECT bool_and(i.indrelid = 'public.mv_treemap_outcomes'::regclass) FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
   WHERE ic.relname IN ('mv_treemap_outcomes_id', 'mv_treemap_outcomes_cell'))
  AND (SELECT bool_and(i.indrelid = 'public.mv_treemap_outcomes_v1'::regclass) FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
   WHERE ic.relname IN ('mv_treemap_outcomes_id_v1', 'mv_treemap_outcomes_cell_v1'))
  AND to_regclass('public.mv_family_sales_vehicle') IS NOT NULL AND to_regclass('public.mv_family_year_prices_key') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname LIKE '%\_v2'));

SELECT pg_temp.ok('the live names keep the grants they had',
  (SELECT bool_and(g IS NOT DISTINCT FROM (SELECT array_agg(a.grantee::regrole::text || ':' || a.privilege_type ORDER BY 1)
     FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = format('public.%I', v)::regclass AND a.grantee <> c.relowner))
   FROM grants_before));

SELECT pg_temp.ok('the fill job is unscheduled', NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'market-venue-v2-fill'));

SELECT pg_temp.ok('a second application changes nothing',
  NOT EXISTS (SELECT oid, relname FROM after_first EXCEPT SELECT c.oid, c.relname FROM pg_class c WHERE c.relname LIKE 'mv\_%')
  AND NOT EXISTS (SELECT c.oid, c.relname FROM pg_class c WHERE c.relname LIKE 'mv\_%' EXCEPT SELECT oid, relname FROM after_first));

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_treemap_outcomes;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_treemap_sale_brands;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_year_prices;
SELECT pg_temp.ok('the jobs'' refreshes run on the live names, concurrently', true);
