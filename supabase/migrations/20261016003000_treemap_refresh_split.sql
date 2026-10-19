-- The map's daily refresh: the model-family folds refresh on jobs of their own.
--
-- MEASURED 2026-10-15: treemap_refresh_all runs as one statement and one transaction under the job's 20 min limit. At
-- 09:10Z it took 875.9 s for 16 views (12 concurrently, 4 plainly); on 10-14 it took 221.3 s for 10 (treemap_refreshes).
-- Six views joined in between. A run past 20 min rolls every view back and leaves the map a day old. The names fold
-- already refreshes on its own job (refresh-model-family-names, 04:05Z).
--
-- CHANGE: treemap_refresh_all keeps the map's views (mv_brand_market and everything before it) and notes each view's
-- seconds in treemap_refreshes.note, so the next slow view has a name. mv_family_market refreshes on refresh-family-market
-- (09:50Z) and mv_family_sales, which reads the market's family keys, on refresh-family-sales (10:10Z): each its own
-- statement and transaction under the same 20 min limit, so a slow family fold cannot cost the map its day. Both run after
-- the map's job (09:10Z) and refresh-family-year-prices (09:40Z, 300 s), which reads none of them, so the folds do not
-- compete for the disk. The map's
-- clock (the latest treemap_refreshes row) is still written only by treemap_refresh_all. Guarded on the live hash.
-- Contract: supabase/sql/test_treemap_refresh_split.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure;
  IF v IS DISTINCT FROM '8tEg32zRz6B27wPeSoDklEwQcNrLpIgGjTzvf481dfY=' AND v IS DISTINCT FROM '4lJIpCvAKao8mEmX1ht+7kVHJffUwprkmaNXMcFr/Wg=' THEN
    RAISE EXCEPTION 'treemap_refresh_all is not the 20261015213000 definition this was written from (sha256 %)', v;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.treemap_refresh_all()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  t0 timestamptz := clock_timestamp();
  v text;
  concurrent boolean;
  n_conc int := 0;
  n_plain int := 0;
  t_view timestamptz;
  timings text[] := '{}';
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'mv_treemap_by_source', 'mv_treemap_by_brand', 'mv_treemap_by_segment',
    'mv_treemap_makes_by_source', 'mv_treemap_makes_by_segment', 'mv_treemap_models_by_brand',
    'mv_treemap_models_by_source_make', 'mv_treemap_years', 'mv_treemap_nested_segment', 'mv_treemap_nested_brand',
    -- the confirmed-sale map (20261014063000): the fold before its two aggregates
    'mv_treemap_outcomes', 'mv_treemap_sale_brands', 'mv_treemap_sale_models',
    -- what a brand's market is (20261015060000): reads mv_treemap_outcomes, so it refreshes after it
    'mv_brand_market'
    -- mv_family_market and mv_family_sales refresh on jobs of their own (20261016003000), each its own transaction
  ] LOOP
    CONTINUE WHEN to_regclass(format('public.%I', v)) IS NULL;
    -- Concurrently needs a populated view and a valid unique index on plain columns covering every row.
    SELECT c.relispopulated AND EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = c.oid AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
    ) INTO concurrent
    FROM pg_class c WHERE c.oid = to_regclass(format('public.%I', v));
    t_view := clock_timestamp();
    IF concurrent THEN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', v);
      n_conc := n_conc + 1;
    ELSE
      EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v);
      n_plain := n_plain + 1;
    END IF;
    timings := timings || format('%s %s s', v, round(extract(epoch FROM (clock_timestamp() - t_view))::numeric, 1));
  END LOOP;
  INSERT INTO public.treemap_refreshes (refreshed_at, seconds, note, populations)
  VALUES (now(), round(extract(epoch FROM (clock_timestamp() - t0))::numeric, 1),
          format('treemap_refresh_all: %s concurrently, %s plainly; %s', n_conc, n_plain, array_to_string(timings, ', ')),
          CASE WHEN to_regclass('public.mv_treemap_sale_brands') IS NOT NULL THEN public.treemap_populations() END);
END $function$;

DO $jobs$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-family-market') THEN
    PERFORM cron.schedule('refresh-family-market', '50 9 * * *',
      $cmd$SET statement_timeout = '20min'; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market$cmd$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-family-sales') THEN
    PERFORM cron.schedule('refresh-family-sales', '10 10 * * *',
      $cmd$SET statement_timeout = '20min'; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_sales$cmd$);
  END IF;
END $jobs$;

COMMIT;
