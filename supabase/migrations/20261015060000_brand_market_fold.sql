-- mv_brand_market: what a brand's market is, one row per brand, from confirmed sales.
--
-- Skylar, 2026-10-15: the market treemap is the most important surface, and its tiles ("Chevrolet 27,885 sold, $36K
-- med, 11.5%") say little: a brand is not its median price, and the share repeats the tile's area. Measured on
-- mv_treemap_outcomes the same night, the fold already holds what defines a brand's market; this makes it a row:
--   usd                dollars that changed hands (Porsche $2.65B, Ferrari $2.38B from 5,123 sales, Chevrolet $1.48B)
--   sold, offered      confirmed sales with an amount, and every car with a known outcome; sold_any / offered is the
--                      sell-through (Lamborghini 71.3%, BMW 86.6%)
--   p10, p50, p90      the band from the cheapest tenth to the top tenth of sales (Porsche $16.8K to $190.6K); p10 and
--                      p90 need 20 sales, p50 needs 5, else null
--   year_p50           the model year that trades (Chevrolet 1972, Porsche 2001); 5 dated-by-year sales, else null
--   sold_12m, sold_prior_12m, usd_12m, usd_prior_12m
--                      the last 12 months against the 12 before, by sale date (vehicles.sale_date, else bat_sale_date)
--   dated              sales with a sale date, the denominator the 12-month figures stand on (Lotus 94.0%, Shelby
--                      73.8% on 2026-10-15)
--   as_of              when this row was computed
-- Same population as the map (public vehicles, confirmed or unsold outcomes, brands with 5 or more sales). Refreshed
-- with the treemap (treemap_refresh_all, cron job 175, daily 09:10 UTC), after mv_treemap_outcomes. Read through
-- treemap_brand_market(); anon and authenticated read the fold's aggregates, as they read mv_treemap_sale_brands.
-- Contract: supabase/sql/test_brand_market_fold.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '600s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v
  FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure;
  IF v IS DISTINCT FROM 'clAMLpBvlRQjZ41onmswtjKpTx4nILqj0Kq4DQcyHRU=' AND v IS DISTINCT FROM 'VhMa2L1R1HwTDh83VCW5XYhEYqWcVutFoAybnAYR0BM=' THEN
    RAISE EXCEPTION 'treemap_refresh_all is not the 2026-10-15 definition this was written from (sha256 %)', v;
  END IF;
END $guard$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_brand_market AS
WITH o AS (
  SELECT o.brand_name, o.outcome, o.sold_amount, o.year, coalesce(v.sale_date, v.bat_sale_date) AS sale_date
  FROM public.mv_treemap_outcomes o
  JOIN public.vehicles v ON v.id = o.id
), b AS (
  SELECT brand_name AS name,
    count(*) FILTER (WHERE sold_amount > 0) AS sold,
    count(*) FILTER (WHERE outcome = 'sold') AS sold_any,
    count(*) AS offered,
    (sum(sold_amount) FILTER (WHERE sold_amount > 0))::bigint AS usd,
    percentile_cont(0.1) WITHIN GROUP (ORDER BY sold_amount::float8) FILTER (WHERE sold_amount > 0) AS q10,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY sold_amount::float8) FILTER (WHERE sold_amount > 0) AS q50,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY sold_amount::float8) FILTER (WHERE sold_amount > 0) AS q90,
    count(*) FILTER (WHERE sold_amount > 0 AND year IS NOT NULL) AS with_year,
    percentile_disc(0.5) WITHIN GROUP (ORDER BY year) FILTER (WHERE sold_amount > 0 AND year IS NOT NULL) AS y50,
    count(*) FILTER (WHERE sold_amount > 0 AND sale_date IS NOT NULL) AS dated,
    count(*) FILTER (WHERE sold_amount > 0 AND sale_date > current_date - 365 AND sale_date <= current_date) AS sold_12m,
    count(*) FILTER (WHERE sold_amount > 0 AND sale_date > current_date - 730 AND sale_date <= current_date - 365) AS sold_prior_12m,
    (sum(sold_amount) FILTER (WHERE sold_amount > 0 AND sale_date > current_date - 365 AND sale_date <= current_date))::bigint AS usd_12m,
    (sum(sold_amount) FILTER (WHERE sold_amount > 0 AND sale_date > current_date - 730 AND sale_date <= current_date - 365))::bigint AS usd_prior_12m
  FROM o
  GROUP BY brand_name
  HAVING count(*) FILTER (WHERE sold_amount > 0) >= 5
)
SELECT name, sold, sold_any, offered, usd,
  CASE WHEN sold >= 20 THEN q10::bigint END AS p10,
  q50::bigint AS p50,
  CASE WHEN sold >= 20 THEN q90::bigint END AS p90,
  CASE WHEN with_year >= 5 THEN y50 END AS year_p50,
  dated, sold_12m, sold_prior_12m, usd_12m, usd_prior_12m,
  now() AS as_of
FROM b;
CREATE UNIQUE INDEX IF NOT EXISTS mv_brand_market_name ON public.mv_brand_market (name);
REVOKE ALL ON public.mv_brand_market FROM PUBLIC;
GRANT SELECT ON public.mv_brand_market TO anon, authenticated, service_role;
COMMENT ON MATERIALIZED VIEW public.mv_brand_market IS
  'One row per brand from confirmed sales: dollars, sell-through, the p10-p90 price band, the model year that trades, and the last 12 months against the 12 before. Refreshed by treemap_refresh_all.';

CREATE OR REPLACE FUNCTION public.treemap_brand_market()
 RETURNS TABLE(name text, sold bigint, sold_any bigint, offered bigint, usd bigint, p10 bigint, p50 bigint, p90 bigint,
               year_p50 integer, dated bigint, sold_12m bigint, sold_prior_12m bigint, usd_12m bigint,
               usd_prior_12m bigint, as_of timestamptz)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT name, sold, sold_any, offered, usd, p10, p50, p90, year_p50, dated, sold_12m, sold_prior_12m, usd_12m,
         usd_prior_12m, as_of
  FROM public.mv_brand_market ORDER BY usd DESC NULLS LAST, name;
$function$;
REVOKE ALL ON FUNCTION public.treemap_brand_market() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_brand_market() TO anon, authenticated, service_role;

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
    'mv_brand_market'
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

DO $check$
BEGIN
  IF NOT (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_brand_market'::regclass) THEN
    RAISE EXCEPTION 'mv_brand_market is not populated';
  END IF;
  IF position('mv_brand_market' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'treemap_refresh_all does not refresh mv_brand_market';
  END IF;
END $check$;

COMMIT;
