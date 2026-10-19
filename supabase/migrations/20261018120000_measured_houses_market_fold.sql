-- Expand the market map's 12-month measured houses from Bring a Trailer alone to all three auction houses
-- held in full (>=90% of enumerated lots) across both 12-month windows (source_census.by_year, 20261017130000
-- and 20261017140000): Bring a Trailer (95.7%), Mecum (97.0%), and Bonhams (94.3%).
--
-- Previously, mv_family_market counted only Bring a Trailer (`o.source_name = 'Bring a Trailer'`) for its
-- `bat_dated`, `bat_sold_12m`, `bat_sold_prior_12m`, `bat_usd_12m`, and `bat_usd_prior_12m` columns. Because
-- the map's all-venues share gate requires the measured houses to hold at least half of a tile's confirmed
-- sales (`dated >= 0.5 * sold`), 19 of the top 45 brands (Chevrolet, Ford, Dodge, Aston Martin, Shelby,
-- Lamborghini, Bentley, Pontiac, Rolls-Royce, Plymouth, Cadillac, Maserati, Packard, Oldsmobile, Buick,
-- Lincoln, Lancia, Chrysler, Mercury) were hatched as "unmeasured" despite having hundreds or thousands of
-- dated sales across Bring a Trailer, Mecum, and Bonhams in both years.
--
-- Counting Bring a Trailer, Mecum, and Bonhams as the measured houses (with `bat_dated` counting all confirmed
-- sales at the measured houses, and the 12-month columns counting dated sales in each 365-day window) brings
-- all 19 of those major brands above the 50% share gate.
--
-- Contract: supabase/sql/test_measured_houses_market_fold.sql.

BEGIN;
SET LOCAL statement_timeout = '15min';
SET LOCAL lock_timeout = '10s';

DO $migrate$
BEGIN
  IF to_regclass('public.mv_family_market') IS NULL THEN
    RAISE EXCEPTION 'mv_family_market is missing; apply 20261015131500_family_market_fold.sql first';
  END IF;

  -- Rebuild mv_family_market (and its dependent mv_family_sales) when it still filters on Bring a Trailer alone.
  IF pg_get_viewdef('public.mv_family_market'::regclass) NOT LIKE '%Mecum%' THEN
    DROP MATERIALIZED VIEW IF EXISTS public.mv_family_sales;
    DROP MATERIALIZED VIEW public.mv_family_market;

    CREATE MATERIALIZED VIEW public.mv_family_market AS
    WITH o AS (
      SELECT o.brand_name, o.model, o.outcome, o.sold_amount, o.year, coalesce(v.sale_date, v.bat_sale_date) AS sale_date,
             lower(v.make) AS make_l, lower(coalesce(o.model, '')) AS model_l,
             o.source_name IN ('Bring a Trailer', 'Mecum', 'Bonhams') AND o.sold_amount > 0 AS bat
      FROM public.mv_treemap_outcomes o
      JOIN public.vehicles v ON v.id = o.id
    ), f AS (
      SELECT o.*, CASE WHEN n.family_id IS NOT NULL
                        AND (o.year IS NULL OR n.year_start IS NULL OR o.year >= n.year_start - 1)
                        AND (o.year IS NULL OR n.year_end IS NULL OR o.year <= n.year_end + 1)
                       THEN n.family_id END AS family_id,
             n.family
      FROM o
      LEFT JOIN public.mv_model_family_names n ON n.make_l = o.make_l AND n.model_l = o.model_l
    ), g AS (
      SELECT brand_name, family_id, model_l AS model_key,
        mode() WITHIN GROUP (ORDER BY model) AS model,
        min(family) FILTER (WHERE family_id IS NOT NULL) AS family,
        count(*) FILTER (WHERE sold_amount > 0) AS sold,
        count(*) FILTER (WHERE outcome = 'sold') AS sold_any,
        count(*) AS offered,
        (sum(sold_amount) FILTER (WHERE sold_amount > 0))::bigint AS usd,
        -- the 12-month move, on the measured houses (Bring a Trailer, Mecum, Bonhams)
        count(*) FILTER (WHERE bat) AS bat_dated,
        count(*) FILTER (WHERE bat AND sale_date > current_date - 365 AND sale_date <= current_date) AS bat_sold_12m,
        count(*) FILTER (WHERE bat AND sale_date > current_date - 730 AND sale_date <= current_date - 365) AS bat_sold_prior_12m,
        (sum(sold_amount) FILTER (WHERE bat AND sale_date > current_date - 365 AND sale_date <= current_date))::bigint AS bat_usd_12m,
        (sum(sold_amount) FILTER (WHERE bat AND sale_date > current_date - 730 AND sale_date <= current_date - 365))::bigint AS bat_usd_prior_12m
      FROM f
      GROUP BY brand_name, family_id, model_l
    ), k AS (
      -- A family needs 3 sales in the brand to be named; fewer join the brand's "other".
      SELECT g.*, (family_id IS NULL OR sum(sold) OVER (PARTITION BY brand_name, family_id) < 3) AS other FROM g
    )
    SELECT brand_name AS brand,
      CASE WHEN other THEN 'other' ELSE family_id::text END AS family_key,
      CASE WHEN other THEN NULL ELSE max(family) END AS family,
      model_key, mode() WITHIN GROUP (ORDER BY model) AS model,
      sum(sold)::bigint AS sold, sum(sold_any)::bigint AS sold_any, sum(offered)::bigint AS offered,
      sum(usd)::bigint AS usd, sum(bat_dated)::bigint AS bat_dated,
      sum(bat_sold_12m)::bigint AS bat_sold_12m, sum(bat_sold_prior_12m)::bigint AS bat_sold_prior_12m,
      sum(bat_usd_12m)::bigint AS bat_usd_12m, sum(bat_usd_prior_12m)::bigint AS bat_usd_prior_12m,
      now() AS as_of
    FROM k
    GROUP BY brand_name, other, CASE WHEN other THEN 'other' ELSE family_id::text END, model_key;

    CREATE UNIQUE INDEX mv_family_market_key ON public.mv_family_market (brand, family_key, model_key);
    REVOKE ALL ON public.mv_family_market FROM PUBLIC;
    GRANT SELECT ON public.mv_family_market TO anon, authenticated, service_role;
    COMMENT ON MATERIALIZED VIEW public.mv_family_market IS
      'One row per brand, factory model family (canonical_models key, or "other": no family, or under 3 sales in the brand) '
      'and model name (lower(model)) from confirmed sales: dollars, sold, sell-through inputs, and (bat_*) the last 12 months '
      'against the 12 before on the measured houses (Bring a Trailer, Mecum, Bonhams).';

    CREATE MATERIALIZED VIEW public.mv_family_sales AS
    WITH o AS (
      SELECT o.id, o.brand_name, o.model, o.year, o.source_name, o.sold_amount,
             coalesce(v.sale_date, v.bat_sale_date) AS sale_date,
             lower(v.make) AS make_l, lower(coalesce(o.model, '')) AS model_l
      FROM public.mv_treemap_outcomes o
      JOIN public.vehicles v ON v.id = o.id
      WHERE o.sold_amount > 0 AND coalesce(v.sale_date, v.bat_sale_date) IS NOT NULL
    ), f AS (
      SELECT o.*,
             CASE WHEN n.family_id IS NOT NULL
                   AND (o.year IS NULL OR n.year_start IS NULL OR o.year >= n.year_start - 1)
                   AND (o.year IS NULL OR n.year_end IS NULL OR o.year <= n.year_end + 1)
                  THEN n.family_id::text END AS family_id
      FROM o
      LEFT JOIN public.mv_model_family_names n ON n.make_l = o.make_l AND n.model_l = o.model_l
    ), named AS (
      SELECT DISTINCT brand, family_key FROM public.mv_family_market WHERE family_key <> 'other'
    )
    SELECT f.id AS vehicle_id,
           f.brand_name AS brand,
           coalesce(named.family_key, 'other') AS family_key,
           f.model,
           f.year,
           f.source_name AS source,
           f.sold_amount::bigint AS usd,
           f.sale_date
    FROM f
    LEFT JOIN named ON named.brand = f.brand_name AND named.family_key = f.family_id;

    CREATE UNIQUE INDEX mv_family_sales_vehicle ON public.mv_family_sales (vehicle_id);
    CREATE INDEX mv_family_sales_family_date ON public.mv_family_sales (brand, family_key, sale_date DESC);
    CLUSTER public.mv_family_sales USING mv_family_sales_family_date;
    ANALYZE public.mv_family_sales;
    REVOKE ALL ON public.mv_family_sales FROM PUBLIC;
    GRANT SELECT ON public.mv_family_sales TO anon, authenticated, service_role;
    COMMENT ON MATERIALIZED VIEW public.mv_family_sales IS
      'Dated confirmed sales with an amount, keyed to (brand, family_key) the way mv_family_market keys them.';
  END IF;
END $migrate$;

-- Update treemap_family_monthly so its 24 monthly bars match the same three measured houses.
CREATE OR REPLACE FUNCTION public.treemap_family_monthly(p_families jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH req AS (
    SELECT DISTINCT ON (x->>'brand', x->>'family_key') x->>'brand' AS brand, x->>'family_key' AS family_key, o
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_families) = 'array' THEN p_families ELSE '[]'::jsonb END)
         WITH ORDINALITY AS a(x, o)
    WHERE x->>'brand' IS NOT NULL AND x->>'family_key' IS NOT NULL
    ORDER BY x->>'brand', x->>'family_key', o
  ), capped AS (
    SELECT * FROM req ORDER BY o LIMIT 40
  ), b AS (
    SELECT c.brand, c.family_key, 23 - ((current_date - s.sale_date) * 24 / 730) AS bin, count(*) AS n
    FROM capped c
    JOIN public.mv_family_sales s ON s.brand = c.brand AND s.family_key = c.family_key
    WHERE s.source IN ('Bring a Trailer', 'Mecum', 'Bonhams') AND s.sale_date > current_date - 730 AND s.sale_date <= current_date
    GROUP BY 1, 2, 3
  )
  SELECT jsonb_build_object(
    'anchor', current_date, 'window_days', 730, 'bin_days', round(730 / 24.0, 2),
    'families', coalesce((
      SELECT jsonb_agg(jsonb_build_object('brand', c.brand, 'family_key', c.family_key,
        'bins', (SELECT jsonb_agg(coalesce(b.n, 0) ORDER BY g)
                 FROM generate_series(0, 23) g
                 LEFT JOIN b ON b.brand = c.brand AND b.family_key = c.family_key AND b.bin = g)) ORDER BY c.o)
      FROM capped c), '[]'::jsonb))
$function$;
REVOKE ALL ON FUNCTION public.treemap_family_monthly(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_monthly(jsonb) TO anon, authenticated, service_role;

DO $refresh_movers$
BEGIN
  IF to_regclass('public.mv_family_share_movers') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW public.mv_family_share_movers;
  END IF;
END $refresh_movers$;

COMMIT;
