-- treemap_family_share_movers: the model families that gained or lost share of Bring a Trailer's sales, last 12 months
-- against the 12 before, each with the uncertainty of its move, and its average sale price kept apart from volume.
--
-- The movers strip ranked families by BaT dollars (treemap_family_movers), which mixes volume with price: on
-- 2026-10-15 Lexus GX read "▲154%" on 187% more sales while its average sale fell 12%, and Bentley Continental GT was
-- listed as falling while it sold more cars (55 -> 67, average sale -37%) (map design study, 2026-10-15). This reader
-- ranks volume against the venue: share_move = (sold_12m / sold_prior_12m) / (BaT's sold_12m / sold_prior_12m) - 1,
-- with a Poisson standard error on its log, se = sqrt(1 / sold_12m + 1 / sold_prior_12m), and lists a family only when
-- |ln(1 + share_move)| >= 2 se. Eligibility as the strip's: a named family (not "other"), at least p_min_sales BaT
-- sales in each window (default 30), BaT holding at least half of its confirmed sales. Each row also carries the move
-- of its average sale (dollars over sales, both windows): what sold changes with it, so it is shown beside volume,
-- never as a price index.
-- One jsonb value: {as_of, min_sales, bat {sold_12m, sold_prior_12m, usd_12m, usd_prior_12m}, families, eligible,
-- significant, gaining [...], losing [...]}; p_limit rows a side (default 5, at most 25), largest moves first. Computed
-- by family_share_movers_build from mv_family_market; at the default eligibility it is served from
-- mv_family_share_movers, refreshed daily after mv_family_market. Contract: supabase/sql/test_family_share_movers.sql.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.mv_family_market') IS NULL THEN
    RAISE EXCEPTION 'mv_family_market is missing; apply 20261015131500_family_market_fold.sql first';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.family_share_movers_build(p_limit integer DEFAULT 5, p_min_sales integer DEFAULT 30)
 RETURNS jsonb
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
           sum(bat_usd_12m)::bigint AS u12, sum(bat_usd_prior_12m)::bigint AS up, max(as_of) AS as_of
    FROM public.mv_family_market
  ), e AS (
    SELECT f.*, ln((f.s12::numeric / f.sp) / (b.s12::numeric / b.sp)) AS lm, sqrt(1.0 / f.s12 + 1.0 / f.sp) AS se
    FROM f CROSS JOIN bat b
    WHERE f.sp >= greatest(p_min_sales, 1) AND f.s12 >= greatest(p_min_sales, 1) AND f.dated >= 0.5 * f.sold
      AND b.sp > 0 AND b.s12 > 0
  ), s AS (
    SELECT * FROM e WHERE abs(lm) >= 2 * se
  ), lst AS (
    SELECT lm, brand, family_key, jsonb_build_object(
             'brand', brand, 'family_key', family_key, 'family', family,
             'sold_12m', s12, 'sold_prior_12m', sp, 'usd_12m', u12, 'usd_prior_12m', up,
             'share_move', round(exp(lm) - 1, 4), 'share_lo', round(exp(lm - 2 * se) - 1, 4),
             'share_hi', round(exp(lm + 2 * se) - 1, 4), 'se', round(se, 4),
             'avg_price_move', CASE WHEN up > 0 AND u12 > 0 THEN round((u12::numeric / s12) / (up::numeric / sp) - 1, 4) END
           ) AS j
    FROM s
  )
  SELECT jsonb_build_object(
    'as_of', (SELECT as_of FROM bat),
    'min_sales', greatest(p_min_sales, 1),
    'bat', (SELECT jsonb_build_object('sold_12m', s12, 'sold_prior_12m', sp, 'usd_12m', u12, 'usd_prior_12m', up) FROM bat),
    'families', (SELECT count(*) FROM f),
    'eligible', (SELECT count(*) FROM e),
    'significant', (SELECT count(*) FROM s),
    'gaining', coalesce((SELECT jsonb_agg(j ORDER BY lm DESC, brand, family_key)
                         FROM (SELECT * FROM lst WHERE lm > 0 ORDER BY lm DESC, brand, family_key
                               LIMIT least(greatest(p_limit, 1), 25)) g), '[]'::jsonb),
    'losing', coalesce((SELECT jsonb_agg(j ORDER BY lm ASC, brand, family_key)
                        FROM (SELECT * FROM lst WHERE lm < 0 ORDER BY lm ASC, brand, family_key
                              LIMIT least(greatest(p_limit, 1), 25)) l), '[]'::jsonb))
$function$;
REVOKE ALL ON FUNCTION public.family_share_movers_build(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.family_share_movers_build(integer, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.family_share_movers_build(integer, integer) IS
  'The share movers computed now from mv_family_market (two scans of it): treemap_family_share_movers serves its '
  'stored value for the default eligibility and falls back to this. 2026-10-15.';

-- The value at the default eligibility, at most 25 a side, stored once a day after mv_family_market refreshes
-- (refresh-family-market 09:50Z, about 4 min): two scans of its 71,539 rows (35 MB) took 18.6 s and timed out for a
-- visitor under intake load (treemap_family_movers, 2026-10-15 15:2xZ), and the answer changes once a day.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_family_share_movers AS
  SELECT 1 AS id, public.family_share_movers_build(25, 30) AS value
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mv_family_share_movers_id ON public.mv_family_share_movers (id);
REVOKE ALL ON public.mv_family_share_movers FROM PUBLIC;
GRANT SELECT ON public.mv_family_share_movers TO anon, authenticated, service_role;
COMMENT ON MATERIALIZED VIEW public.mv_family_share_movers IS
  'family_share_movers_build(25, 30) as one row, refreshed daily at 10:05Z by refresh-family-share-movers.';

CREATE OR REPLACE FUNCTION public.treemap_family_share_movers(p_limit integer DEFAULT 5, p_min_sales integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- The stored value at the default eligibility, cut to p_limit a side; any other eligibility is computed now.
  SELECT CASE
    WHEN greatest(p_min_sales, 1) = 30 AND m.value IS NOT NULL THEN
      jsonb_set(jsonb_set(m.value,
        '{gaining}', coalesce((SELECT jsonb_agg(g ORDER BY o) FROM jsonb_array_elements(m.value->'gaining') WITH ORDINALITY x(g, o)
                               WHERE o <= least(greatest(p_limit, 1), 25)), '[]'::jsonb)),
        '{losing}', coalesce((SELECT jsonb_agg(l ORDER BY o) FROM jsonb_array_elements(m.value->'losing') WITH ORDINALITY y(l, o)
                              WHERE o <= least(greatest(p_limit, 1), 25)), '[]'::jsonb))
    ELSE public.family_share_movers_build(p_limit, p_min_sales)
  END
  FROM (SELECT (SELECT value FROM public.mv_family_share_movers WHERE id = 1) AS value) m
$function$;
REVOKE ALL ON FUNCTION public.treemap_family_share_movers(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_share_movers(integer, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.treemap_family_share_movers(integer, integer) IS
  'Named model families that gained or lost share of Bring a Trailer sales, last 12 months against the 12 before, '
  'listed when the move is at least 2 standard errors (Poisson, on the log of the ratio), with each move''s ±2 SE '
  'band and the move of its average sale apart from volume; eligibility as treemap_family_movers. One jsonb, from '
  'mv_family_share_movers at the default eligibility. 2026-10-15.';

DO $jobs$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-family-share-movers') THEN
    PERFORM cron.schedule('refresh-family-share-movers', '5 10 * * *',
      $cmd$SET statement_timeout = '5min'; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_share_movers$cmd$);
  END IF;
END $jobs$;

COMMIT;
