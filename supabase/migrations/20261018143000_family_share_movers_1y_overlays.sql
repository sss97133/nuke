-- Populate brand_moves, family_moves, horizon metadata, and 24-bin sparklines on the 2-argument
-- family_share_movers_build(p_limit, p_min_sales) and mv_family_share_movers row id = 1 ('1y').
--
-- Previously, mv_family_share_movers row id = 1 called the 2-argument family_share_movers_build(25, 30),
-- which omitted brand_moves, family_moves, horizon, window_days, and 24-bin sparklines. As a result:
--   1. The default 1Y horizon on /market lacked 24-bin sparklines on its gaining/losing rows.
--   2. Dual-window VS comparisons involving 1Y (e.g. 1M VS 1Y, 3M VS 1Y, 6M VS 1Y, 5Y VS 1Y, or 1Y VS 5Y)
--      received empty brand_moves and family_moves from the cached 1Y row, collapsing the baseline
--      comparison to only the 10 listed movers instead of all ~1,850 families and ~1,260 brands.
--
-- Contract: supabase/sql/test_family_horizon_movers.sql.

BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.mv_family_market') IS NULL THEN
    RAISE EXCEPTION 'mv_family_market is missing; apply 20261015131500_family_market_fold.sql first';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.family_share_movers_build(
  p_limit integer DEFAULT 5,
  p_min_sales integer DEFAULT 30
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 25);
  v_min integer := greatest(coalesce(p_min_sales, 30), 1);
  v_anchor date;
  v_out jsonb;
BEGIN
  IF to_regclass('public.mv_family_sales') IS NOT NULL THEN
    SELECT coalesce(max(sale_date), current_date)
      INTO v_anchor
      FROM public.mv_family_sales
     WHERE sale_date <= current_date;

    EXECUTE format($dyn$
      WITH f AS MATERIALIZED (
        SELECT brand, family_key, max(family) AS family, sum(sold) AS sold, sum(bat_dated) AS dated,
               sum(bat_sold_12m)::bigint AS s12, sum(bat_sold_prior_12m)::bigint AS sp,
               sum(bat_usd_12m)::bigint AS u12, sum(bat_usd_prior_12m)::bigint AS up, max(as_of) AS as_of
        FROM public.mv_family_market
        WHERE family_key <> 'other'
        GROUP BY brand, family_key
      ),
      brand_agg AS MATERIALIZED (
        SELECT brand,
               sum(bat_sold_12m)::bigint AS s12,
               sum(bat_sold_prior_12m)::bigint AS sp,
               sum(bat_usd_12m)::bigint AS u12,
               sum(bat_usd_prior_12m)::bigint AS up
        FROM public.mv_family_market
        GROUP BY brand
        HAVING sum(bat_sold_12m) > 0 OR sum(bat_sold_prior_12m) > 0
      ),
      bat AS MATERIALIZED (
        SELECT sum(bat_sold_12m)::bigint AS s12, sum(bat_sold_prior_12m)::bigint AS sp,
               sum(bat_usd_12m)::bigint AS u12, sum(bat_usd_prior_12m)::bigint AS up, max(as_of) AS as_of
        FROM public.mv_family_market
      ),
      e AS MATERIALIZED (
        SELECT f.*, ln((f.s12::numeric / f.sp) / (b.s12::numeric / b.sp)) AS lm, sqrt(1.0 / f.s12 + 1.0 / f.sp) AS se
        FROM f CROSS JOIN bat b
        WHERE f.sp >= %2$s AND f.s12 >= %2$s AND f.dated >= 0.5 * f.sold
          AND b.sp > 0 AND b.s12 > 0
      ),
      s AS MATERIALIZED (
        SELECT * FROM e WHERE abs(lm) >= 2 * se
      ),
      top_g AS MATERIALIZED (
        SELECT * FROM s WHERE lm > 0 ORDER BY lm DESC, brand, family_key LIMIT %3$s
      ),
      top_l AS MATERIALIZED (
        SELECT * FROM s WHERE lm < 0 ORDER BY lm ASC, brand, family_key LIMIT %3$s
      ),
      picked AS MATERIALIZED (
        SELECT brand, family_key FROM top_g
        UNION
        SELECT brand, family_key FROM top_l
      ),
      bin_counts AS MATERIALIZED (
        SELECT
          ms.brand,
          ms.family_key,
          CASE
            WHEN ms.sale_date <= (%1$L::date - 365) THEN
              least(11, greatest(0, floor(((ms.sale_date - (%1$L::date - 730 + 1))::numeric / 365.0) * 12)::int))
            ELSE
              12 + least(11, greatest(0, floor(((ms.sale_date - (%1$L::date - 365 + 1))::numeric / 365.0) * 12)::int))
          END AS b_idx,
          count(*)::bigint AS cnt
        FROM picked pk
        JOIN public.mv_family_sales ms
          ON ms.brand = pk.brand
         AND ms.family_key = pk.family_key
         AND ms.sale_date > (%1$L::date - 730)
         AND ms.sale_date <= %1$L::date
        GROUP BY ms.brand, ms.family_key, 3
      ),
      family_bins AS MATERIALIZED (
        SELECT pk.brand, pk.family_key,
               jsonb_agg(coalesce(bc.cnt, 0) ORDER BY gs.i) AS bins
        FROM picked pk
        CROSS JOIN generate_series(0, 23) AS gs(i)
        LEFT JOIN bin_counts bc
          ON bc.brand = pk.brand AND bc.family_key = pk.family_key AND bc.b_idx = gs.i
        GROUP BY pk.brand, pk.family_key
      )
      SELECT jsonb_build_object(
        'as_of', (SELECT as_of FROM bat),
        'horizon', '1y',
        'window_days', 365,
        'min_sales', %2$s,
        'bat', (SELECT jsonb_build_object('sold_12m', s12, 'sold_prior_12m', sp, 'usd_12m', u12, 'usd_prior_12m', up) FROM bat),
        'families', (SELECT count(*) FROM f),
        'eligible', (SELECT count(*) FROM e),
        'significant', (SELECT count(*) FROM s),
        'brand_moves', coalesce((
          SELECT jsonb_object_agg(brand, jsonb_build_array(s12, sp, u12, up)) FROM brand_agg
        ), '{}'::jsonb),
        'family_moves', coalesce((
          SELECT jsonb_object_agg(brand || '|' || family_key, jsonb_build_array(s12, sp, u12, up))
          FROM f
          WHERE s12 > 0 OR sp > 0
        ), '{}'::jsonb),
        'gaining', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'brand', g.brand, 'family_key', g.family_key, 'family', g.family,
            'sold_12m', g.s12, 'sold_prior_12m', g.sp, 'usd_12m', g.u12, 'usd_prior_12m', g.up,
            'share_move', round(exp(g.lm) - 1, 4),
            'share_lo', round(exp(g.lm - 2 * g.se) - 1, 4),
            'share_hi', round(exp(g.lm + 2 * g.se) - 1, 4),
            'se', round(g.se, 4),
            'avg_price_move', CASE WHEN g.up > 0 AND g.u12 > 0 THEN round((g.u12::numeric / g.s12) / (g.up::numeric / g.sp) - 1, 4) END,
            'bins', coalesce(fb.bins, '[]'::jsonb)
          ) ORDER BY g.lm DESC, g.brand, g.family_key)
          FROM top_g g
          LEFT JOIN family_bins fb ON fb.brand = g.brand AND fb.family_key = g.family_key
        ), '[]'::jsonb),
        'losing', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'brand', l.brand, 'family_key', l.family_key, 'family', l.family,
            'sold_12m', l.s12, 'sold_prior_12m', l.sp, 'usd_12m', l.u12, 'usd_prior_12m', l.up,
            'share_move', round(exp(l.lm) - 1, 4),
            'share_lo', round(exp(l.lm - 2 * l.se) - 1, 4),
            'share_hi', round(exp(l.lm + 2 * l.se) - 1, 4),
            'se', round(l.se, 4),
            'avg_price_move', CASE WHEN l.up > 0 AND l.u12 > 0 THEN round((l.u12::numeric / l.s12) / (l.up::numeric / l.sp) - 1, 4) END,
            'bins', coalesce(fb.bins, '[]'::jsonb)
          ) ORDER BY l.lm ASC, l.brand, l.family_key)
          FROM top_l l
          LEFT JOIN family_bins fb ON fb.brand = l.brand AND fb.family_key = l.family_key
        ), '[]'::jsonb)
      )
    $dyn$, v_anchor, v_min, v_limit) INTO v_out;

    RETURN v_out;
  END IF;

  -- Fallback when mv_family_sales is absent (disposable minimal contract tests):
  WITH f AS (
    SELECT brand, family_key, max(family) AS family, sum(sold) AS sold, sum(bat_dated) AS dated,
           sum(bat_sold_12m)::bigint AS s12, sum(bat_sold_prior_12m)::bigint AS sp,
           sum(bat_usd_12m)::bigint AS u12, sum(bat_usd_prior_12m)::bigint AS up, max(as_of) AS as_of
    FROM public.mv_family_market
    WHERE family_key <> 'other'
    GROUP BY brand, family_key
  ),
  brand_agg AS (
    SELECT brand,
           sum(bat_sold_12m)::bigint AS s12,
           sum(bat_sold_prior_12m)::bigint AS sp,
           sum(bat_usd_12m)::bigint AS u12,
           sum(bat_usd_prior_12m)::bigint AS up
    FROM public.mv_family_market
    GROUP BY brand
    HAVING sum(bat_sold_12m) > 0 OR sum(bat_sold_prior_12m) > 0
  ),
  bat AS (
    SELECT sum(bat_sold_12m)::bigint AS s12, sum(bat_sold_prior_12m)::bigint AS sp,
           sum(bat_usd_12m)::bigint AS u12, sum(bat_usd_prior_12m)::bigint AS up, max(as_of) AS as_of
    FROM public.mv_family_market
  ),
  e AS (
    SELECT f.*, ln((f.s12::numeric / f.sp) / (b.s12::numeric / b.sp)) AS lm, sqrt(1.0 / f.s12 + 1.0 / f.sp) AS se
    FROM f CROSS JOIN bat b
    WHERE f.sp >= v_min AND f.s12 >= v_min AND f.dated >= 0.5 * f.sold
      AND b.sp > 0 AND b.s12 > 0
  ),
  s AS (
    SELECT * FROM e WHERE abs(lm) >= 2 * se
  ),
  lst AS (
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
    'horizon', '1y',
    'window_days', 365,
    'min_sales', v_min,
    'bat', (SELECT jsonb_build_object('sold_12m', s12, 'sold_prior_12m', sp, 'usd_12m', u12, 'usd_prior_12m', up) FROM bat),
    'families', (SELECT count(*) FROM f),
    'eligible', (SELECT count(*) FROM e),
    'significant', (SELECT count(*) FROM s),
    'brand_moves', coalesce((
      SELECT jsonb_object_agg(brand, jsonb_build_array(s12, sp, u12, up)) FROM brand_agg
    ), '{}'::jsonb),
    'family_moves', coalesce((
      SELECT jsonb_object_agg(brand || '|' || family_key, jsonb_build_array(s12, sp, u12, up))
      FROM f
      WHERE s12 > 0 OR sp > 0
    ), '{}'::jsonb),
    'gaining', coalesce((SELECT jsonb_agg(j ORDER BY lm DESC, brand, family_key)
                         FROM (SELECT * FROM lst WHERE lm > 0 ORDER BY lm DESC, brand, family_key
                               LIMIT v_limit) g), '[]'::jsonb),
    'losing', coalesce((SELECT jsonb_agg(j ORDER BY lm ASC, brand, family_key)
                        FROM (SELECT * FROM lst WHERE lm < 0 ORDER BY lm ASC, brand, family_key
                              LIMIT v_limit) l), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.family_share_movers_build(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.family_share_movers_build(integer, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.family_share_movers_build(integer, integer) IS
  'The 1Y share movers computed from mv_family_market with brand_moves, family_moves, and 24-bin sparklines from '
  'mv_family_sales: served from mv_family_share_movers (id = 1) at default eligibility. 2026-10-18.';

-- Refresh mv_family_share_movers so row id = 1 ('1y') immediately carries brand_moves, family_moves, and 24-bin sparklines.
REFRESH MATERIALIZED VIEW public.mv_family_share_movers;

COMMIT;
