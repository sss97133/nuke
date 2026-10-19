-- treemap_family_movers: the model families whose Bring a Trailer market moved most in the last 12 months against the
-- 12 before, both ways, with BaT's own move beside them.
--
-- The owner on the brand map (2026-10-15): "increase over 12 months is interesting, but needs expansion and clarity".
-- A tile's color says one brand's move; this says which families moved most across every brand, against the venue's
-- baseline, so a rise is read against BaT's own growth. Measured 2026-10-15 05:40Z on mv_family_market (20261015131500,
-- BaT-only bat_* columns): 160 of 1,137 named families had at least 30 BaT sales in each window with BaT holding half
-- their sales; BaT overall 34,827 -> 39,001 sales (+12%), dollars +27%. Top by dollars: Ferrari 360 46 -> 92 sales,
-- dollars +184%; bottom: Acura Integra 49 -> 36, dollars -44%.
--
-- Eligibility (a family is listed only when its move can be read): named (not "other"), at least p_min_sales BaT
-- sales in each window (default 30), BaT's dated sales at least half the family's confirmed sales (the map's gate).
-- Ranked by dollars last 12 months over the 12 before; p_limit per direction (default 8, at most 25).
-- Reads mv_family_market only (one aggregate over its rows per call; no new fold).
-- Contract: supabase/sql/test_family_movers.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.mv_family_market') IS NULL THEN
    RAISE EXCEPTION 'mv_family_market is missing; apply 20261015131500_family_market_fold.sql first';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.treemap_family_movers(p_limit integer DEFAULT 8, p_min_sales integer DEFAULT 30)
 RETURNS TABLE(direction text, brand text, family_key text, family text, sold_12m bigint, sold_prior_12m bigint,
               usd_12m bigint, usd_prior_12m bigint, bat_sold_12m bigint, bat_sold_prior_12m bigint,
               bat_usd_12m bigint, bat_usd_prior_12m bigint, eligible bigint, families bigint, as_of timestamptz)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH f AS (
    SELECT brand, family_key, max(family) AS family, sum(sold) AS sold, sum(bat_dated) AS dated,
           sum(bat_sold_12m)::bigint AS s12, sum(bat_sold_prior_12m)::bigint AS sp,
           sum(bat_usd_12m)::bigint AS u12, sum(bat_usd_prior_12m)::bigint AS up, max(as_of) AS as_of
    FROM public.mv_family_market
    WHERE family_key <> 'other'
    GROUP BY brand, family_key
  ), bat AS (
    SELECT sum(bat_sold_12m)::bigint AS s12, sum(bat_sold_prior_12m)::bigint AS sp,
           sum(bat_usd_12m)::bigint AS u12, sum(bat_usd_prior_12m)::bigint AS up
    FROM public.mv_family_market
  ), e AS (
    SELECT * FROM f
    WHERE sp >= greatest(p_min_sales, 1) AND s12 >= greatest(p_min_sales, 1) AND dated >= 0.5 * sold AND up > 0
  ), ranked AS (
    (SELECT 'up'::text AS direction, e.* FROM e WHERE u12 > up ORDER BY u12::numeric / up DESC, brand, family_key
      LIMIT least(greatest(p_limit, 1), 25))
    UNION ALL
    (SELECT 'down'::text, e.* FROM e WHERE u12 < up ORDER BY u12::numeric / up ASC, brand, family_key
      LIMIT least(greatest(p_limit, 1), 25))
  )
  SELECT r.direction, r.brand, r.family_key, r.family, r.s12, r.sp, r.u12, r.up, b.s12, b.sp, b.u12, b.up,
         (SELECT count(*) FROM e), (SELECT count(*) FROM f), r.as_of
  FROM ranked r CROSS JOIN bat b
  ORDER BY r.direction DESC, CASE WHEN r.direction = 'up' THEN -(r.u12::numeric / r.up) ELSE r.u12::numeric / r.up END;
$function$;
REVOKE ALL ON FUNCTION public.treemap_family_movers(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_movers(integer, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.treemap_family_movers(integer, integer) IS
  'The named model families whose Bring a Trailer dollars moved most, last 12 months against the 12 before (up and '
  'down, p_limit each), eligible at p_min_sales BaT sales in each window with BaT holding half their sales; bat_* = '
  'BaT overall for the same windows; eligible / families = how many families could be read. mv_family_market. 2026-10-15.';

COMMIT;
