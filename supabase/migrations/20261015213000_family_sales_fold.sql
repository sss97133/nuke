-- mv_family_sales: every dated confirmed sale, keyed to its brand and model family, for a family's sales chart.
--
-- The owner, 2026-10-15, asked for real examples of data expression; the model page to build first is the market chart
-- classic.com draws: every sale of a model over five years as one dot (price against date) with a moving average, so
-- the trading range, the volume and the outliers read at a glance. The map's drill (brand, family, model name) holds
-- aggregates only; this fold holds the sales themselves, keyed the same way as mv_family_market (20261015131500:
-- family from mv_model_family_names, a year either side of the family's years, "other" when the name has no family
-- or the family has under 3 sales in the brand).
--
-- Grain: one row per vehicle with a confirmed sale amount and a sale date (coalesce(sale_date, bat_sale_date)).
-- Reader: treemap_family_sales(p_brand, p_family_key, p_limit) returns a family's sales of the last five years, newest
-- first, at most 5,000. Refreshed by treemap_refresh_all after mv_family_market (it reads the named families from it).
-- Contract: supabase/sql/test_family_sales_fold.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure;
  IF v IS DISTINCT FROM 'MShRHtu+JLH+txYJroJbRkdsercapQNqBZp+I1xuCZU=' AND v IS DISTINCT FROM '8tEg32zRz6B27wPeSoDklEwQcNrLpIgGjTzvf481dfY=' THEN
    RAISE EXCEPTION 'treemap_refresh_all is not the 20261015131500 definition this was written from (sha256 %)', v;
  END IF;
  IF to_regclass('public.mv_family_market') IS NULL THEN
    RAISE EXCEPTION 'mv_family_market is missing; apply 20261015131500_family_market_fold.sql first';
  END IF;
END $guard$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_family_sales AS
WITH o AS (
  SELECT o.id, o.brand_name, o.model, o.year, o.source_name, o.sold_amount,
         coalesce(v.sale_date, v.bat_sale_date) AS sale_date,
         lower(v.make) AS make_l, lower(coalesce(o.model, '')) AS model_l
  FROM public.mv_treemap_outcomes o
  JOIN public.vehicles v ON v.id = o.id
  WHERE o.sold_amount > 0 AND coalesce(v.sale_date, v.bat_sale_date) IS NOT NULL
), f AS (
  SELECT o.*, CASE WHEN n.family_id IS NOT NULL
                    AND (o.year IS NULL OR n.year_start IS NULL OR o.year >= n.year_start - 1)
                    AND (o.year IS NULL OR n.year_end IS NULL OR o.year <= n.year_end + 1)
                   THEN n.family_id::text END AS family_id
  FROM o
  LEFT JOIN public.mv_model_family_names n ON n.make_l = o.make_l AND n.model_l = o.model_l
), named AS (
  SELECT DISTINCT brand, family_key FROM public.mv_family_market WHERE family_key <> 'other'
)
SELECT f.id AS vehicle_id, f.brand_name AS brand, coalesce(named.family_key, 'other') AS family_key,
       f.model, f.year, f.source_name AS source, f.sold_amount::bigint AS usd, f.sale_date
FROM f
LEFT JOIN named ON named.brand = f.brand_name AND named.family_key = f.family_id;
CREATE UNIQUE INDEX IF NOT EXISTS mv_family_sales_vehicle ON public.mv_family_sales (vehicle_id);
CREATE INDEX IF NOT EXISTS mv_family_sales_family_date ON public.mv_family_sales (brand, family_key, sale_date DESC);
REVOKE ALL ON public.mv_family_sales FROM PUBLIC;
GRANT SELECT ON public.mv_family_sales TO anon, authenticated, service_role;
COMMENT ON MATERIALIZED VIEW public.mv_family_sales IS
  'One row per vehicle with a confirmed sale amount and a sale date, keyed to its brand and model family as in '
  'mv_family_market ("other" when the name has no family or the family has under 3 sales). For a family''s sales '
  'chart. Refreshed by treemap_refresh_all after mv_family_market.';

CREATE OR REPLACE FUNCTION public.treemap_family_sales(p_brand text, p_family_key text, p_limit integer DEFAULT 5000)
 RETURNS TABLE(vehicle_id uuid, sale_date date, usd bigint, source text, year integer, model text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT vehicle_id, sale_date, usd, source, year, model
  FROM public.mv_family_sales
  WHERE brand = p_brand AND family_key = p_family_key AND sale_date > current_date - 1826 AND sale_date <= current_date
  ORDER BY sale_date DESC, vehicle_id
  LIMIT least(greatest(p_limit, 1), 5000);
$function$;
REVOKE ALL ON FUNCTION public.treemap_family_sales(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_sales(text, text, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.treemap_family_sales(text, text, integer) IS
  'One model family''s confirmed sales with a date in the last five years (mv_family_sales), newest first, at most '
  '5,000: the dots of its sales chart. 2026-10-15.';

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
    'mv_treemap_outcomes', 'mv_treemap_sale_brands', 'mv_treemap_sale_models',
    -- what a brand's market is (20261015060000): reads mv_treemap_outcomes, so it refreshes after it
    'mv_brand_market',
    -- what each brand trades, by family and model name (20261015131500): reads mv_treemap_outcomes and mv_model_family_names
    'mv_family_market',
    -- every dated sale by family, for the family sales chart (20261015213000): reads the named families of mv_family_market
    'mv_family_sales'
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
END $function$;

COMMIT;
