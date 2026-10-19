-- Live definition of public.treemap_refresh_all(), pg_get_functiondef on 2026-10-15 01:40Z
-- (prosrc sha256 clAMLpBvlRQjZ41onmswtjKpTx4nILqj0Kq4DQcyHRU=). Loaded by test_brand_market_fold.sql.
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
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'mv_treemap_by_source', 'mv_treemap_by_brand', 'mv_treemap_by_segment',
    'mv_treemap_makes_by_source', 'mv_treemap_makes_by_segment', 'mv_treemap_models_by_brand',
    'mv_treemap_models_by_source_make', 'mv_treemap_years', 'mv_treemap_nested_segment', 'mv_treemap_nested_brand',
    -- the confirmed-sale map (20261014063000): the fold before its two aggregates
    'mv_treemap_outcomes', 'mv_treemap_sale_brands', 'mv_treemap_sale_models'
  ] LOOP
    CONTINUE WHEN to_regclass(format('public.%I', v)) IS NULL;
    -- Concurrently needs a populated view and a valid unique index on plain columns covering every row.
    SELECT c.relispopulated AND EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = c.oid AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
    ) INTO concurrent
    FROM pg_class c WHERE c.oid = to_regclass(format('public.%I', v));
    IF concurrent THEN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', v);
      n_conc := n_conc + 1;
    ELSE
      EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v);
      n_plain := n_plain + 1;
    END IF;
  END LOOP;
  INSERT INTO public.treemap_refreshes (refreshed_at, seconds, note, populations)
  VALUES (now(), round(extract(epoch FROM (clock_timestamp() - t0))::numeric, 1),
          format('treemap_refresh_all: %s concurrently, %s plainly', n_conc, n_plain),
          CASE WHEN to_regclass('public.mv_treemap_sale_brands') IS NOT NULL THEN public.treemap_populations() END);
END $function$
;
