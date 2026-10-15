-- The map's fold chain with house labels goes live: the filled _v2 copies (20261016153000) take the live names.
--
-- One transaction, lock_timeout 5 s: a reader holding a view makes the swap fail and the deploy retry, rather than queue
-- visitors behind it. Each live view becomes <view>_v1 (its indexes <index>_v1) and each copy takes the live name (its
-- indexes the live index names). Jobs and readers name the views, so they read and refresh the new ones from their next
-- run: treemap_refresh_all (treemap-refresh, 09:10Z), refresh-family-market, refresh-family-sales, and
-- refresh_family_year_prices (refresh-family-year-prices), which resolves 'public.mv_family_year_prices' at run time.
-- The fill job (market-venue-v2-fill) is unscheduled. The _v1 views stay one day for a reverse rename, then a later
-- migration drops them.
-- Refuses unless: all seven copies are filled; each copied dependent's live definition is still the one it was copied
-- from (pg_get_viewdef of the live view, parents repointed, equals the copy's); the views reading the live fold are still
-- exactly the six. Applied twice, the second run finds the swap done and changes nothing.
-- Contract: supabase/sql/test_treemap_outcomes_venue_swap.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $swap$
DECLARE
  c_chain constant text[] := ARRAY['mv_treemap_outcomes', 'mv_treemap_sale_brands', 'mv_treemap_sale_models',
                                   'mv_brand_market', 'mv_family_market', 'mv_family_sales', 'mv_family_year_prices'];
  v text;
  ix record;
  v_unfilled text;
  v_drift text;
  v_chain text[];
BEGIN
  IF to_regclass('public.mv_treemap_outcomes_v1') IS NOT NULL
     AND pg_get_viewdef('public.mv_treemap_outcomes'::regclass) LIKE '%market_venue_label%' THEN
    RAISE NOTICE 'the chain is already swapped; nothing to do';
    RETURN;
  END IF;

  SELECT string_agg(v2, ', ') INTO v_unfilled
  FROM unnest(c_chain) v1, LATERAL (SELECT v1 || '_v2' AS v2) n
  WHERE to_regclass(format('public.%I', v2)) IS NULL
     OR NOT (SELECT relispopulated FROM pg_class WHERE oid = format('public.%I', v2)::regclass);
  IF v_unfilled IS NOT NULL THEN
    RAISE EXCEPTION 'not every copy is filled: %', v_unfilled;
  END IF;

  SELECT string_agg(v1, ', ') INTO v_drift
  FROM unnest(c_chain[2:]) v1
  WHERE regexp_replace(regexp_replace(pg_get_viewdef(format('public.%I', v1)::regclass),
          '\mmv_treemap_outcomes\M', 'mv_treemap_outcomes_v2', 'g'), '\mmv_family_market\M', 'mv_family_market_v2', 'g')
        IS DISTINCT FROM pg_get_viewdef(format('public.%I', v1 || '_v2')::regclass);
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'redefined since its copy was made: % (recopy before swapping)', v_drift;
  END IF;
  IF pg_get_viewdef('public.mv_treemap_outcomes_v2'::regclass) NOT LIKE '%market_venue_label%' THEN
    RAISE EXCEPTION 'mv_treemap_outcomes_v2 does not name houses with market_venue_label';
  END IF;

  WITH RECURSIVE dep(oid) AS (
    SELECT 'public.mv_treemap_outcomes'::regclass::oid
    UNION
    SELECT r.ev_class FROM dep d
    JOIN pg_depend pd ON pd.refobjid = d.oid AND pd.classid = 'pg_rewrite'::regclass
    JOIN pg_rewrite r ON r.oid = pd.objid
    WHERE r.ev_class <> d.oid
  )
  SELECT array_agg(c.relname::text ORDER BY c.relname) INTO v_chain
  FROM dep JOIN pg_class c ON c.oid = dep.oid
  WHERE c.oid <> 'public.mv_treemap_outcomes'::regclass;
  IF v_chain IS DISTINCT FROM ARRAY['mv_brand_market', 'mv_family_market', 'mv_family_sales', 'mv_family_year_prices',
                                     'mv_treemap_sale_brands', 'mv_treemap_sale_models'] THEN
    RAISE EXCEPTION 'the views reading mv_treemap_outcomes are %, not the six copied', v_chain;
  END IF;

  -- The live chain steps aside, indexes with it.
  FOREACH v IN ARRAY c_chain LOOP
    FOR ix IN SELECT ic.relname AS name FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
              WHERE i.indrelid = format('public.%I', v)::regclass LOOP
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', ix.name, ix.name || '_v1');
    END LOOP;
    EXECUTE format('ALTER MATERIALIZED VIEW public.%I RENAME TO %I', v, v || '_v1');
  END LOOP;
  -- The copies take the live names.
  FOREACH v IN ARRAY c_chain LOOP
    FOR ix IN SELECT ic.relname AS name FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
              WHERE i.indrelid = format('public.%I', v || '_v2')::regclass LOOP
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', ix.name, regexp_replace(ix.name, '_v2$', ''));
    END LOOP;
    EXECUTE format('ALTER MATERIALIZED VIEW public.%I RENAME TO %I', v || '_v2', v);
    EXECUTE format('COMMENT ON MATERIALIZED VIEW public.%I IS %L', v || '_v1',
      'Replaced by ' || v || ' (20261016190000, house labels); kept one day for a reverse rename.');
  END LOOP;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'market-venue-v2-fill';
END $swap$;

COMMIT;
