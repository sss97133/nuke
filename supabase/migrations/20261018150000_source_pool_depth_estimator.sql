-- Algorithmic Source Pool-Depth Estimator (2026-10-18)
--
-- Replaces NULL ("their total unknown") on the Sources board with a flexible,
-- four-regime mathematical estimator embedded directly in the data model:
--
--   1. public.estimate_source_population(...)
--      Pure data-model estimator returning (population, population_method,
--      population_confidence, population_at) for any source holding data (H > 0):
--        * Regime 1 — Direct Whole-Source Census ('enumerated', 'search_index', 'sitemap', 'bounded'):
--            When a whole-source census N_direct >= H exists (universe_historical IS NOT NULL),
--            uses N_direct and its recorded method & confidence.
--        * Regime 2 — Windowed Cohort / Damped Lincoln-Petersen Extrapolation ('window_extrapolated'):
--            When a partial or windowed census exists in source_census (per-year `by_year` cohort
--            distribution or scoped window W with unheld gap U_gap in `raw_response->>'missing'`),
--            integrates the mature annual cohort rate R_mature across operating span Y_span and
--            applies Bayesian-shrunk Lincoln-Petersen capture-recapture outside the window:
--              N_hat = max(H + U_gap, round(R_mature * Y_span), round(W + H_out / ((1 + theta_win) / 2)))
--              C     = round(min(0.78, 0.32 + 0.46 * max(H, W) / N_hat), 2)
--        * Regime 3 — Standing Inventory & Turnover Flow Model ('turnover_model'):
--            When active inventory A (`universe_active`) or daily arrival/turnover rate lambda
--            (`estimated_turnover_per_day`) is recorded in source_census, integrates flow over the
--            source's decay mean lifetime tau = max(365, decay_half_life_days / ln(2)):
--              N_hat = max(H + A, round(A + lambda * tau))
--              C     = round(min(0.72, 0.25 + 0.12*I(A>0) + 0.08*I(lambda>0) + 0.27*sqrt(H / N_hat)), 2)
--        * Regime 4 — Endogenous Capture-Velocity & Good-Turing Unseen-Mass Model ('capture_model'):
--            When no external census parameters are recorded yet, combines annual sales throughput
--            (R_sold * mu_lot_to_sold * Y_eff), 14-day arrival velocity over decay lifetime
--            (H + v_14d * tau_decay), and the logarithmic Good-Turing unseen-mass prior
--            H * (1 + max(0.28, 1.65 / ln(e + H / 300))):
--              N_hat = max(H + 1, N_sales, N_vel, N_prior)
--              C     = round(min(0.58, 0.14 + 0.08*min(1, ln(1+H)/ln(100001)) + 0.06*I(M>0) + 0.05*I(L_14d>0) + 0.25*(H/N_hat)), 2)
--
--   2. Live-verified whole-source census updates (2026-10-17):
--        * Bring a Trailer (`bat`): 270,391 lots (269,111 completed on /auctions/results/ + 1,280 live on /auctions/).
--        * Mecum Auctions (`mecum`): 312,587 total lots in Mecum's Algolia index `wp_posts_lot` across all 10 lot types
--          (194,600 Auto, 79,495 Road Art, 24,243 Motorcycle, 11,311 Tractor, 2,000 Other, 313 Boat, 256 Guitar,
--           233 Engine, 129 Trailer, 1 Airplane).
--
-- Contract: supabase/sql/test_market_sources_board.sql (db-contracts).

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.source_census
  ADD COLUMN IF NOT EXISTS universe_active integer,
  ADD COLUMN IF NOT EXISTS estimated_turnover_per_day integer,
  ADD COLUMN IF NOT EXISTS by_year jsonb,
  ADD COLUMN IF NOT EXISTS by_category jsonb,
  ADD COLUMN IF NOT EXISTS raw_response jsonb,
  ADD COLUMN IF NOT EXISTS census_url text,
  ADD COLUMN IF NOT EXISTS census_notes text;

ALTER TABLE public.observation_sources
  ADD COLUMN IF NOT EXISTS decay_half_life_days integer;

CREATE OR REPLACE FUNCTION public.estimate_source_population(
  p_held bigint,
  p_landed_at timestamptz,
  p_category text,
  p_half_life_days integer,
  p_direct_total bigint,
  p_direct_method text,
  p_direct_conf numeric,
  p_direct_at timestamptz,
  p_win_total bigint DEFAULT NULL,
  p_win_active bigint DEFAULT NULL,
  p_turnover_day numeric DEFAULT NULL,
  p_by_year jsonb DEFAULT NULL,
  p_raw_response jsonb DEFAULT NULL,
  p_win_at timestamptz DEFAULT NULL,
  p_total_outcomes bigint DEFAULT NULL,
  p_map_sales bigint DEFAULT NULL,
  p_sales_12m bigint DEFAULT NULL,
  p_sales_prior_12m bigint DEFAULT NULL,
  p_fam_span_years numeric DEFAULT NULL,
  p_landed_14d numeric DEFAULT NULL,
  p_active_days_14d numeric DEFAULT NULL
)
RETURNS TABLE (
  population bigint,
  population_method text,
  population_confidence numeric(3,2),
  population_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_h bigint := coalesce(p_held, 0);
  v_half_life numeric := coalesce(p_half_life_days, CASE WHEN p_category = 'auction' THEN 180 ELSE 30 END)::numeric;
  v_tau_decay numeric := v_half_life / 0.69314718;
  v_gap bigint := 0;
  v_n_cohort bigint;
  v_n_lp bigint;
  v_m_in numeric;
  v_theta_win numeric;
  v_n_turnover bigint;
  v_tau_horizon numeric;
  v_r_sold numeric;
  v_mu numeric;
  v_y_eff numeric;
  v_psi numeric;
  v_n_sales bigint;
  v_n_vel bigint;
  v_alpha numeric;
  v_n_prior bigint;
BEGIN
  IF v_h <= 0 AND p_direct_total IS NULL THEN
    RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::numeric(3,2), NULL::timestamptz;
    RETURN;
  END IF;

  -- Regime 1: Direct Whole-Source Census (enumerated, search_index, sitemap, bounded)
  IF p_direct_total IS NOT NULL AND p_direct_total >= v_h THEN
    population := p_direct_total;
    population_method := coalesce(p_direct_method, 'enumerated');
    population_confidence := round(coalesce(p_direct_conf, 0.80), 2)::numeric(3,2);
    population_at := coalesce(p_direct_at, p_landed_at, now());
    RETURN NEXT;
    RETURN;
  END IF;

  -- Regime 2: Windowed Cohort / Damped Lincoln-Petersen Extrapolation
  IF p_by_year IS NOT NULL AND jsonb_typeof(p_by_year) = 'object' AND p_by_year <> '{}'::jsonb THEN
    SELECT round(
             avg(v::numeric) FILTER (
               WHERE v::numeric >= 0.45 * (
                 SELECT max(v2::numeric)
                 FROM jsonb_each_text(p_by_year) e2(k2, v2)
                 WHERE k2 ~ '^[0-9]{4}$' AND v2 ~ '^[0-9]+(\.[0-9]+)?$'
               )
             ) * GREATEST(
               extract(year FROM current_date)::int - min(k::int) + 1,
               max(k::int) - min(k::int) + 1
             )
           )::bigint
      INTO v_n_cohort
      FROM jsonb_each_text(p_by_year) e(k, v)
     WHERE k ~ '^[0-9]{4}$' AND v ~ '^[0-9]+(\.[0-9]+)?$';
  END IF;

  IF p_raw_response IS NOT NULL AND jsonb_typeof(p_raw_response) = 'object' AND (p_raw_response ? 'missing') THEN
    IF (p_raw_response->>'missing') ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_gap := round((p_raw_response->>'missing')::numeric)::bigint;
    END IF;
    IF coalesce(p_win_total, 0) > 0 THEN
      v_m_in := GREATEST(1.0, p_win_total::numeric - v_gap::numeric);
      v_theta_win := LEAST(1.0, GREATEST(0.05, v_m_in / p_win_total::numeric));
      v_n_lp := round(
        p_win_total::numeric + GREATEST(0.0, v_h::numeric - v_m_in) / ((1.0 + v_theta_win) / 2.0)
      )::bigint;
    END IF;
  END IF;

  IF v_n_cohort IS NOT NULL OR v_n_lp IS NOT NULL OR v_gap > 0 THEN
    population := GREATEST(v_h + v_gap, coalesce(v_n_cohort, 0), coalesce(v_n_lp, 0), v_h + 1);
    population_method := 'window_extrapolated';
    population_confidence := round(
      LEAST(0.78, 0.32 + 0.46 * (GREATEST(v_h, coalesce(p_win_total, 0))::numeric / GREATEST(1, population)::numeric)),
      2
    )::numeric(3,2);
    population_at := coalesce(p_win_at, p_direct_at, p_landed_at, now());
    RETURN NEXT;
    RETURN;
  END IF;

  -- Regime 3: Standing Inventory & Turnover Flow Model
  IF coalesce(p_turnover_day, 0) > 0 OR coalesce(p_win_active, 0) > 0 THEN
    v_tau_horizon := GREATEST(365.0, v_tau_decay);
    IF p_raw_response IS NOT NULL AND jsonb_typeof(p_raw_response) = 'object'
       AND (p_raw_response ? 'horizon_days') AND (p_raw_response->>'horizon_days') ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_tau_horizon := GREATEST(1.0, (p_raw_response->>'horizon_days')::numeric);
    END IF;
    v_n_turnover := GREATEST(
      v_h + coalesce(p_win_active, 0),
      round(coalesce(p_win_active, 0)::numeric + coalesce(p_turnover_day, 0)::numeric * v_tau_horizon)::bigint,
      v_h + 1
    );
    population := v_n_turnover;
    population_method := 'turnover_model';
    population_confidence := round(
      LEAST(
        0.72,
        0.25
        + CASE WHEN coalesce(p_win_active, 0) > 0 THEN 0.12 ELSE 0.0 END
        + CASE WHEN coalesce(p_turnover_day, 0) > 0 THEN 0.08 ELSE 0.0 END
        + 0.27 * sqrt(v_h::numeric / GREATEST(1, population)::numeric)
      ),
      2
    )::numeric(3,2);
    population_at := coalesce(p_win_at, p_landed_at, now());
    RETURN NEXT;
    RETURN;
  END IF;

  -- Regime 4: Endogenous Capture-Velocity & Good-Turing Unseen-Mass Model
  v_r_sold := GREATEST(coalesce(p_sales_12m, 0), coalesce(p_sales_prior_12m, 0))::numeric;
  IF v_r_sold > 0 THEN
    v_mu := LEAST(2.20, GREATEST(1.18, coalesce(p_total_outcomes, p_map_sales, 1)::numeric / GREATEST(1, coalesce(p_map_sales, 1))::numeric));
    v_y_eff := GREATEST(coalesce(p_fam_span_years, 2.0), 3.0);
    v_psi := LEAST(1.0, coalesce(p_map_sales, 0)::numeric / GREATEST(1, v_h)::numeric);
    v_n_sales := round(v_r_sold * v_mu * v_y_eff * (1.0 + (1.0 - v_psi)))::bigint;
  END IF;

  IF coalesce(p_landed_14d, 0) > 0 THEN
    v_n_vel := (v_h + round((p_landed_14d / GREATEST(1.0, coalesce(p_active_days_14d, 1.0))) * v_tau_decay))::bigint;
  END IF;

  v_alpha := GREATEST(0.28, 1.65 / ln(2.7182818 + v_h::numeric / 300.0));
  v_n_prior := round(v_h::numeric * (1.0 + v_alpha))::bigint;

  population := GREATEST(v_h + 1, coalesce(v_n_sales, 0), coalesce(v_n_vel, 0), v_n_prior);
  population_method := 'capture_model';
  population_confidence := round(
    LEAST(
      0.58,
      0.14
      + 0.08 * LEAST(1.0, ln(1.0 + v_h::numeric) / ln(100001.0))
      + CASE WHEN coalesce(p_map_sales, 0) > 0 THEN 0.06 ELSE 0.0 END
      + CASE WHEN coalesce(p_landed_14d, 0) > 0 THEN 0.05 ELSE 0.0 END
      + 0.25 * (v_h::numeric / GREATEST(1, population)::numeric)
    ),
    2
  )::numeric(3,2);
  population_at := coalesce(p_landed_at, now());
  RETURN NEXT;
END
$$;

COMMENT ON FUNCTION public.estimate_source_population(
  bigint, timestamptz, text, integer, bigint, text, numeric, timestamptz,
  bigint, bigint, numeric, jsonb, jsonb, timestamptz, bigint, bigint, bigint, bigint, numeric, numeric, numeric
) IS
  'Four-regime pool-depth estimator for market sources: (1) direct whole-source census when universe_total >= held_lots, '
  '(2) windowed cohort / damped Lincoln-Petersen extrapolation from by_year or raw_response gap, (3) standing inventory '
  'and daily turnover flow model over decay horizon, and (4) endogenous sales-throughput, arrival-velocity, and '
  'Good-Turing unseen-mass prior. 2026-10-18.';

REVOKE ALL ON FUNCTION public.estimate_source_population(
  bigint, timestamptz, text, integer, bigint, text, numeric, timestamptz,
  bigint, bigint, numeric, jsonb, jsonb, timestamptz, bigint, bigint, bigint, bigint, numeric, numeric, numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estimate_source_population(
  bigint, timestamptz, text, integer, bigint, text, numeric, timestamptz,
  bigint, bigint, numeric, jsonb, jsonb, timestamptz, bigint, bigint, bigint, bigint, numeric, numeric, numeric
) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_market_source_day()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  INSERT INTO public.market_source_days (day, source_slug, display_name, category, house, landed_lots, landed_at, population,
    population_method, population_confidence, population_at, map_sales, map_usd, sales_12m, usd_12m, sales_prior_12m,
    usd_prior_12m, months, recorded_at)
  WITH src AS (
    SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'))
           o.slug, o.display_name, o.category::text AS category,
           regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
           public.market_venue_label(o.slug) AS house,
           o.decay_half_life_days
    FROM public.observation_sources o
    WHERE o.slug IS NOT NULL AND o.display_name IS NOT NULL
    ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), o.created_at, o.slug
  ), pop_direct AS (
    SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'))
           regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
           c.universe_total, c.census_method, c.census_confidence, c.census_at
    FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
    WHERE c.universe_total IS NULL OR c.universe_historical IS NOT NULL
    ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), c.census_at DESC
  ), pop_win AS (
    SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'))
           regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
           c.universe_total AS win_total,
           c.universe_active AS win_active,
           c.estimated_turnover_per_day AS turnover_day,
           c.by_year,
           c.raw_response,
           c.census_at AS win_at
    FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
    WHERE (c.by_year IS NOT NULL AND jsonb_typeof(c.by_year) = 'object' AND c.by_year <> '{}'::jsonb)
       OR (c.raw_response IS NOT NULL AND jsonb_typeof(c.raw_response) = 'object' AND (c.raw_response ? 'missing' OR c.raw_response ? 'horizon_days'))
       OR c.estimated_turnover_per_day IS NOT NULL
       OR (c.universe_active IS NOT NULL AND c.universe_historical IS NULL AND c.census_method NOT IN ('house_roster_facet', 'live_only'))
    ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'),
             (c.by_year IS NOT NULL AND jsonb_typeof(c.by_year) = 'object' AND c.by_year <> '{}'::jsonb) DESC,
             c.census_at DESC
  ), lan AS (
    SELECT regexp_replace(lower(source_slug), '[^a-z0-9]', '', 'g') AS nslug,
           max(landed_lots) AS landed_lots,
           max(measured_at) AS landed_at
    FROM public.mv_source_target_landed
    GROUP BY 1
  ), mapq AS (
    SELECT source_name AS house,
           count(*) AS total_outcomes,
           count(*) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS sales,
           sum(sold_amount) FILTER (WHERE outcome = 'sold' AND sold_amount > 0) AS usd
    FROM public.mv_treemap_outcomes
    WHERE source_name IS NOT NULL
    GROUP BY 1
  ), fam AS (
    SELECT source AS house,
           GREATEST(1, extract(year FROM age(max(sale_date), min(sale_date))) + 1)::numeric AS fam_span_years,
           count(*) FILTER (WHERE sale_date > current_date - 365) AS sales_12m,
           sum(usd) FILTER (WHERE sale_date > current_date - 365) AS usd_12m,
           count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS sales_prior_12m,
           sum(usd) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS usd_prior_12m
    FROM public.mv_family_sales
    WHERE source IS NOT NULL AND usd > 0 AND sale_date <= current_date
    GROUP BY 1
  ), mon AS (
    SELECT house, jsonb_agg(jsonb_build_array(to_char(m, 'YYYY-MM'), n, u) ORDER BY m) AS months
    FROM (SELECT source AS house, date_trunc('month', sale_date)::date AS m, count(*) AS n, sum(usd) AS u
          FROM public.mv_family_sales
          WHERE source IS NOT NULL AND usd > 0 AND sale_date <= current_date
            AND sale_date >= (date_trunc('month', current_date) - interval '23 months')::date
          GROUP BY 1, 2) x
    GROUP BY 1
  ), hrs14 AS (
    SELECT h.source_key AS nslug,
           sum(h.records)::numeric AS landed_14d,
           GREATEST(1, count(DISTINCT h.hour::date) FILTER (WHERE h.records > 0))::numeric AS active_days_14d
    FROM public.market_source_hours h
    WHERE h.hour >= now() - interval '14 days'
    GROUP BY 1
  )
  SELECT current_date, s.slug, s.display_name, s.category, s.house, l.landed_lots, l.landed_at,
         est.population, est.population_method, est.population_confidence, est.population_at,
          nullif(mq.sales, 0), mq.usd, f.sales_12m, f.usd_12m,
         f.sales_prior_12m, f.usd_prior_12m, mo.months, now()
  FROM src s
  LEFT JOIN lan l USING (nslug)
  LEFT JOIN pop_direct pd USING (nslug)
  LEFT JOIN pop_win pw USING (nslug)
  LEFT JOIN mapq mq ON mq.house = s.house
  LEFT JOIN fam f ON f.house = s.house
  LEFT JOIN mon mo ON mo.house = s.house
  LEFT JOIN hrs14 h14 ON h14.nslug = s.nslug
  CROSS JOIN LATERAL public.estimate_source_population(
    l.landed_lots, l.landed_at, s.category, s.decay_half_life_days,
    pd.universe_total, pd.census_method, pd.census_confidence::numeric, pd.census_at,
    pw.win_total, pw.win_active, pw.turnover_day::numeric, pw.by_year, pw.raw_response, pw.win_at,
    mq.total_outcomes, nullif(mq.sales, 0), f.sales_12m, f.sales_prior_12m, f.fam_span_years,
    h14.landed_14d, h14.active_days_14d
  ) est
  WHERE coalesce(l.landed_lots, 0) > 0 OR coalesce(mq.sales, 0) > 0 OR coalesce(f.sales_12m, 0) > 0
  ON CONFLICT (day, source_slug) DO UPDATE SET
    display_name = EXCLUDED.display_name, category = EXCLUDED.category, house = EXCLUDED.house,
    landed_lots = EXCLUDED.landed_lots, landed_at = EXCLUDED.landed_at, population = EXCLUDED.population,
    population_method = EXCLUDED.population_method, population_confidence = EXCLUDED.population_confidence,
    population_at = EXCLUDED.population_at, map_sales = EXCLUDED.map_sales, map_usd = EXCLUDED.map_usd,
    sales_12m = EXCLUDED.sales_12m, usd_12m = EXCLUDED.usd_12m, sales_prior_12m = EXCLUDED.sales_prior_12m,
    usd_prior_12m = EXCLUDED.usd_prior_12m, months = EXCLUDED.months, recorded_at = EXCLUDED.recorded_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END
$$;

COMMENT ON FUNCTION public.record_market_source_day() IS
  'Writes today''s market_source_days row for every declared source holding data (held lots, whole-source or modeled '
  'pool-depth population via estimate_source_population(), map sales, sales by sale date); a second call the same day '
  'replaces that day''s rows. Cron market-source-days, 10:47Z. 2026-10-18.';
REVOKE ALL ON FUNCTION public.record_market_source_day() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_market_source_day() TO service_role;

-- Seed live-verified whole-source census rows for Bring a Trailer (270,391) and Mecum (312,587)
-- and refresh today's market_source_days snapshot when running against the live dataset.
DO $seed$
BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN
    INSERT INTO public.source_census (
      source_id, universe_total, universe_active, universe_historical,
      census_method, census_confidence, census_url, census_notes,
      by_year, by_category, census_at
    )
    SELECT o.id,
           270391,
           1280,
           269111,
           'enumerated',
           0.98,
           'https://bringatrailer.com/auctions/results/',
           'Live enumeration on bringatrailer.com (2026-10-17): 269,111 completed auctions on /auctions/results/ ("View 269,111 Completed Auctions") plus 1,280 live auctions on /auctions/ ("1,280 Auctions Now Live") = 270,391 total lots.',
           (SELECT c.by_year FROM public.source_census c WHERE c.source_id = o.id AND c.by_year IS NOT NULL AND c.by_year <> '{}'::jsonb ORDER BY c.census_at DESC LIMIT 1),
           NULL,
           '2026-10-17 21:30:00+00'::timestamptz
    FROM public.observation_sources o
    WHERE o.slug = 'bat'
      AND NOT EXISTS (
        SELECT 1 FROM public.source_census c
        WHERE c.source_id = o.id AND c.universe_total = 270391
      );

    INSERT INTO public.source_census (
      source_id, universe_total, universe_active, universe_historical,
      census_method, census_confidence, census_url, census_notes,
      by_year, by_category, census_at
    )
    SELECT o.id,
           312587,
           2539,
           310048,
           'search_index',
           0.95,
           'https://U6CFCQ7V52-dsn.algolia.net/1/indexes/wp_posts_lot/query',
           'Live enumeration of Mecum Algolia index wp_posts_lot (2026-10-17): nbHits = 312,587 total lots across all 10 lot_type facets (Auto 194,600, Road Art 79,495, Motorcycle 24,243, Tractor 11,311, Other 2,000, Boat 313, Guitar 256, Engine 233, Trailer 129, Airplane 1). Includes all lot categories.',
           NULL,
           '{"Auto":194600,"Road Art":79495,"Motorcycle":24243,"Tractor":11311,"Other":2000,"Boat":313,"Guitar":256,"Engine":233,"Trailer":129,"Airplane":1}'::jsonb,
           '2026-10-17 21:30:01+00'::timestamptz
    FROM public.observation_sources o
    WHERE o.slug = 'mecum'
      AND NOT EXISTS (
        SELECT 1 FROM public.source_census c
        WHERE c.source_id = o.id AND c.universe_total = 312587
      );

    IF EXISTS (SELECT 1 FROM public.market_source_days) THEN
      PERFORM public.record_market_source_day();
    END IF;
  END IF;
END $seed$;

COMMIT;
