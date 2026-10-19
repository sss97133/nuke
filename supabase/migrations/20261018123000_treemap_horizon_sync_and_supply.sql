-- Sync treemap horizon overlays, FB Marketplace / classified supply in UPCOMING & 1D,
-- family upcoming supply & model-33 finish-estimate reader, and hourly movers cron (2026-10-18).
--
-- 1) Extends family_share_movers_build(p_limit, p_min_sales, p_horizon) so:
--    - 'upcoming' includes active Facebook Marketplace listings (public.marketplace_listings)
--      alongside live Bring a Trailer lots and scheduled auction calendar lots, and exposes
--      `sources: { bat_live, auction_calendar, facebook_marketplace }` in the returned JSONB.
--    - '1d' includes recent 48h Facebook Marketplace / classified intake alongside live sold events.
--    - Every horizon payload includes `brand_moves` (brand -> [sold_12m, sold_prior_12m, usd_12m, usd_prior_12m])
--      and `family_moves` ("brand|family_key" -> [sold_12m, sold_prior_12m, usd_12m, usd_prior_12m])
--      so the brand map, nested BrandFamilyMap, and brand family drill tiles sync instantaneously
--      with the 8-stop horizon dial without extra queries.
-- 2) Adds public.treemap_family_upcoming_supply(p_brand, p_family_key) returning active live BaT
--    auctions (joined with model-33 / model-32 finish estimates when fresh), upcoming auction calendar
--    lots, and active Facebook Marketplace captures for the family drill & FamilySalesChart.
-- 3) Updates pg_cron job `refresh-family-share-movers` from once-daily (`5 10 * * *`) to hourly (`5 * * * *`)
--    so `mv_family_share_movers` stays fresh all day.
--
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
  v_has_fb boolean := (to_regclass('public.marketplace_listings') IS NOT NULL);
  v_fb_upcoming jsonb := '[]'::jsonb;
  v_fb_1d jsonb := '[]'::jsonb;
  v_out jsonb;
  v_overlays jsonb;
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

  IF to_regclass('public.mv_family_sales') IS NULL THEN
    SELECT jsonb_build_object(
      'brand_moves', coalesce((
        SELECT jsonb_object_agg(brand, jsonb_build_array(s12, sp, u12, up))
        FROM (
          SELECT brand,
                 sum(bat_sold_12m)::bigint AS s12,
                 sum(bat_sold_prior_12m)::bigint AS sp,
                 sum(bat_usd_12m)::bigint AS u12,
                 sum(bat_usd_prior_12m)::bigint AS up
          FROM public.mv_family_market
          GROUP BY brand
          HAVING sum(bat_sold_12m) > 0 OR sum(bat_sold_prior_12m) > 0
        ) bm
      ), '{}'::jsonb),
      'family_moves', coalesce((
        SELECT jsonb_object_agg(brand || '|' || family_key, jsonb_build_array(s12, sp, u12, up))
        FROM (
          SELECT brand, family_key,
                 sum(bat_sold_12m)::bigint AS s12,
                 sum(bat_sold_prior_12m)::bigint AS sp,
                 sum(bat_usd_12m)::bigint AS u12,
                 sum(bat_usd_prior_12m)::bigint AS up
          FROM public.mv_family_market
          WHERE family_key <> 'other'
          GROUP BY brand, family_key
          HAVING sum(bat_sold_12m) > 0 OR sum(bat_sold_prior_12m) > 0
        ) fm
      ), '{}'::jsonb)
    ) INTO v_overlays;

    RETURN public.family_share_movers_build(v_limit, v_min)
      || jsonb_build_object('horizon', v_h, 'window_days', v_days)
      || v_overlays;
  END IF;

  IF v_h = '1y' THEN
    SELECT jsonb_build_object(
      'brand_moves', coalesce((
        SELECT jsonb_object_agg(brand, jsonb_build_array(s12, sp, u12, up))
        FROM (
          SELECT brand,
                 sum(bat_sold_12m)::bigint AS s12,
                 sum(bat_sold_prior_12m)::bigint AS sp,
                 sum(bat_usd_12m)::bigint AS u12,
                 sum(bat_usd_prior_12m)::bigint AS up
          FROM public.mv_family_market
          GROUP BY brand
          HAVING sum(bat_sold_12m) > 0 OR sum(bat_sold_prior_12m) > 0
        ) bm
      ), '{}'::jsonb),
      'family_moves', coalesce((
        SELECT jsonb_object_agg(brand || '|' || family_key, jsonb_build_array(s12, sp, u12, up))
        FROM (
          SELECT brand, family_key,
                 sum(bat_sold_12m)::bigint AS s12,
                 sum(bat_sold_prior_12m)::bigint AS sp,
                 sum(bat_usd_12m)::bigint AS u12,
                 sum(bat_usd_prior_12m)::bigint AS up
          FROM public.mv_family_market
          WHERE family_key <> 'other'
          GROUP BY brand, family_key
          HAVING sum(bat_sold_12m) > 0 OR sum(bat_sold_prior_12m) > 0
        ) fm
      ), '{}'::jsonb)
    ) INTO v_overlays;

    RETURN public.family_share_movers_build(v_limit, v_min)
      || jsonb_build_object('horizon', '1y', 'window_days', 365)
      || v_overlays;
  END IF;

  SELECT coalesce(max(sale_date), current_date)
    INTO v_anchor
    FROM public.mv_family_sales
   WHERE sale_date <= current_date;

  -- 1) UPCOMING: next 30d live BaT + scheduled auction calendar + active FB Marketplace captures against past 30d sales.
  IF v_h = 'upcoming'
     AND to_regclass('public.market_pulse_live_snapshot') IS NOT NULL
     AND to_regclass('public.mv_auction_calendar_lots') IS NOT NULL THEN

    IF v_has_fb THEN
      SELECT coalesce(jsonb_agg(jsonb_build_array(
        lower(trim(parsed_make)),
        lower(trim(coalesce(parsed_model, ''))),
        CASE
          WHEN coalesce(current_price, price::numeric) > 0 AND coalesce(current_price, price::numeric) < 50000000
            THEN coalesce(current_price, price::numeric)
          ELSE NULL
        END,
        (v_anchor + least(29, greatest(0, (current_date - coalesce(scraped_at::date, current_date))::int)))::text
      )), '[]'::jsonb)
      INTO v_fb_upcoming
      FROM public.marketplace_listings
      WHERE scraped_at > (v_anchor::timestamptz - interval '30 days')
        AND status = 'active'
        AND parsed_make IS NOT NULL;
    END IF;

    WITH b_names AS MATERIALIZED (
      SELECT DISTINCT ON (lower(trim(brand)))
        lower(trim(brand)) AS make_l, brand
      FROM public.mv_family_market
      ORDER BY lower(trim(brand)), sold DESC
    ),
    f_names AS MATERIALIZED (
      SELECT brand, lower(trim(brand)) AS make_l, family_key, max(family) AS family
      FROM public.mv_family_market
      WHERE family_key <> 'other'
      GROUP BY brand, family_key
    ),
    m_map AS MATERIALIZED (
      SELECT DISTINCT ON (lower(trim(brand)), model_key)
        lower(trim(brand)) AS make_l, model_key AS model_l, family_key
      FROM public.mv_family_market
      WHERE family_key <> 'other' AND model_key IS NOT NULL
      ORDER BY lower(trim(brand)), model_key, sold DESC
    ),
    upcoming_lots AS MATERIALIZED (
      SELECT
        'bat_live'::text AS src,
        lower(trim(a->>2)) AS make_l,
        coalesce(
          m.family_key,
          (SELECT fn.family_key FROM f_names fn
            WHERE fn.make_l = lower(trim(a->>2))
              AND (lower(trim(coalesce(a->>3, ''))) = fn.family_key
                   OR lower(trim(coalesce(a->>3, ''))) LIKE fn.family_key || ' %'
                   OR lower(trim(coalesce(a->>3, ''))) LIKE fn.family_key || '-%')
            LIMIT 1),
          'other'
        ) AS family_key,
        CASE WHEN (a->>4) ~ '^[0-9]+(\.[0-9]+)?$' AND (a->>4)::numeric > 0 THEN (a->>4)::numeric ELSE NULL END AS usd,
        coalesce((a->>5)::timestamptz::date, v_anchor + 3) AS dt
      FROM public.market_pulse_live_snapshot s,
           jsonb_array_elements(s.payload->'auctions') a
      LEFT JOIN m_map m
        ON m.make_l = lower(trim(a->>2))
       AND m.model_l = lower(trim(coalesce(a->>3, '')))
      WHERE s.id = 1
        AND a->>2 IS NOT NULL
      UNION ALL
      SELECT
        'auction_calendar'::text AS src,
        lower(trim(c.make)) AS make_l,
        coalesce(
          m.family_key,
          (SELECT fn.family_key FROM f_names fn
            WHERE fn.make_l = lower(trim(c.make))
              AND (lower(trim(coalesce(c.model, ''))) = fn.family_key
                   OR lower(trim(coalesce(c.model, ''))) LIKE fn.family_key || ' %'
                   OR lower(trim(coalesce(c.model, ''))) LIKE fn.family_key || '-%')
            LIMIT 1),
          'other'
        ) AS family_key,
        CASE
          WHEN c.estimate_low ~ '^[0-9]+(\.[0-9]+)?$' AND c.estimate_high ~ '^[0-9]+(\.[0-9]+)?$'
               AND c.estimate_low::numeric > 0 AND c.estimate_high::numeric > 0
            THEN ((c.estimate_low::numeric + c.estimate_high::numeric) / 2.0)::numeric
          WHEN c.estimate_low ~ '^[0-9]+(\.[0-9]+)?$' AND c.estimate_low::numeric > 0
            THEN c.estimate_low::numeric
          WHEN c.estimate_high ~ '^[0-9]+(\.[0-9]+)?$' AND c.estimate_high::numeric > 0
            THEN c.estimate_high::numeric
          ELSE NULL
        END AS usd,
        coalesce(c.run_on, c.sale_starts_on, v_anchor + 7) AS dt
      FROM public.mv_auction_calendar_lots c
      LEFT JOIN m_map m
        ON m.make_l = lower(trim(c.make))
       AND m.model_l = lower(trim(coalesce(c.model, '')))
      WHERE c.make IS NOT NULL
        AND coalesce(c.run_on, c.sale_starts_on, v_anchor + 7) >= v_anchor
        AND coalesce(c.run_on, c.sale_starts_on, v_anchor + 7) <= v_anchor + 30
      UNION ALL
      SELECT
        'facebook_marketplace'::text AS src,
        fb->>0 AS make_l,
        coalesce(
          m.family_key,
          (SELECT fn.family_key FROM f_names fn
            WHERE fn.make_l = (fb->>0)
              AND ((fb->>1) = fn.family_key
                   OR (fb->>1) LIKE fn.family_key || ' %'
                   OR (fb->>1) LIKE fn.family_key || '-%')
            LIMIT 1),
          'other'
        ) AS family_key,
        CASE WHEN (fb->>2) IS NOT NULL THEN (fb->>2)::numeric ELSE NULL END AS usd,
        (fb->>3)::date AS dt
      FROM jsonb_array_elements(v_fb_upcoming) fb
      LEFT JOIN m_map m
        ON m.make_l = (fb->>0)
       AND m.model_l = (fb->>1)
    ),
    past_30d AS MATERIALIZED (
      SELECT brand, lower(trim(brand)) AS make_l, family_key, usd, sale_date AS dt
      FROM public.mv_family_sales
      WHERE sale_date > v_anchor - 30 AND sale_date <= v_anchor
    ),
    f AS MATERIALIZED (
      SELECT
        fn.brand,
        fn.make_l,
        fn.family_key,
        fn.family,
        coalesce(u.s12, 0)::bigint AS s12,
        coalesce(p.sp, 0)::bigint AS sp,
        coalesce(u.u12, 0)::bigint AS u12,
        coalesce(p.up, 0)::bigint AS up
      FROM f_names fn
      LEFT JOIN (
        SELECT make_l, family_key, count(*)::bigint AS s12, coalesce(sum(usd), 0)::bigint AS u12
        FROM upcoming_lots WHERE family_key <> 'other' GROUP BY make_l, family_key
      ) u ON u.make_l = fn.make_l AND u.family_key = fn.family_key
      LEFT JOIN (
        SELECT make_l, family_key, count(*)::bigint AS sp, coalesce(sum(usd), 0)::bigint AS up
        FROM past_30d WHERE family_key <> 'other' GROUP BY make_l, family_key
      ) p ON p.make_l = fn.make_l AND p.family_key = fn.family_key
      WHERE coalesce(u.s12, 0) > 0 OR coalesce(p.sp, 0) > 0
    ),
    brand_agg AS MATERIALIZED (
      SELECT
        bn.brand,
        coalesce(u.s12, 0)::bigint AS s12,
        coalesce(p.sp, 0)::bigint AS sp,
        coalesce(u.u12, 0)::bigint AS u12,
        coalesce(p.up, 0)::bigint AS up
      FROM b_names bn
      LEFT JOIN (
        SELECT make_l, count(*)::bigint AS s12, coalesce(sum(usd), 0)::bigint AS u12
        FROM upcoming_lots GROUP BY make_l
      ) u ON u.make_l = bn.make_l
      LEFT JOIN (
        SELECT make_l, count(*)::bigint AS sp, coalesce(sum(usd), 0)::bigint AS up
        FROM past_30d GROUP BY make_l
      ) p ON p.make_l = bn.make_l
      WHERE coalesce(u.s12, 0) > 0 OR coalesce(p.sp, 0) > 0
    ),
    bat AS MATERIALIZED (
      SELECT
        (SELECT count(*)::bigint FROM upcoming_lots) AS s12,
        (SELECT count(*)::bigint FROM past_30d) AS sp,
        (SELECT coalesce(sum(usd), 0)::bigint FROM upcoming_lots) AS u12,
        (SELECT coalesce(sum(usd), 0)::bigint FROM past_30d) AS up,
        (SELECT count(*)::bigint FROM upcoming_lots WHERE src = 'bat_live') AS bat_live,
        (SELECT count(*)::bigint FROM upcoming_lots WHERE src = 'auction_calendar') AS auction_calendar,
        (SELECT count(*)::bigint FROM upcoming_lots WHERE src = 'facebook_marketplace') AS facebook_marketplace,
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
      SELECT brand, make_l, family_key FROM top_g
      UNION
      SELECT brand, make_l, family_key FROM top_l
    ),
    bin_counts AS MATERIALIZED (
      SELECT brand, family_key, b_idx, sum(cnt)::bigint AS cnt
      FROM (
        SELECT pk.brand, pk.family_key,
               least(11, greatest(0, floor(((p30.dt - (v_anchor - 29))::numeric / 30.0) * 12)::int)) AS b_idx,
               count(*)::bigint AS cnt
        FROM past_30d p30
        JOIN picked pk ON pk.make_l = p30.make_l AND pk.family_key = p30.family_key
        GROUP BY pk.brand, pk.family_key, 3
        UNION ALL
        SELECT pk.brand, pk.family_key,
               12 + least(11, greatest(0, floor(((u30.dt - v_anchor)::numeric / 30.0) * 12)::int)) AS b_idx,
               count(*)::bigint AS cnt
        FROM upcoming_lots u30
        JOIN picked pk ON pk.make_l = u30.make_l AND pk.family_key = u30.family_key
        GROUP BY pk.brand, pk.family_key, 3
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
      'sources', (SELECT jsonb_build_object('bat_live', bat_live, 'auction_calendar', auction_calendar, 'facebook_marketplace', facebook_marketplace) FROM bat),
      'families', (SELECT count(*) FROM f),
      'eligible', (SELECT count(*) FROM e),
      'significant', (SELECT count(*) FROM s),
      'brand_moves', coalesce((
        SELECT jsonb_object_agg(brand, jsonb_build_array(s12, sp, u12, up)) FROM brand_agg
      ), '{}'::jsonb),
      'family_moves', coalesce((
        SELECT jsonb_object_agg(brand || '|' || family_key, jsonb_build_array(s12, sp, u12, up)) FROM f
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
    ) INTO v_out;

    RETURN v_out;
  END IF;

  -- 2) 1D: Live 24h sold vehicle_events + active FB Marketplace captures against prior 24h when at least 10 live rows exist,
  --    falling back to mv_family_sales (v_anchor vs v_anchor - 1).
  IF v_h = '1d'
     AND to_regclass('public.vehicle_events') IS NOT NULL
     AND to_regclass('public.vehicles') IS NOT NULL THEN
    SELECT count(*)
      INTO v_live_24h
      FROM public.vehicle_events ve
     WHERE ve.event_status = 'sold'
       AND ve.ended_at > now() - interval '24 hours'
       AND ve.ended_at <= now();
  END IF;

  IF v_h = '1d' AND v_live_24h >= 10 THEN
    IF v_has_fb THEN
      SELECT coalesce(jsonb_agg(jsonb_build_array(
        lower(trim(parsed_make)),
        lower(trim(coalesce(parsed_model, ''))),
        CASE
          WHEN coalesce(current_price, price::numeric) > 0 AND coalesce(current_price, price::numeric) < 50000000
            THEN coalesce(current_price, price::numeric)
          ELSE NULL
        END,
        scraped_at::text,
        CASE WHEN scraped_at > now() - interval '24 hours' THEN 1 ELSE 0 END
      )), '[]'::jsonb)
      INTO v_fb_1d
      FROM public.marketplace_listings
      WHERE scraped_at > now() - interval '48 hours'
        AND scraped_at <= now()
        AND parsed_make IS NOT NULL;
    END IF;

    WITH b_names AS MATERIALIZED (
      SELECT DISTINCT ON (lower(trim(brand)))
        lower(trim(brand)) AS make_l, brand
      FROM public.mv_family_market
      ORDER BY lower(trim(brand)), sold DESC
    ),
    f_names AS MATERIALIZED (
      SELECT brand, lower(trim(brand)) AS make_l, family_key, max(family) AS family
      FROM public.mv_family_market
      WHERE family_key <> 'other'
      GROUP BY brand, family_key
    ),
    m_map AS MATERIALIZED (
      SELECT DISTINCT ON (lower(trim(brand)), model_key)
        lower(trim(brand)) AS make_l, model_key AS model_l, family_key
      FROM public.mv_family_market
      WHERE family_key <> 'other' AND model_key IS NOT NULL
      ORDER BY lower(trim(brand)), model_key, sold DESC
    ),
    ev AS MATERIALIZED (
      SELECT
        lower(trim(v.make)) AS make_l,
        coalesce(m.family_key, 'other') AS family_key,
        CASE
          WHEN coalesce(ve.final_price, ve.current_price) > 0
               AND coalesce(ve.final_price, ve.current_price) < 50000000
            THEN coalesce(ve.final_price, ve.current_price)::numeric
          ELSE NULL
        END AS usd,
        ve.ended_at,
        CASE WHEN ve.ended_at > now() - interval '24 hours' THEN 1 ELSE 0 END AS is_recent
      FROM public.vehicle_events ve
      JOIN public.vehicles v ON v.id = ve.vehicle_id
      LEFT JOIN m_map m
        ON m.make_l = lower(trim(v.make))
       AND m.model_l = lower(trim(coalesce(v.model, '')))
      WHERE ve.event_status = 'sold'
        AND ve.ended_at > now() - interval '48 hours'
        AND ve.ended_at <= now()
        AND v.make IS NOT NULL
      UNION ALL
      SELECT
        fb->>0 AS make_l,
        coalesce(
          m.family_key,
          (SELECT fn.family_key FROM f_names fn
            WHERE fn.make_l = (fb->>0)
              AND ((fb->>1) = fn.family_key
                   OR (fb->>1) LIKE fn.family_key || ' %'
                   OR (fb->>1) LIKE fn.family_key || '-%')
            LIMIT 1),
          'other'
        ) AS family_key,
        CASE WHEN (fb->>2) IS NOT NULL THEN (fb->>2)::numeric ELSE NULL END AS usd,
        (fb->>3)::timestamptz AS ended_at,
        (fb->>4)::int AS is_recent
      FROM jsonb_array_elements(v_fb_1d) fb
      LEFT JOIN m_map m
        ON m.make_l = (fb->>0)
       AND m.model_l = (fb->>1)
    ),
    agg AS MATERIALIZED (
      SELECT
        make_l,
        family_key,
        count(*) FILTER (WHERE is_recent = 1)::bigint AS s12,
        count(*) FILTER (WHERE is_recent = 0)::bigint AS sp,
        coalesce(sum(usd) FILTER (WHERE is_recent = 1), 0)::bigint AS u12,
        coalesce(sum(usd) FILTER (WHERE is_recent = 0), 0)::bigint AS up
      FROM ev
      GROUP BY make_l, family_key
    ),
    f AS MATERIALIZED (
      SELECT fn.brand, fn.make_l, fn.family_key, fn.family, a.s12, a.sp, a.u12, a.up
      FROM agg a
      JOIN f_names fn ON fn.make_l = a.make_l AND fn.family_key = a.family_key
      WHERE a.family_key <> 'other'
    ),
    brand_agg AS MATERIALIZED (
      SELECT
        bn.brand,
        coalesce(sum(a.s12), 0)::bigint AS s12,
        coalesce(sum(a.sp), 0)::bigint AS sp,
        coalesce(sum(a.u12), 0)::bigint AS u12,
        coalesce(sum(a.up), 0)::bigint AS up
      FROM agg a
      JOIN b_names bn ON bn.make_l = a.make_l
      GROUP BY bn.brand
      HAVING coalesce(sum(a.s12), 0) > 0 OR coalesce(sum(a.sp), 0) > 0
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
      SELECT brand, make_l, family_key FROM top_g
      UNION
      SELECT brand, make_l, family_key FROM top_l
    ),
    bin_counts AS MATERIALIZED (
      SELECT
        pk.brand,
        pk.family_key,
        least(23, greatest(0, floor((extract(epoch FROM (ev.ended_at - (now() - interval '48 hours'))) / 172800.0) * 24)::int)) AS b_idx,
        count(*)::bigint AS cnt
      FROM ev
      JOIN picked pk ON pk.make_l = ev.make_l AND pk.family_key = ev.family_key
      GROUP BY pk.brand, pk.family_key, 3
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
      'brand_moves', coalesce((
        SELECT jsonb_object_agg(brand, jsonb_build_array(s12, sp, u12, up)) FROM brand_agg
      ), '{}'::jsonb),
      'family_moves', coalesce((
        SELECT jsonb_object_agg(brand || '|' || family_key, jsonb_build_array(s12, sp, u12, up)) FROM f
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
    brand_agg AS MATERIALIZED (
      SELECT
        brand,
        coalesce(sum(s12), 0)::bigint AS s12,
        coalesce(sum(sp), 0)::bigint AS sp,
        coalesce(sum(u12), 0)::bigint AS u12,
        coalesce(sum(up), 0)::bigint AS up
      FROM agg
      GROUP BY brand
      HAVING coalesce(sum(s12), 0) > 0 OR coalesce(sum(sp), 0) > 0
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
      'brand_moves', coalesce((
        SELECT jsonb_object_agg(brand, jsonb_build_array(s12, sp, u12, up)) FROM brand_agg
      ), '{}'::jsonb),
      'family_moves', coalesce((
        SELECT jsonb_object_agg(brand || '|' || family_key, jsonb_build_array(s12, sp, u12, up)) FROM f
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
  $dyn$, v_anchor, v_days, v_days * 2, v_min, v_min_z, v_limit, v_h)
  INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.family_share_movers_build(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.family_share_movers_build(integer, integer, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.family_share_movers_build(integer, integer, text) IS
  'Multi-horizon share movers builder across upcoming, 1d, 1w, 1m, 3m, 6m, 1y, and 5y scales, including FB Marketplace '
  'captures, brand_moves/family_moves treemap overlays, and 24 sparkline bins per mover. 2026-10-18.';

-- Family upcoming supply & model-33 finish estimate reader for FamilySalesChart / family drill views:
CREATE OR REPLACE FUNCTION public.treemap_family_upcoming_supply(
  p_brand text,
  p_family_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_brand_l text := lower(trim(coalesce(p_brand, '')));
  v_fam_l text := lower(trim(coalesce(p_family_key, '')));
  v_family_name text;
  v_live_lots jsonb := '[]'::jsonb;
  v_cal_lots jsonb := '[]'::jsonb;
  v_fb_lots jsonb := '[]'::jsonb;
  v_est_payload jsonb := '{}'::jsonb;
  v_has_fb boolean := (to_regclass('public.marketplace_listings') IS NOT NULL);
  v_ids uuid[];
BEGIN
  IF v_brand_l = '' OR v_fam_l = '' THEN
    RETURN jsonb_build_object(
      'as_of', now(),
      'brand', p_brand,
      'family_key', p_family_key,
      'counts', jsonb_build_object('bat_live', 0, 'auction_calendar', 0, 'facebook_marketplace', 0, 'total', 0),
      'live_lots', '[]'::jsonb,
      'calendar_lots', '[]'::jsonb,
      'classified_lots', '[]'::jsonb
    );
  END IF;

  SELECT max(family)
    INTO v_family_name
    FROM public.mv_family_market
   WHERE lower(trim(brand)) = v_brand_l
     AND family_key = p_family_key;

  -- 1) Live Bring a Trailer lots from market_pulse_live_snapshot, enriched with live_finish_estimates (Model 33 / 32)
  IF to_regclass('public.market_pulse_live_snapshot') IS NOT NULL THEN
    WITH m_keys AS MATERIALIZED (
      SELECT DISTINCT model_key
      FROM public.mv_family_market
      WHERE lower(trim(brand)) = v_brand_l
        AND family_key = p_family_key
        AND model_key IS NOT NULL
    ),
    matched_live AS MATERIALIZED (
      SELECT
        (a->>0) AS id_text,
        CASE WHEN (a->>0) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (a->>0)::uuid ELSE NULL END AS vid,
        CASE WHEN (a->>1) ~ '^[0-9]+$' THEN (a->>1)::int ELSE NULL END AS yr,
        a->>2 AS make,
        a->>3 AS model,
        CASE WHEN (a->>4) ~ '^[0-9]+(\.[0-9]+)?$' THEN (a->>4)::numeric::bigint ELSE NULL END AS current_bid,
        a->>5 AS ends_at,
        a->>8 AS image_url,
        (a->>9) = 'true' AS no_reserve,
        a->>10 AS listing_url,
        a->>11 AS title,
        CASE WHEN (a->>12) ~ '^[0-9]+(\.[0-9]+)?$' THEN (a->>12)::numeric::bigint ELSE NULL END AS band_p10,
        CASE WHEN (a->>13) ~ '^[0-9]+(\.[0-9]+)?$' THEN (a->>13)::numeric::bigint ELSE NULL END AS band_p50,
        CASE WHEN (a->>14) ~ '^[0-9]+(\.[0-9]+)?$' THEN (a->>14)::numeric::bigint ELSE NULL END AS band_p90
      FROM public.market_pulse_live_snapshot s,
           jsonb_array_elements(s.payload->'auctions') a
      WHERE s.id = 1
        AND lower(trim(coalesce(a->>2, ''))) = v_brand_l
        AND (
          lower(trim(coalesce(a->>3, ''))) IN (SELECT model_key FROM m_keys)
          OR lower(trim(coalesce(a->>3, ''))) = v_fam_l
          OR lower(trim(coalesce(a->>3, ''))) LIKE v_fam_l || ' %'
          OR lower(trim(coalesce(a->>3, ''))) LIKE v_fam_l || '-%'
          OR (v_family_name IS NOT NULL AND lower(trim(coalesce(a->>3, ''))) LIKE lower(v_family_name) || '%')
        )
    )
    SELECT
      array_agg(vid) FILTER (WHERE vid IS NOT NULL),
      coalesce(jsonb_agg(jsonb_build_object(
        'vehicle_id', id_text,
        'year', yr,
        'make', make,
        'model', model,
        'title', coalesce(title, concat_ws(' ', yr, make, model)),
        'current_bid', current_bid,
        'ends_at', ends_at,
        'image_url', image_url,
        'no_reserve', no_reserve,
        'source_url', listing_url,
        'source', 'Bring a Trailer',
        'band_p10', band_p10,
        'band_p50', band_p50,
        'band_p90', band_p90
      ) ORDER BY ends_at ASC NULLS LAST), '[]'::jsonb)
    INTO v_ids, v_live_lots
    FROM matched_live;

    IF v_ids IS NOT NULL AND cardinality(v_ids) > 0
       AND to_regprocedure('public.live_finish_estimates(uuid[])') IS NOT NULL THEN
      BEGIN
        v_est_payload := public.live_finish_estimates(v_ids);
      EXCEPTION WHEN OTHERS THEN
        v_est_payload := '{}'::jsonb;
      END;
    END IF;
  END IF;

  -- Merge live_finish_estimates (Model 33 / 32) into v_live_lots by vehicle_id
  IF jsonb_typeof(v_est_payload->'rows') = 'array' AND jsonb_array_length(v_est_payload->'rows') > 0 THEN
    WITH est_map AS (
      SELECT
        r->>0 AS vid,
        CASE WHEN (r->>1) ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>1)::numeric::bigint ELSE NULL END AS est,
        CASE WHEN (r->>2) ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>2)::numeric::bigint ELSE NULL END AS est_lo,
        CASE WHEN (r->>3) ~ '^[0-9]+(\.[0-9]+)?$' THEN (r->>3)::numeric::bigint ELSE NULL END AS est_hi,
        r->>4 AS grade,
        CASE WHEN (r->>10) ~ '^[0-9]+$' THEN (r->>10)::int ELSE NULL END AS model_ver,
        r->11 AS factors
      FROM jsonb_array_elements(v_est_payload->'rows') r
    )
    SELECT coalesce(jsonb_agg(
      CASE
        WHEN em.est IS NOT NULL THEN
          l || jsonb_build_object(
            'finish_estimate', em.est,
            'finish_low', em.est_lo,
            'finish_high', em.est_hi,
            'finish_grade', em.grade,
            'finish_model', em.model_ver,
            'finish_factors', em.factors
          )
        ELSE l
      END
    ), '[]'::jsonb)
    INTO v_live_lots
    FROM jsonb_array_elements(v_live_lots) l
    LEFT JOIN est_map em ON em.vid = (l->>'vehicle_id');
  END IF;

  -- 2) Scheduled auction calendar lots over the next 30 days
  IF to_regclass('public.mv_auction_calendar_lots') IS NOT NULL THEN
    WITH m_keys AS MATERIALIZED (
      SELECT DISTINCT model_key
      FROM public.mv_family_market
      WHERE lower(trim(brand)) = v_brand_l
        AND family_key = p_family_key
        AND model_key IS NOT NULL
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'vehicle_id', c.vehicle_id,
      'event_id', c.event_id,
      'year', c.year,
      'make', c.make,
      'model', c.model,
      'title', concat_ws(' ', c.year, c.make, c.model),
      'house', c.house,
      'sale_name', c.sale_name,
      'run_on', coalesce(c.run_on, c.sale_starts_on),
      'has_reserve', c.has_reserve,
      'source_url', c.source_url,
      'estimate_low', CASE WHEN c.estimate_low ~ '^[0-9]+(\.[0-9]+)?$' THEN c.estimate_low::numeric::bigint ELSE NULL END,
      'estimate_high', CASE WHEN c.estimate_high ~ '^[0-9]+(\.[0-9]+)?$' THEN c.estimate_high::numeric::bigint ELSE NULL END
    ) ORDER BY coalesce(c.run_on, c.sale_starts_on) ASC NULLS LAST), '[]'::jsonb)
    INTO v_cal_lots
    FROM public.mv_auction_calendar_lots c
    WHERE lower(trim(coalesce(c.make, ''))) = v_brand_l
      AND coalesce(c.run_on, c.sale_starts_on, current_date + 7) >= current_date
      AND coalesce(c.run_on, c.sale_starts_on, current_date + 7) <= current_date + 30
      AND (
        lower(trim(coalesce(c.model, ''))) IN (SELECT model_key FROM m_keys)
        OR lower(trim(coalesce(c.model, ''))) = v_fam_l
        OR lower(trim(coalesce(c.model, ''))) LIKE v_fam_l || ' %'
        OR lower(trim(coalesce(c.model, ''))) LIKE v_fam_l || '-%'
        OR (v_family_name IS NOT NULL AND lower(trim(coalesce(c.model, ''))) LIKE lower(v_family_name) || '%')
      );
  END IF;

  -- 3) Active Facebook Marketplace captures (last 30d)
  IF v_has_fb THEN
    WITH m_keys AS MATERIALIZED (
      SELECT DISTINCT model_key
      FROM public.mv_family_market
      WHERE lower(trim(brand)) = v_brand_l
        AND family_key = p_family_key
        AND model_key IS NOT NULL
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'vehicle_id', coalesce(m.vehicle_id, m.suggested_vehicle_id),
      'year', coalesce(m.parsed_year, m.extracted_year),
      'make', m.parsed_make,
      'model', m.parsed_model,
      'title', coalesce(m.title, concat_ws(' ', coalesce(m.parsed_year, m.extracted_year), m.parsed_make, m.parsed_model)),
      'price', CASE WHEN coalesce(m.current_price, m.price::numeric) > 0 THEN coalesce(m.current_price, m.price::numeric)::bigint ELSE NULL END,
      'location', m.location,
      'source_url', m.url,
      'scraped_at', m.scraped_at,
      'source', 'Facebook Marketplace'
    ) ORDER BY m.scraped_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_fb_lots
    FROM (
      SELECT *
      FROM public.marketplace_listings m
      WHERE m.scraped_at > now() - interval '30 days'
        AND m.status = 'active'
        AND lower(trim(coalesce(m.parsed_make, ''))) = v_brand_l
        AND (
          lower(trim(coalesce(m.parsed_model, ''))) IN (SELECT model_key FROM m_keys)
          OR lower(trim(coalesce(m.parsed_model, ''))) = v_fam_l
          OR lower(trim(coalesce(m.parsed_model, ''))) LIKE v_fam_l || ' %'
          OR lower(trim(coalesce(m.parsed_model, ''))) LIKE v_fam_l || '-%'
          OR (v_family_name IS NOT NULL AND lower(trim(coalesce(m.parsed_model, ''))) LIKE lower(v_family_name) || '%')
        )
      ORDER BY m.scraped_at DESC
      LIMIT 50
    ) m;
  END IF;

  RETURN jsonb_build_object(
    'as_of', now(),
    'brand', p_brand,
    'family_key', p_family_key,
    'finish_model', v_est_payload->'model',
    'finish_fresh', coalesce((v_est_payload->>'fresh')::boolean, false),
    'counts', jsonb_build_object(
      'bat_live', jsonb_array_length(v_live_lots),
      'auction_calendar', jsonb_array_length(v_cal_lots),
      'facebook_marketplace', jsonb_array_length(v_fb_lots),
      'total', jsonb_array_length(v_live_lots) + jsonb_array_length(v_cal_lots) + jsonb_array_length(v_fb_lots)
    ),
    'live_lots', v_live_lots,
    'calendar_lots', v_cal_lots,
    'classified_lots', v_fb_lots
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.treemap_family_upcoming_supply(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_upcoming_supply(text, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.treemap_family_upcoming_supply(text, text) IS
  'Upcoming supply pressure and Model 33 / 32 finish-estimate bands for a model family: live Bring a Trailer auctions, '
  'next-30d scheduled auction calendar lots, and active Facebook Marketplace captures. 2026-10-18.';

-- Refresh mv_family_share_movers so all 8 rows carry brand_moves, family_moves, and FB Marketplace supply immediately.
REFRESH MATERIALIZED VIEW public.mv_family_share_movers;

-- Harden refresh-family-share-movers cron schedule to run hourly (`5 * * * *`) with CONCURRENTLY.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-family-share-movers') THEN
      PERFORM cron.unschedule('refresh-family-share-movers');
    END IF;
    PERFORM cron.schedule(
      'refresh-family-share-movers',
      '5 * * * *',
      $cmd$SET statement_timeout = '5min'; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_share_movers$cmd$
    );
  END IF;
END $cron$;

COMMIT;
