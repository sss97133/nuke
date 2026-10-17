-- Multi-horizon relativity & time-scale reader for FamilyMovers (2026-10-18).
--
-- Extends treemap_family_share_movers and family_share_movers_build with a 3-argument overload accepting p_horizon:
--   'upcoming' : next 30d live BaT + scheduled auction calendar lots against past 30d measured sales
--   '1d'       : last 24h sold events against the prior 24h (with mv_family_sales daily fallback)
--   '1w'       : last 7d measured sales against the prior 7d
--   '1m'       : last 30d measured sales against the prior 30d
--   '3m'       : last 90d measured sales against the prior 90d
--   '6m'       : last 180d measured sales against the prior 180d
--   '1y'       : last 365d measured sales against the prior 365d (default)
--   '5y'       : last 1,825d measured sales against the prior 1,825d
--
-- Preserves the 2-argument family_share_movers_build(integer, integer) and treemap_family_share_movers(integer, integer)
-- signatures and mv_family_share_movers id = 1 contract unchanged. Stores all 8 horizons in mv_family_share_movers
-- (ids 1..8) and adds a covering sale_date index on mv_family_sales so date-bounded horizon builds use index-only scans.
-- Contracts: supabase/sql/test_family_share_movers.sql, supabase/sql/test_family_horizon_movers.sql.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.mv_family_market') IS NULL THEN
    RAISE EXCEPTION 'mv_family_market is missing; apply 20261015131500_family_market_fold.sql first';
  END IF;
END $guard$;

DO $idx$
BEGIN
  IF to_regclass('public.mv_family_sales') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS mv_family_sales_sale_date ON public.mv_family_sales (sale_date DESC) INCLUDE (brand, family_key, usd, source)';
  END IF;
END $idx$;

CREATE OR REPLACE FUNCTION public.family_share_movers_build(
  p_limit integer,
  p_min_sales integer,
  p_horizon text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_h text := lower(trim(coalesce(p_horizon, '1y')));
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 25);
  v_days integer;
  v_min integer;
  v_min_z numeric;
  v_anchor date;
  v_live_24h bigint := 0;
  v_out jsonb;
BEGIN
  IF v_h NOT IN ('upcoming', '1d', '1w', '1m', '3m', '6m', '1y', '5y') THEN
    v_h := '1y';
  END IF;

  v_days := CASE v_h
    WHEN 'upcoming' THEN 30
    WHEN '1d'       THEN 1
    WHEN '1w'       THEN 7
    WHEN '1m'       THEN 30
    WHEN '3m'       THEN 90
    WHEN '6m'       THEN 180
    WHEN '1y'       THEN 365
    WHEN '5y'       THEN 1825
    ELSE 365
  END;

  v_min := CASE
    WHEN p_min_sales IS NOT NULL AND p_min_sales > 0 THEN p_min_sales
    WHEN v_h = 'upcoming' THEN 4
    WHEN v_h = '1d'       THEN 1
    WHEN v_h = '1w'       THEN 2
    WHEN v_h = '1m'       THEN 5
    WHEN v_h = '3m'       THEN 10
    WHEN v_h = '6m'       THEN 20
    WHEN v_h = '1y'       THEN 30
    WHEN v_h = '5y'       THEN 50
    ELSE 30
  END;

  v_min_z := CASE v_h
    WHEN 'upcoming' THEN 1.28
    WHEN '1d'       THEN 0.80
    WHEN '1w'       THEN 1.00
    WHEN '1m'       THEN 1.50
    WHEN '3m'       THEN 1.65
    ELSE 2.00
  END;

  -- When mv_family_sales is absent (e.g. minimal 2-arg contract fixtures) or 1y is requested without mv_family_sales,
  -- fall back to the 2-arg mv_family_market builder.
  IF to_regclass('public.mv_family_sales') IS NULL THEN
    RETURN public.family_share_movers_build(v_limit, v_min)
      || jsonb_build_object('horizon', v_h, 'window_days', v_days);
  END IF;

  IF v_h = '1y' THEN
    RETURN public.family_share_movers_build(v_limit, v_min)
      || jsonb_build_object('horizon', '1y', 'window_days', 365);
  END IF;

  SELECT coalesce(max(sale_date), current_date)
    INTO v_anchor
    FROM public.mv_family_sales
   WHERE sale_date <= current_date;

  -- 1) UPCOMING: next 30d live BaT + scheduled auction calendar lots against past 30d measured sales.
  IF v_h = 'upcoming'
     AND to_regclass('public.mv_model_family_names') IS NOT NULL
     AND to_regclass('public.market_pulse_live_snapshot') IS NOT NULL
     AND to_regclass('public.mv_auction_calendar_lots') IS NOT NULL THEN

    WITH f_names AS MATERIALIZED (
      SELECT brand, family_key, max(family) AS family
      FROM public.mv_family_market
      WHERE family_key <> 'other'
      GROUP BY brand, family_key
    ),
    mfn AS MATERIALIZED (
      SELECT DISTINCT ON (brand, lower(trim(model)))
        brand, lower(trim(model)) AS model_norm, family_key
      FROM public.mv_model_family_names
      ORDER BY brand, lower(trim(model)), count DESC
    ),
    upcoming_lots AS MATERIALIZED (
      SELECT
        s.make AS brand,
        coalesce(m.family_key, 'other') AS family_key,
        CASE WHEN s.current_bid > 0 THEN s.current_bid::numeric ELSE NULL END AS usd,
        coalesce(s.auction_end::date, v_anchor + 3) AS dt
      FROM public.market_pulse_live_snapshot s
      LEFT JOIN mfn m ON m.brand = s.make AND m.model_norm = lower(trim(s.model))
      WHERE s.make IS NOT NULL
        AND (s.auction_end IS NULL OR (s.auction_end >= now() AND s.auction_end <= now() + interval '30 days'))
      UNION ALL
      SELECT
        c.make AS brand,
        coalesce(m.family_key, 'other') AS family_key,
        coalesce(
          CASE WHEN c.lot_estimate_low > 0 AND c.lot_estimate_high > 0 THEN ((c.lot_estimate_low + c.lot_estimate_high) / 2.0)::numeric
               WHEN c.lot_estimate_low > 0 THEN c.lot_estimate_low::numeric
               WHEN c.lot_estimate_high > 0 THEN c.lot_estimate_high::numeric
               WHEN c.current_bid > 0 THEN c.current_bid::numeric
               ELSE NULL END,
          NULL
        ) AS usd,
        coalesce(c.auction_start_date, c.created_at::date) AS dt
      FROM public.mv_auction_calendar_lots c
      LEFT JOIN mfn m ON m.brand = c.make AND m.model_norm = lower(trim(c.model))
      WHERE c.make IS NOT NULL
        AND coalesce(c.auction_start_date, c.created_at::date) >= v_anchor
        AND coalesce(c.auction_start_date, c.created_at::date) <= v_anchor + 30
    ),
    past_30d AS MATERIALIZED (
      SELECT brand, family_key, usd, sale_date AS dt
      FROM public.mv_family_sales
      WHERE sale_date > v_anchor - 30 AND sale_date <= v_anchor
    ),
    f AS MATERIALIZED (
      SELECT
        fn.brand,
        fn.family_key,
        fn.family,
        coalesce(u.s12, 0)::bigint AS s12,
        coalesce(p.sp, 0)::bigint AS sp,
        coalesce(u.u12, 0)::bigint AS u12,
        coalesce(p.up, 0)::bigint AS up
      FROM f_names fn
      LEFT JOIN (
        SELECT brand, family_key, count(*)::bigint AS s12, coalesce(sum(usd), 0)::bigint AS u12
        FROM upcoming_lots WHERE family_key <> 'other' GROUP BY brand, family_key
      ) u ON u.brand = fn.brand AND u.family_key = fn.family_key
      LEFT JOIN (
        SELECT brand, family_key, count(*)::bigint AS sp, coalesce(sum(usd), 0)::bigint AS up
        FROM past_30d WHERE family_key <> 'other' GROUP BY brand, family_key
      ) p ON p.brand = fn.brand AND p.family_key = fn.family_key
      WHERE coalesce(u.s12, 0) > 0 OR coalesce(p.sp, 0) > 0
    ),
    bat AS MATERIALIZED (
      SELECT
        (SELECT count(*)::bigint FROM upcoming_lots) AS s12,
        (SELECT count(*)::bigint FROM past_30d) AS sp,
        (SELECT coalesce(sum(usd), 0)::bigint FROM upcoming_lots) AS u12,
        (SELECT coalesce(sum(usd), 0)::bigint FROM past_30d) AS up,
        now() AS as_of
    ),
    e AS MATERIALIZED (
      SELECT
        f.*,
        ln((f.s12::numeric / f.sp) / (b.s12::numeric / b.sp)) AS lm,
        sqrt(1.0 / f.s12 + 1.0 / f.sp) AS se
      FROM f CROSS JOIN bat b
      WHERE f.sp >= v_min AND f.s12 >= v_min
        AND b.sp > 0 AND b.s12 > 0
    ),
    s AS MATERIALIZED (
      SELECT * FROM e WHERE abs(lm) >= v_min_z * se
    ),
    top_g AS MATERIALIZED (
      SELECT * FROM s WHERE lm > 0 ORDER BY lm DESC, brand, family_key LIMIT v_limit
    ),
    top_l AS MATERIALIZED (
      SELECT * FROM s WHERE lm < 0 ORDER BY lm ASC, brand, family_key LIMIT v_limit
    ),
    picked AS MATERIALIZED (
      SELECT brand, family_key FROM top_g
      UNION
      SELECT brand, family_key FROM top_l
    ),
    bin_counts AS MATERIALIZED (
      SELECT brand, family_key, b_idx, sum(cnt)::bigint AS cnt
      FROM (
        SELECT p30.brand, p30.family_key,
               least(11, greatest(0, floor(((p30.dt - (v_anchor - 29))::numeric / 30.0) * 12)::int)) AS b_idx,
               count(*)::bigint AS cnt
        FROM past_30d p30
        JOIN picked pk ON pk.brand = p30.brand AND pk.family_key = p30.family_key
        GROUP BY p30.brand, p30.family_key, 3
        UNION ALL
        SELECT u30.brand, u30.family_key,
               12 + least(11, greatest(0, floor(((u30.dt - v_anchor)::numeric / 30.0) * 12)::int)) AS b_idx,
               count(*)::bigint AS cnt
        FROM upcoming_lots u30
        JOIN picked pk ON pk.brand = u30.brand AND pk.family_key = u30.family_key
        GROUP BY u30.brand, u30.family_key, 3
      ) raw_bins
      GROUP BY brand, family_key, b_idx
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
      'horizon', 'upcoming',
      'window_days', 30,
      'min_sales', v_min,
      'bat', (SELECT jsonb_build_object('sold_12m', s12, 'sold_prior_12m', sp, 'usd_12m', u12, 'usd_prior_12m', up) FROM bat),
      'families', (SELECT count(*) FROM f),
      'eligible', (SELECT count(*) FROM e),
      'significant', (SELECT count(*) FROM s),
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
    ) INTO v_out;

    RETURN v_out;
  END IF;

  -- 2) 1D: Live 24h sold vehicle_events against prior 24h when at least 10 live sales exist,
  --    falling back to mv_family_sales (v_anchor vs v_anchor - 1).
  IF v_h = '1d'
     AND to_regclass('public.vehicle_events') IS NOT NULL
     AND to_regclass('public.vehicles') IS NOT NULL
     AND to_regclass('public.mv_model_family_names') IS NOT NULL THEN
    SELECT count(*)
      INTO v_live_24h
      FROM public.vehicle_events ve
     WHERE ve.event_status = 'sold'
       AND ve.ended_at > now() - interval '24 hours'
       AND ve.ended_at <= now();
  END IF;

  IF v_h = '1d' AND v_live_24h >= 10 THEN
    WITH f_names AS MATERIALIZED (
      SELECT brand, family_key, max(family) AS family
      FROM public.mv_family_market
      WHERE family_key <> 'other'
      GROUP BY brand, family_key
    ),
    mfn AS MATERIALIZED (
      SELECT DISTINCT ON (brand, lower(trim(model)))
        brand, lower(trim(model)) AS model_norm, family_key
      FROM public.mv_model_family_names
      ORDER BY brand, lower(trim(model)), count DESC
    ),
    ev AS MATERIALIZED (
      SELECT
        v.make AS brand,
        coalesce(m.family_key, 'other') AS family_key,
        CASE WHEN ve.amount > 0 AND ve.amount < 50000000 THEN ve.amount::numeric ELSE NULL END AS usd,
        ve.ended_at,
        CASE WHEN ve.ended_at > now() - interval '24 hours' THEN 1 ELSE 0 END AS is_recent
      FROM public.vehicle_events ve
      JOIN public.vehicles v ON v.id = ve.vehicle_id
      LEFT JOIN mfn m ON m.brand = v.make AND m.model_norm = lower(trim(v.model))
      WHERE ve.event_status = 'sold'
        AND ve.ended_at > now() - interval '48 hours'
        AND ve.ended_at <= now()
        AND v.make IS NOT NULL
    ),
    agg AS MATERIALIZED (
      SELECT
        brand,
        family_key,
        count(*) FILTER (WHERE is_recent = 1)::bigint AS s12,
        count(*) FILTER (WHERE is_recent = 0)::bigint AS sp,
        coalesce(sum(usd) FILTER (WHERE is_recent = 1), 0)::bigint AS u12,
        coalesce(sum(usd) FILTER (WHERE is_recent = 0), 0)::bigint AS up
      FROM ev
      GROUP BY brand, family_key
    ),
    f AS MATERIALIZED (
      SELECT fn.brand, fn.family_key, fn.family, a.s12, a.sp, a.u12, a.up
      FROM agg a
      JOIN f_names fn ON fn.brand = a.brand AND fn.family_key = a.family_key
      WHERE a.family_key <> 'other'
    ),
    bat AS MATERIALIZED (
      SELECT
        coalesce(sum(s12), 0)::bigint AS s12,
        coalesce(sum(sp), 0)::bigint AS sp,
        coalesce(sum(u12), 0)::bigint AS u12,
        coalesce(sum(up), 0)::bigint AS up,
        now() AS as_of
      FROM agg
    ),
    e AS MATERIALIZED (
      SELECT
        f.*,
        ln((f.s12::numeric / f.sp) / (b.s12::numeric / b.sp)) AS lm,
        sqrt(1.0 / f.s12 + 1.0 / f.sp) AS se
      FROM f CROSS JOIN bat b
      WHERE f.sp >= v_min AND f.s12 >= v_min
        AND (f.s12 + f.sp) >= greatest(3, v_min * 2)
        AND b.sp > 0 AND b.s12 > 0
    ),
    s AS MATERIALIZED (
      SELECT * FROM e WHERE abs(lm) >= v_min_z * se
    ),
    top_g AS MATERIALIZED (
      SELECT * FROM s WHERE lm > 0 ORDER BY lm DESC, brand, family_key LIMIT v_limit
    ),
    top_l AS MATERIALIZED (
      SELECT * FROM s WHERE lm < 0 ORDER BY lm ASC, brand, family_key LIMIT v_limit
    ),
    picked AS MATERIALIZED (
      SELECT brand, family_key FROM top_g
      UNION
      SELECT brand, family_key FROM top_l
    ),
    bin_counts AS MATERIALIZED (
      SELECT
        ev.brand,
        ev.family_key,
        least(23, greatest(0, floor((extract(epoch FROM (ev.ended_at - (now() - interval '48 hours'))) / 172800.0) * 24)::int)) AS b_idx,
        count(*)::bigint AS cnt
      FROM ev
      JOIN picked pk ON pk.brand = ev.brand AND pk.family_key = ev.family_key
      GROUP BY ev.brand, ev.family_key, 3
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
      'horizon', '1d',
      'window_days', 1,
      'min_sales', v_min,
      'bat', (SELECT jsonb_build_object('sold_12m', s12, 'sold_prior_12m', sp, 'usd_12m', u12, 'usd_prior_12m', up) FROM bat),
      'families', (SELECT count(*) FROM f),
      'eligible', (SELECT count(*) FROM e),
      'significant', (SELECT count(*) FROM s),
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
    ) INTO v_out;

    RETURN v_out;
  END IF;

  -- 3) Historical date-window horizons on mv_family_sales ('1d' fallback, '1w', '1m', '3m', '6m', '5y', or 'upcoming' fallback):
  --    Uses EXECUTE format with literal dates/integers so PostgreSQL plans index scans on mv_family_sales_sale_date
  --    and mv_family_sales_family_date.
  EXECUTE format($dyn$
    WITH f_names AS MATERIALIZED (
      SELECT brand, family_key, max(family) AS family
      FROM public.mv_family_market
      WHERE family_key <> 'other'
      GROUP BY brand, family_key
    ),
    agg AS MATERIALIZED (
      SELECT
        s.brand,
        s.family_key,
        count(*) FILTER (WHERE s.sale_date > (%1$L::date - %2$s))::bigint AS s12,
        count(*) FILTER (WHERE s.sale_date <= (%1$L::date - %2$s))::bigint AS sp,
        coalesce(sum(s.usd) FILTER (WHERE s.sale_date > (%1$L::date - %2$s)), 0)::bigint AS u12,
        coalesce(sum(s.usd) FILTER (WHERE s.sale_date <= (%1$L::date - %2$s)), 0)::bigint AS up
      FROM public.mv_family_sales s
      WHERE s.sale_date > (%1$L::date - %3$s)
        AND s.sale_date <= %1$L::date
      GROUP BY s.brand, s.family_key
    ),
    f AS MATERIALIZED (
      SELECT fn.brand, fn.family_key, fn.family, a.s12, a.sp, a.u12, a.up
      FROM agg a
      JOIN f_names fn ON fn.brand = a.brand AND fn.family_key = a.family_key
      WHERE a.family_key <> 'other'
    ),
    bat AS MATERIALIZED (
      SELECT
        coalesce(sum(s12), 0)::bigint AS s12,
        coalesce(sum(sp), 0)::bigint AS sp,
        coalesce(sum(u12), 0)::bigint AS u12,
        coalesce(sum(up), 0)::bigint AS up,
        (SELECT max(as_of) FROM public.mv_family_market) AS as_of
      FROM agg
    ),
    e AS MATERIALIZED (
      SELECT
        f.*,
        ln((f.s12::numeric / f.sp) / (b.s12::numeric / b.sp)) AS lm,
        sqrt(1.0 / f.s12 + 1.0 / f.sp) AS se
      FROM f CROSS JOIN bat b
      WHERE f.sp >= %4$s AND f.s12 >= %4$s
        AND b.sp > 0 AND b.s12 > 0
    ),
    s AS MATERIALIZED (
      SELECT * FROM e WHERE abs(lm) >= %5$s * se
    ),
    top_g AS MATERIALIZED (
      SELECT * FROM s WHERE lm > 0 ORDER BY lm DESC, brand, family_key LIMIT %6$s
    ),
    top_l AS MATERIALIZED (
      SELECT * FROM s WHERE lm < 0 ORDER BY lm ASC, brand, family_key LIMIT %6$s
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
          WHEN %2$s = 1 THEN
            least(23, greatest(0, (23 - (%1$L::date - ms.sale_date))::int))
          WHEN ms.sale_date <= (%1$L::date - %2$s) THEN
            least(11, greatest(0, floor(((ms.sale_date - (%1$L::date - %3$s + 1))::numeric / greatest(%2$s, 1)::numeric) * 12)::int))
          ELSE
            12 + least(11, greatest(0, floor(((ms.sale_date - (%1$L::date - %2$s + 1))::numeric / greatest(%2$s, 1)::numeric) * 12)::int))
        END AS b_idx,
        count(*)::bigint AS cnt
      FROM picked pk
      JOIN public.mv_family_sales ms
        ON ms.brand = pk.brand
       AND ms.family_key = pk.family_key
       AND ms.sale_date > (%1$L::date - CASE WHEN %2$s = 1 THEN 24 ELSE %3$s END)
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
      'horizon', %7$L,
      'window_days', %2$s,
      'min_sales', %4$s,
      'bat', (SELECT jsonb_build_object('sold_12m', s12, 'sold_prior_12m', sp, 'usd_12m', u12, 'usd_prior_12m', up) FROM bat),
      'families', (SELECT count(*) FROM f),
      'eligible', (SELECT count(*) FROM e),
      'significant', (SELECT count(*) FROM s),
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
  $dyn$, v_anchor, v_days, v_days * 2, v_min, v_min_z, v_limit, v_h)
  INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.family_share_movers_build(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.family_share_movers_build(integer, integer, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.family_share_movers_build(integer, integer, text) IS
  'Multi-horizon share movers builder across upcoming, 1d, 1w, 1m, 3m, 6m, 1y, and 5y scales, with 24 sparkline bins '
  'per mover. 2026-10-18.';

-- Rebuild mv_family_share_movers to hold all 8 horizons (id = 1..8) while keeping id = 1 identical to
-- family_share_movers_build(25, 30) for backward compatibility.
DROP MATERIALIZED VIEW IF EXISTS public.mv_family_share_movers;
CREATE MATERIALIZED VIEW public.mv_family_share_movers AS
  SELECT 1 AS id, public.family_share_movers_build(25, 30) AS value
  UNION ALL
  SELECT 2 AS id, public.family_share_movers_build(25, 50, '5y') AS value
  UNION ALL
  SELECT 3 AS id, public.family_share_movers_build(25, 20, '6m') AS value
  UNION ALL
  SELECT 4 AS id, public.family_share_movers_build(25, 10, '3m') AS value
  UNION ALL
  SELECT 5 AS id, public.family_share_movers_build(25, 5, '1m') AS value
  UNION ALL
  SELECT 6 AS id, public.family_share_movers_build(25, 2, '1w') AS value
  UNION ALL
  SELECT 7 AS id, public.family_share_movers_build(25, 1, '1d') AS value
  UNION ALL
  SELECT 8 AS id, public.family_share_movers_build(25, 4, 'upcoming') AS value
WITH DATA;
CREATE UNIQUE INDEX mv_family_share_movers_id ON public.mv_family_share_movers (id);
REVOKE ALL ON public.mv_family_share_movers FROM PUBLIC;
GRANT SELECT ON public.mv_family_share_movers TO anon, authenticated, service_role;
COMMENT ON MATERIALIZED VIEW public.mv_family_share_movers IS
  'Precomputed share movers across all 8 horizons (id 1=1y, 2=5y, 3=6m, 4=3m, 5=1m, 6=1w, 7=1d, 8=upcoming), '
  'refreshed daily at 10:05Z by refresh-family-share-movers.';

CREATE OR REPLACE FUNCTION public.treemap_family_share_movers(
  p_limit integer,
  p_min_sales integer,
  p_horizon text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_h text := lower(trim(coalesce(p_horizon, '1y')));
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 25);
  v_default_min integer;
  v_req_min integer;
  v_id integer;
  v_stored jsonb;
BEGIN
  IF v_h NOT IN ('upcoming', '1d', '1w', '1m', '3m', '6m', '1y', '5y') THEN
    v_h := '1y';
  END IF;

  v_default_min := CASE v_h
    WHEN 'upcoming' THEN 4
    WHEN '1d'       THEN 1
    WHEN '1w'       THEN 2
    WHEN '1m'       THEN 5
    WHEN '3m'       THEN 10
    WHEN '6m'       THEN 20
    WHEN '1y'       THEN 30
    WHEN '5y'       THEN 50
    ELSE 30
  END;

  v_req_min := CASE
    WHEN p_min_sales IS NULL OR p_min_sales <= 0 THEN v_default_min
    ELSE p_min_sales
  END;

  v_id := CASE v_h
    WHEN '1y'       THEN 1
    WHEN '5y'       THEN 2
    WHEN '6m'       THEN 3
    WHEN '3m'       THEN 4
    WHEN '1m'       THEN 5
    WHEN '1w'       THEN 6
    WHEN '1d'       THEN 7
    WHEN 'upcoming' THEN 8
    ELSE 1
  END;

  IF v_req_min = v_default_min THEN
    SELECT value INTO v_stored FROM public.mv_family_share_movers WHERE id = v_id;
    -- For 1d and upcoming, if the stored snapshot is older than 1 hour and live tables exist, compute fresh.
    IF v_stored IS NOT NULL AND v_h IN ('1d', 'upcoming') THEN
      BEGIN
        IF ((v_stored->>'as_of')::timestamptz < now() - interval '1 hour') THEN
          v_stored := NULL;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    IF v_stored IS NOT NULL THEN
      RETURN jsonb_set(
        jsonb_set(
          v_stored || jsonb_build_object('horizon', v_h),
          '{gaining}',
          coalesce((
            SELECT jsonb_agg(g ORDER BY o)
            FROM jsonb_array_elements(v_stored->'gaining') WITH ORDINALITY x(g, o)
            WHERE o <= v_limit
          ), '[]'::jsonb)
        ),
        '{losing}',
        coalesce((
          SELECT jsonb_agg(l ORDER BY o)
          FROM jsonb_array_elements(v_stored->'losing') WITH ORDINALITY y(l, o)
          WHERE o <= v_limit
        ), '[]'::jsonb)
      );
    END IF;
  END IF;

  RETURN public.family_share_movers_build(v_limit, v_req_min, v_h);
END;
$function$;

REVOKE ALL ON FUNCTION public.treemap_family_share_movers(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_share_movers(integer, integer, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.treemap_family_share_movers(integer, integer, text) IS
  'Multi-horizon model family share movers reader across upcoming, 1d, 1w, 1m, 3m, 6m, 1y, and 5y scales. Serves from '
  'mv_family_share_movers at default eligibility (recomputing 1d/upcoming when older than 1 hour) and includes 24 '
  'sparkline bins per mover. 2026-10-18.';

COMMIT;
