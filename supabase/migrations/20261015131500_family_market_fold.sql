-- mv_family_market: what each brand trades, by factory model family and model name, from confirmed sales.
--
-- The owner on the brand map (2026-10-15): sell-through and the 12-month move are the interest, and the map "needs a huge
-- development run". A brand tile says what the brand's market is; its drill now goes brand, family, model name, year,
-- sale, with the same measures at each level, instead of starting at the raw model strings (split by trim, so no single
-- model held more than a few percent of a brand).
-- Families come from mv_model_family_names (20261015090000: every public make and model name keyed to canonical_models
-- by its aliases; 494,210 of the 681,551 vehicles in the name dictionary resolve, prod 2026-10-15 04:01Z). Sales whose
-- name has no family stay in one "other" family per brand, so the drill shows its coverage, and that family's model names
-- are the names still to key.
--
-- Grain: one row per brand (mv_treemap_outcomes.brand_name, the brand tile), family (canonical_models key, or 'other')
-- and model name (model_key = lower(model); model = its most common spelling, so treemap_years and treemap_sales, which
-- match lower(model), read the same sales). Measures as in mv_brand_market: sold (sold_amount > 0), sold_any (outcome
-- sold), offered (outcomes), usd. A family whose year range excludes the vehicle (one year of slack) does not claim it.
-- A family with under 3 sales in a brand folds into that brand's "other".
--
-- The 12-month move is read on Bring a Trailer only (bat_*: the last 12 months against the 12 before, by
-- coalesce(sale_date, bat_sale_date)). Measured 2026-10-15 against the complete local BaT archive: the all-source move
-- on the brand tiles mixed in venues whose intake is uneven between the two years, so it disagreed with BaT itself
-- (Ferrari dollars -6% on the tile, +93% on BaT; BMW sales -7% on the tile, +2% on BaT; Chevrolet +30% / +51% against
-- +17% / +22%; Porsche +19% / +32% against +15% / +30%). BaT is the venue held in full both years (252,399 of 264,746
-- enumerated lots, 95%). bat_dated counts the BaT sales with a date; the readers return it as dated, so the map's gate
-- (dated sales at least half the tile's sales) also requires BaT to hold half the tile before its move is shown.
-- Readers: treemap_brand_families(p_brand) sums a brand's families; treemap_family_models(p_brand, p_family_key) lists
-- one family's model names; treemap_brand_market() keeps mv_brand_market's measures and takes its 12-month move from
-- here. Refreshed by treemap_refresh_all after mv_brand_market.
-- Contract: supabase/sql/test_family_market_fold.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v FROM pg_proc WHERE oid = 'public.treemap_refresh_all()'::regprocedure;
  IF v IS DISTINCT FROM 'VhMa2L1R1HwTDh83VCW5XYhEYqWcVutFoAybnAYR0BM=' AND v IS DISTINCT FROM 'MShRHtu+JLH+txYJroJbRkdsercapQNqBZp+I1xuCZU=' THEN
    RAISE EXCEPTION 'treemap_refresh_all is not the 20261015060000 definition this was written from (sha256 %)', v;
  END IF;
  IF to_regclass('public.mv_model_family_names') IS NULL THEN
    RAISE EXCEPTION 'mv_model_family_names is missing; apply 20261015090000_model_family_names.sql first';
  END IF;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v FROM pg_proc WHERE oid = 'public.treemap_brand_market()'::regprocedure;
  IF v IS DISTINCT FROM '/HCqc/zuzYp7NjxL8wjHlp6i75CT033Rhb2b2tpoWX4=' AND v IS DISTINCT FROM 'Xt9IvXozs0g4XR8gw2c8evCsZxuEdwLoJucsaDCET7c=' THEN
    RAISE EXCEPTION 'treemap_brand_market is not the 20261015060000 definition this was written from (sha256 %)', v;
  END IF;
END $guard$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_family_market AS
WITH o AS (
  SELECT o.brand_name, o.model, o.outcome, o.sold_amount, o.year, coalesce(v.sale_date, v.bat_sale_date) AS sale_date,
         lower(v.make) AS make_l, lower(coalesce(o.model, '')) AS model_l,
         o.source_name = 'Bring a Trailer' AND o.sold_amount > 0 AS bat
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
    -- the 12-month move, on Bring a Trailer only (header)
    count(*) FILTER (WHERE bat AND sale_date IS NOT NULL) AS bat_dated,
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
CREATE UNIQUE INDEX IF NOT EXISTS mv_family_market_key ON public.mv_family_market (brand, family_key, model_key);
REVOKE ALL ON public.mv_family_market FROM PUBLIC;
GRANT SELECT ON public.mv_family_market TO anon, authenticated, service_role;
COMMENT ON MATERIALIZED VIEW public.mv_family_market IS
  'One row per brand, factory model family (canonical_models key, or "other": no family, or under 3 sales in the brand) '
  'and model name (lower(model)) from confirmed sales: dollars, sold, sell-through inputs, and (bat_*) the last 12 months '
  'against the 12 before on Bring a Trailer only. Refreshed by treemap_refresh_all after mv_brand_market.';

CREATE OR REPLACE FUNCTION public.treemap_brand_families(p_brand text)
 RETURNS TABLE(family_key text, family text, models bigint, sold bigint, sold_any bigint, offered bigint, usd bigint,
               dated bigint, sold_12m bigint, sold_prior_12m bigint, usd_12m bigint, usd_prior_12m bigint, as_of timestamptz)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT family_key, max(family), count(*) FILTER (WHERE sold > 0),
         sum(sold)::bigint, sum(sold_any)::bigint, sum(offered)::bigint, sum(usd)::bigint, sum(bat_dated)::bigint,
         sum(bat_sold_12m)::bigint, sum(bat_sold_prior_12m)::bigint, sum(bat_usd_12m)::bigint, sum(bat_usd_prior_12m)::bigint,
         max(as_of)
  FROM public.mv_family_market
  WHERE brand = p_brand
  GROUP BY family_key
  ORDER BY (family_key = 'other'), sum(usd) DESC NULLS LAST, max(family);
$function$;
REVOKE ALL ON FUNCTION public.treemap_brand_families(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_brand_families(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.treemap_brand_families(text) IS
  'One brand''s factory model families on the market map (mv_family_market), largest dollars first and "other" last; '
  'models = model names with a confirmed sale; dated and the 12-month columns are Bring a Trailer only. 2026-10-15.';

-- The family's model names with a confirmed sale, largest first; the leaf of the family drill hands the name to
-- treemap_years and treemap_sales.
CREATE OR REPLACE FUNCTION public.treemap_family_models(p_brand text, p_family_key text)
 RETURNS TABLE(model text, sold bigint, sold_any bigint, offered bigint, usd bigint, dated bigint,
               sold_12m bigint, sold_prior_12m bigint, usd_12m bigint, usd_prior_12m bigint, as_of timestamptz)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT nullif(model, ''), sold, sold_any, offered, usd, bat_dated, bat_sold_12m, bat_sold_prior_12m, bat_usd_12m,
         bat_usd_prior_12m, as_of
  FROM public.mv_family_market
  WHERE brand = p_brand AND family_key = p_family_key AND sold > 0
  ORDER BY usd DESC, model_key
  LIMIT 200;
$function$;
REVOKE ALL ON FUNCTION public.treemap_family_models(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_models(text, text) TO anon, authenticated, service_role;
-- The brand tile's 12-month move from the same Bring a Trailer counts (header); every other measure still comes from
-- mv_brand_market. Same columns and order as 20261015060000, so the map reads it unchanged.
CREATE OR REPLACE FUNCTION public.treemap_brand_market()
 RETURNS TABLE(name text, sold bigint, sold_any bigint, offered bigint, usd bigint, p10 bigint, p50 bigint, p90 bigint,
               year_p50 integer, dated bigint, sold_12m bigint, sold_prior_12m bigint, usd_12m bigint,
               usd_prior_12m bigint, as_of timestamptz)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH bat AS (
    SELECT brand, sum(bat_dated)::bigint AS dated, sum(bat_sold_12m)::bigint AS sold_12m,
           sum(bat_sold_prior_12m)::bigint AS sold_prior_12m, sum(bat_usd_12m)::bigint AS usd_12m,
           sum(bat_usd_prior_12m)::bigint AS usd_prior_12m
    FROM public.mv_family_market
    GROUP BY brand
  )
  SELECT m.name, m.sold, m.sold_any, m.offered, m.usd, m.p10, m.p50, m.p90, m.year_p50,
         coalesce(b.dated, 0)::bigint, b.sold_12m, b.sold_prior_12m, b.usd_12m, b.usd_prior_12m, m.as_of
  FROM public.mv_brand_market m
  LEFT JOIN bat b ON b.brand = m.name
  ORDER BY m.usd DESC NULLS LAST, m.name;
$function$;
REVOKE ALL ON FUNCTION public.treemap_brand_market() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_brand_market() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.treemap_brand_market() IS
  'The market map''s brands (mv_brand_market): dollars, sold, sell-through, price band and the year that trades from '
  'every venue; dated and the 12-month columns from Bring a Trailer only (mv_family_market bat_*). 2026-10-15.';

COMMENT ON FUNCTION public.treemap_family_models(text, text) IS
  'One family''s model names on the market map (mv_family_market), top 200 by confirmed-sale dollars; the name matches '
  'treemap_years and treemap_sales. Columns as treemap_brand_families. 2026-10-15.';

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
    'mv_family_market'
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
