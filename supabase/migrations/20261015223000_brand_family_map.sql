-- treemap_brand_family_map: the brand map with each brand's families inside it, in one read.
--
-- The owner asked for real examples of data expression (2026-10-15); the brand map's model is finviz's map of the
-- market: every company of an index in one treemap, grouped by sector and industry, area by size and color by the
-- move, so what each sector holds and which way it went read in one look. Here: the largest brands by confirmed-sale
-- dollars, each holding its largest model families, sized by dollars and colored by their Bring a Trailer 12-month
-- move, with each brand's remaining families as one "more" tile and its unkeyed names as "other models", so a brand's
-- tiles add up to the brand.
--
-- Reads mv_family_market (20261015131500) only: one aggregate over its rows per call (55-68 ms measured on prod
-- 2026-10-15 06:40Z for 60 brands). p_brands (default 60, at most 120) brands by dollars; p_families (default 12, at
-- most 30) named families per brand. dated and the 12-month columns are BaT only, as on the map.
-- Contract: supabase/sql/test_brand_family_map.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.mv_family_market') IS NULL THEN
    RAISE EXCEPTION 'mv_family_market is missing; apply 20261015131500_family_market_fold.sql first';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.treemap_brand_family_map(p_brands integer DEFAULT 60, p_families integer DEFAULT 12)
 RETURNS TABLE(brand text, brand_usd bigint, brand_rank integer, family_key text, family text, usd bigint, sold bigint,
               sold_any bigint, offered bigint, dated bigint, sold_12m bigint, sold_prior_12m bigint, usd_12m bigint,
               usd_prior_12m bigint, families integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH f AS MATERIALIZED (
    SELECT brand, family_key, max(family) AS family, sum(usd)::bigint AS usd, sum(sold)::bigint AS sold,
           sum(sold_any)::bigint AS sold_any, sum(offered)::bigint AS offered, sum(bat_dated)::bigint AS dated,
           sum(bat_sold_12m)::bigint AS s12, sum(bat_sold_prior_12m)::bigint AS sp,
           sum(bat_usd_12m)::bigint AS u12, sum(bat_usd_prior_12m)::bigint AS up
    FROM public.mv_family_market
    GROUP BY brand, family_key
  ), b AS (
    SELECT brand, sum(usd)::bigint AS busd, count(*) FILTER (WHERE family_key <> 'other')::integer AS families,
           row_number() OVER (ORDER BY sum(usd) DESC NULLS LAST, brand)::integer AS r
    FROM f GROUP BY brand
  ), top AS (
    SELECT b.* FROM b WHERE b.r <= least(greatest(p_brands, 1), 120)
  ), named AS (
    SELECT f.*, row_number() OVER (PARTITION BY f.brand ORDER BY f.usd DESC NULLS LAST, f.family_key) AS fr
    FROM f JOIN top USING (brand) WHERE f.family_key <> 'other'
  ), rows AS (
    SELECT brand, family_key, family, usd, sold, sold_any, offered, dated, s12, sp, u12, up
    FROM named WHERE fr <= least(greatest(p_families, 1), 30)
    UNION ALL
    -- the brand's remaining named families, as one tile
    SELECT brand, 'more', NULL, sum(usd)::bigint, sum(sold)::bigint, sum(sold_any)::bigint, sum(offered)::bigint,
           sum(dated)::bigint, sum(s12)::bigint, sum(sp)::bigint, sum(u12)::bigint, sum(up)::bigint
    FROM named WHERE fr > least(greatest(p_families, 1), 30)
    GROUP BY brand
    UNION ALL
    SELECT f.brand, 'other', NULL, f.usd, f.sold, f.sold_any, f.offered, f.dated, f.s12, f.sp, f.u12, f.up
    FROM f JOIN top USING (brand) WHERE f.family_key = 'other'
  )
  SELECT r.brand, t.busd, t.r, r.family_key, r.family, r.usd, r.sold, r.sold_any, r.offered, r.dated, r.s12, r.sp,
         r.u12, r.up, t.families
  FROM rows r JOIN top t USING (brand)
  ORDER BY t.r, (r.family_key IN ('more', 'other')), r.usd DESC NULLS LAST, r.family_key;
$function$;
REVOKE ALL ON FUNCTION public.treemap_brand_family_map(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_brand_family_map(integer, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.treemap_brand_family_map(integer, integer) IS
  'The brand map with families inside (mv_family_market): the p_brands largest brands by confirmed-sale dollars, each '
  'with its p_families largest named families, a "more" tile for the rest and "other" for unkeyed names, so a brand''s '
  'rows add up to the brand. dated and the 12-month columns are Bring a Trailer only. 2026-10-15.';

COMMIT;
