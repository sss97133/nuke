-- The market page's Sources board: every source with the same measures, ranked by the data we hold for it.
--
-- Owner direction (2026-10-15 evening): "when are we gonna see the site treat all sources the same? the sources should be
-- rising based on their data". The market page names Bring a Trailer in its views because BaT is the one source we hold
-- almost whole (252,399 of 264,746 lots, 95%, source_target_coverage 2026-10-15). This gives every declared source
-- (observation_sources) one row with the same measures, ordered by the lots we hold, so a source climbs as its data lands:
--   held lots     mv_source_target_landed.landed_lots (distinct listing URLs on vehicle_events for the source) and the
--                 time that fold was measured, so a stale count is never shown as current;
--   their total   the source's latest whole-source census, the rule source_target_coverage uses (20261016190000);
--   map sales     confirmed sales with an amount on the market map under the source's house (mv_treemap_outcomes,
--                 market_venue_label), all time, count and dollars;
--   recent sales  mv_family_sales by sale date: the last 365 days, the 365 before, and 24 months of counts and dollars;
--   live lots     monitored_auctions live now with a future end and a read in the last two hours (read at call time).
-- One row per source per day (the day's latest reading), written by record_market_source_day() at 10:47Z, after the map
-- (09:10Z), family sales (10:10Z) and held-lot (10:27Z) folds, so the board also shows each source's held lots a week
-- earlier. market_sources_read() is the anon reader. No source is named in the ranking.
--
-- Also: refresh-source-target-landed (paused in the 10-15 ~02Z outage recovery) runs again once a day at 10:27Z, its
-- command and 300 s timeout unchanged (skylar-f7, 2026-10-16 00:2xZ: inside the load budget at that hour).
-- Contract: supabase/sql/test_market_sources_board.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.market_source_days (
  day date NOT NULL,
  source_slug text NOT NULL,
  display_name text NOT NULL,
  category text,
  house text,                         -- market_venue_label(source_slug): the map's name for it, null when the map lists none
  landed_lots bigint,                 -- lots held (mv_source_target_landed.landed_lots)
  landed_at timestamptz,              -- when that fold was measured
  population bigint,                  -- the source's whole-source census
  population_method text,
  population_confidence numeric,
  population_at timestamptz,
  map_sales bigint,                   -- confirmed sales with an amount on the map, all time
  map_usd numeric,
  sales_12m bigint,                   -- mv_family_sales, sale date in the last 365 days
  usd_12m numeric,
  sales_prior_12m bigint,             -- the 365 days before
  usd_prior_12m numeric,
  months jsonb,                       -- [["YYYY-MM", sales, dollars], ...], the last 24 months
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, source_slug)
);
COMMENT ON TABLE public.market_source_days IS
  'Each declared source''s held data, one row per day (the day''s latest reading): lots held and when measured, its census '
  'total, map sales, sales by sale date (12 months, the 12 before, 24 monthly points). Written by record_market_source_day(), '
  'read by market_sources_read(). 2026-10-16.';
ALTER TABLE public.market_source_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_source_days FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.market_source_days TO service_role;

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
           o.slug, o.display_name, o.category, regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
           public.market_venue_label(o.slug) AS house
    FROM public.observation_sources o
    WHERE o.slug IS NOT NULL AND o.display_name IS NOT NULL
    ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), o.created_at, o.slug
  ), pop AS (
    SELECT DISTINCT ON (regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'))
           regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g') AS nslug,
           c.universe_total, c.census_method, c.census_confidence, c.census_at
    FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
    WHERE c.universe_total IS NULL OR c.universe_historical IS NOT NULL
    ORDER BY regexp_replace(lower(o.slug), '[^a-z0-9]', '', 'g'), c.census_at DESC
  ), lan AS (
    SELECT regexp_replace(lower(source_slug), '[^a-z0-9]', '', 'g') AS nslug, max(landed_lots) AS landed_lots,
           max(measured_at) AS landed_at
    FROM public.mv_source_target_landed
    GROUP BY 1
  ), mapq AS (
    SELECT source_name AS house, count(*) AS sales, sum(sold_amount) AS usd
    FROM public.mv_treemap_outcomes
    WHERE outcome = 'sold' AND sold_amount > 0 AND source_name IS NOT NULL
    GROUP BY 1
  ), fam AS (
    SELECT source AS house,
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
  )
  SELECT current_date, s.slug, s.display_name, s.category, s.house, l.landed_lots, l.landed_at, p.universe_total,
         p.census_method, p.census_confidence::numeric, p.census_at, mq.sales, mq.usd, f.sales_12m, f.usd_12m,
         f.sales_prior_12m, f.usd_prior_12m, mo.months, now()
  FROM src s
  LEFT JOIN lan l USING (nslug)
  LEFT JOIN pop p USING (nslug)
  LEFT JOIN mapq mq ON mq.house = s.house
  LEFT JOIN fam f ON f.house = s.house
  LEFT JOIN mon mo ON mo.house = s.house
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
  'Writes today''s market_source_days row for every declared source holding data (held lots, census total, map sales, '
  'sales by sale date); a second call the same day replaces that day''s rows. Cron market-source-days, 10:47Z. 2026-10-16.';
REVOKE ALL ON FUNCTION public.record_market_source_day() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_market_source_day() TO service_role;

CREATE OR REPLACE FUNCTION public.market_sources_read()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH d AS (
    SELECT max(day) AS day FROM public.market_source_days
  ), cur AS (
    SELECT m.* FROM public.market_source_days m JOIN d ON m.day = d.day
  ), ago AS (
    SELECT DISTINCT ON (m.source_slug) m.source_slug, m.day, m.landed_lots
    FROM public.market_source_days m CROSS JOIN d
    WHERE m.day <= d.day - 7
    ORDER BY m.source_slug, m.day DESC
  ), live AS (
    SELECT regexp_replace(lower(s.slug), '[^a-z0-9]', '', 'g') AS nslug,
           count(*) FILTER (WHERE m.is_live AND m.auction_end_time > now() AND m.updated_at > now() - interval '2 hours')
             AS live_lots,
           max(m.updated_at) FILTER (WHERE m.is_live AND m.auction_end_time > now()) AS live_at
    FROM public.live_auction_sources s
    JOIN public.monitored_auctions m ON m.source_id = s.id
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'day', (SELECT day FROM d),
    'columns', jsonb_build_array('source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population',
                                 'population_method', 'population_confidence', 'population_at', 'map_sales', 'map_usd',
                                 'sales_12m', 'usd_12m', 'sales_prior_12m', 'usd_prior_12m', 'months', 'live_lots', 'live_at',
                                 'held_lots_before', 'before_day'),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(c.source_slug, c.display_name, c.category, c.house, c.landed_lots, c.landed_at,
                                         c.population, c.population_method, c.population_confidence, c.population_at,
                                         c.map_sales, c.map_usd, c.sales_12m, c.usd_12m, c.sales_prior_12m, c.usd_prior_12m,
                                         c.months, coalesce(l.live_lots, 0), l.live_at, a.landed_lots, a.day)
                       ORDER BY c.landed_lots DESC NULLS LAST, c.sales_12m DESC NULLS LAST, c.source_slug)
      FROM cur c
      LEFT JOIN ago a USING (source_slug)
      LEFT JOIN live l ON l.nslug = regexp_replace(lower(c.source_slug), '[^a-z0-9]', '', 'g')), '[]'::jsonb));
$$;
COMMENT ON FUNCTION public.market_sources_read() IS
  'The Sources board: every source holding data, ranked by lots held, with the same measures (held lots and when, census '
  'total, map sales, sales by sale date, live lots now, held lots a week earlier). Anon. 2026-10-16.';
REVOKE ALL ON FUNCTION public.market_sources_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_sources_read() TO anon, authenticated, service_role;

DO $jobs$
DECLARE
  j record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'market-source-days') THEN
    PERFORM cron.schedule('market-source-days', '47 10 * * *',
      $cmd$SELECT set_config('app.writer', 'market-source-days', false); SET statement_timeout = '120s'; SELECT public.record_market_source_day()$cmd$);
  END IF;
  -- the held-lot fold, paused since the 10-15 outage recovery: once a day at 10:27Z, command and timeout untouched
  SELECT jobid, command INTO j FROM cron.job WHERE jobname = 'refresh-source-target-landed';
  IF FOUND THEN
    IF position('mv_source_target_landed' IN j.command) = 0 THEN
      RAISE EXCEPTION 'refresh-source-target-landed no longer refreshes mv_source_target_landed: %', j.command;
    END IF;
    PERFORM cron.alter_job(j.jobid, schedule := '27 10 * * *', active := true);
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobid = j.jobid AND schedule = '27 10 * * *' AND active) THEN
      RAISE EXCEPTION 'refresh-source-target-landed did not take its daily schedule';
    END IF;
  END IF;
END $jobs$;

COMMIT;
