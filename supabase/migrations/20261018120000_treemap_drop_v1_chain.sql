-- The map's pre-swap fold chain (<view>_v1, kept one day by 20261016190000 for a reverse rename) is dropped.
--
-- Refuses unless the swap is in place (the live mv_treemap_outcomes names houses with market_venue_label) and nothing
-- outside the _v1 chain reads a _v1 view. No CASCADE: a dependent added since would fail the drop instead of going
-- with it. Dropped leaves first. Applied twice, the second run finds nothing to drop.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $drop$
DECLARE
  c_chain constant text[] := ARRAY['mv_brand_market_v1', 'mv_treemap_sale_brands_v1', 'mv_treemap_sale_models_v1',
                                   'mv_family_year_prices_v1', 'mv_family_sales_v1', 'mv_family_market_v1',
                                   'mv_treemap_outcomes_v1'];
  v text;
  v_outside text;
BEGIN
  IF pg_get_viewdef('public.mv_treemap_outcomes'::regclass) NOT LIKE '%market_venue_label%' THEN
    RAISE EXCEPTION 'mv_treemap_outcomes is not the house-labelled chain; the swap (20261016190000) is not in place';
  END IF;

  SELECT string_agg(DISTINCT format('%s <- %s', src.relname, dep.relname), ', ') INTO v_outside
  FROM pg_class src
  JOIN pg_depend pd ON pd.refobjid = src.oid AND pd.classid = 'pg_rewrite'::regclass
  JOIN pg_rewrite r ON r.oid = pd.objid
  JOIN pg_class dep ON dep.oid = r.ev_class
  WHERE src.relnamespace = 'public'::regnamespace
    AND src.relname = ANY (c_chain)
    AND dep.oid <> src.oid
    AND NOT (dep.relnamespace = 'public'::regnamespace AND dep.relname = ANY (c_chain));
  IF v_outside IS NOT NULL THEN
    RAISE EXCEPTION 'a _v1 view is still read from outside the old chain: %', v_outside;
  END IF;

  FOREACH v IN ARRAY c_chain LOOP
    EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I', v);
  END LOOP;
END $drop$;

COMMIT;
