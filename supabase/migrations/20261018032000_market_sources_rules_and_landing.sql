-- The Sources board: markets only, each market once, and what each one is landing now.
--
-- Owner, 2026-10-16 00:2xZ, on the board (20261018030000): "facebook is over repped because your rules of sources is
-- sloppy", and "all these should be active.. we should see them growing". The board listed every observation source
-- holding data in one ranking: capture channels beside their market (Facebook Saved Items beside Facebook Marketplace,
-- the 2017-18 Craigslist archive beside Craigslist), duplicate registrations (classic-driver / classicdriver,
-- er-classics / erclassics), sources that are not markets (aggregators relisting others' lots, dealers, shops,
-- registries), and auction lots ranked against classified listings. Held counts changed once a day, so nothing moved.
--
-- 1. observation_sources.market_slug: the market a source captures for (a capture channel or a duplicate registration).
--    Such a source is never a board row of its own. Set for the four known today.
-- 2. market_sources_read ranks markets only, in two groups: 'auction' (lots that end in a result) and 'marketplace'
--    (listings that carry an ask), each by lots or listings held. Other categories holding data are counted in
--    'not_ranked', never ranked.
-- 3. market_source_hours: vehicle_events rows landed per source per hour (created_at, the source's own platform key),
--    written by record_market_source_hours() at :09 each hour for the last three hours (late rows land in their hour).
--    The reader carries each market's records landed in the last 24 hours and 7 days, its last landing, and 14 daily
--    counts, so the board shows which sources are landing data now and how fast.
-- Measured 2026-10-16 00:3xZ (prod, read-only): 14 days of hourly counts by platform from vehicle_events in 13 s on its
-- created_at index; the last 24 hours landed Mecum 151,435, Bonhams 11,443, Barrett-Jackson 3,945, Barn Finds 3,584,
-- Gooding 2,688, BaT 2,055, Craigslist 1,257, eBay Motors 1,121 records.
-- Contract: supabase/sql/test_market_sources_board.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.observation_sources ADD COLUMN IF NOT EXISTS market_slug text;
COMMENT ON COLUMN public.observation_sources.market_slug IS
  'The market this source captures for, when it is a capture channel or a duplicate registration of another source '
  '(that source''s slug); null when the source is its own market. The Sources board never ranks it apart. 2026-10-16.';
UPDATE public.observation_sources o SET market_slug = v.market
FROM (VALUES ('facebook-saved', 'facebook_marketplace'), ('craigslist_archive', 'craigslist'),
             ('classic-driver', 'classicdriver'), ('erclassics', 'er-classics')) v(slug, market)
WHERE o.slug = v.slug AND o.market_slug IS DISTINCT FROM v.market
  AND EXISTS (SELECT 1 FROM public.observation_sources m WHERE m.slug = v.market);

CREATE TABLE IF NOT EXISTS public.market_source_hours (
  hour timestamptz NOT NULL,
  source_key text NOT NULL,           -- vehicle_events.source_platform, lower case, letters and digits only
  records integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hour, source_key)
);
COMMENT ON TABLE public.market_source_hours IS
  'vehicle_events rows landed per source per hour (created_at), by the source''s platform key. Written by '
  'record_market_source_hours() hourly; read by market_sources_read() for what each market is landing now. 2026-10-16.';
ALTER TABLE public.market_source_hours ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_source_hours FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.market_source_hours TO service_role;

CREATE OR REPLACE FUNCTION public.record_market_source_hours(p_hours integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
  v_from timestamptz := date_trunc('hour', now()) - make_interval(hours => least(greatest(coalesce(p_hours, 3), 1), 24 * 30) - 1);
BEGIN
  INSERT INTO public.market_source_hours (hour, source_key, records, recorded_at)
  SELECT date_trunc('hour', e.created_at), regexp_replace(lower(e.source_platform), '[^a-z0-9]', '', 'g'), count(*), now()
  FROM public.vehicle_events e
  WHERE e.created_at >= v_from AND e.source_platform IS NOT NULL
  GROUP BY 1, 2
  ON CONFLICT (hour, source_key) DO UPDATE SET records = EXCLUDED.records, recorded_at = EXCLUDED.recorded_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END
$$;
COMMENT ON FUNCTION public.record_market_source_hours(integer) IS
  'Counts vehicle_events rows landed per source per hour for the last p_hours hours (1 to 720), replacing those hours. '
  'Cron market-source-hours at :09; run once with 336 to fill 14 days. 2026-10-16.';
REVOKE ALL ON FUNCTION public.record_market_source_hours(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_market_source_hours(integer) TO service_role;

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
    SELECT m.*, o.market_slug, regexp_replace(lower(m.source_slug), '[^a-z0-9]', '', 'g') AS nslug
    FROM public.market_source_days m
    JOIN d ON m.day = d.day
    LEFT JOIN public.observation_sources o ON o.slug = m.source_slug
  ), ranked AS (
    SELECT * FROM cur WHERE market_slug IS NULL AND category IN ('auction', 'marketplace')
  ), ago AS (
    SELECT DISTINCT ON (m.source_slug) m.source_slug, m.day, m.landed_lots
    FROM public.market_source_days m CROSS JOIN d
    WHERE m.day <= d.day - 7
    ORDER BY m.source_slug, m.day DESC
  ), live AS (
    SELECT regexp_replace(lower(s.slug), '[^a-z0-9]', '', 'g') AS nslug,
           count(*) FILTER (WHERE m.is_live AND m.auction_end_time > now() AND m.updated_at > now() - interval '24 hours')
             AS live_lots,
           max(m.updated_at) FILTER (WHERE m.is_live AND m.auction_end_time > now()) AS live_at
    FROM public.live_auction_sources s
    JOIN public.monitored_auctions m ON m.source_id = s.id
    GROUP BY 1
  ), hrs AS (
    SELECT h.source_key AS nslug,
           sum(h.records) FILTER (WHERE h.hour >= date_trunc('hour', now()) - interval '23 hours') AS landed_24h,
           sum(h.records) FILTER (WHERE h.hour >= date_trunc('hour', now()) - interval '167 hours') AS landed_7d,
           max(h.hour) FILTER (WHERE h.records > 0) AS last_hour
    FROM public.market_source_hours h
    WHERE h.hour >= date_trunc('day', now()) - interval '13 days'
    GROUP BY 1
  ), days AS (
    SELECT k.nslug, jsonb_agg(coalesce(x.n, 0) ORDER BY k.day) AS days14
    FROM (SELECT DISTINCT source_key AS nslug, gs::date AS day
          FROM public.market_source_hours,
               generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') gs
          WHERE hour >= date_trunc('day', now()) - interval '13 days') k
    LEFT JOIN (SELECT source_key AS nslug, hour::date AS day, sum(records) AS n
               FROM public.market_source_hours
               WHERE hour >= date_trunc('day', now()) - interval '13 days'
               GROUP BY 1, 2) x USING (nslug, day)
    GROUP BY 1
  ), last_ever AS (
    SELECT source_key AS nslug, max(hour) AS last_hour FROM public.market_source_hours WHERE records > 0 GROUP BY 1
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'day', (SELECT day FROM d),
    'columns', jsonb_build_array('source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population',
                                 'population_method', 'population_confidence', 'population_at', 'map_sales', 'map_usd',
                                 'sales_12m', 'usd_12m', 'sales_prior_12m', 'usd_prior_12m', 'months', 'live_lots', 'live_at',
                                 'held_lots_before', 'before_day', 'landed_24h', 'landed_7d', 'last_landed', 'days14'),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(c.source_slug, c.display_name, c.category, c.house, c.landed_lots, c.landed_at,
                                         c.population, c.population_method, c.population_confidence, c.population_at,
                                         c.map_sales, c.map_usd, c.sales_12m, c.usd_12m, c.sales_prior_12m, c.usd_prior_12m,
                                         c.months, coalesce(l.live_lots, 0), l.live_at, a.landed_lots, a.day,
                                         coalesce(h.landed_24h, 0), coalesce(h.landed_7d, 0),
                                         coalesce(h.last_hour, le.last_hour), coalesce(dd.days14, '[]'::jsonb))
                       ORDER BY (c.category = 'auction') DESC, c.landed_lots DESC NULLS LAST, c.sales_12m DESC NULLS LAST,
                                c.source_slug)
      FROM ranked c
      LEFT JOIN ago a USING (source_slug)
      LEFT JOIN live l ON l.nslug = c.nslug
      LEFT JOIN hrs h ON h.nslug = c.nslug
      LEFT JOIN days dd ON dd.nslug = c.nslug
      LEFT JOIN last_ever le ON le.nslug = c.nslug), '[]'::jsonb),
    'not_ranked', coalesce((
      SELECT jsonb_object_agg(k, n) FROM (
        SELECT CASE WHEN market_slug IS NOT NULL THEN 'capture channels' ELSE coalesce(category, 'uncategorized') END AS k,
               count(*) AS n
        FROM cur WHERE NOT (market_slug IS NULL AND category IN ('auction', 'marketplace'))
        GROUP BY 1) x), '{}'::jsonb));
$$;
COMMENT ON FUNCTION public.market_sources_read() IS
  'The Sources board: markets only (auction houses, then marketplaces), each ranked by lots or listings held, with held '
  'lots and when, census total, map sales, sales by sale date, live lots now (read within 24 h), held lots a week earlier, '
  'and records landed in the last 24 h and 7 days with 14 daily counts; other categories counted in not_ranked. Anon. '
  '2026-10-16.';
REVOKE ALL ON FUNCTION public.market_sources_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_sources_read() TO anon, authenticated, service_role;

DO $jobs$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'market-source-hours') THEN
    PERFORM cron.schedule('market-source-hours', '9 * * * *',
      $cmd$SELECT set_config('app.writer', 'market-source-hours', false); SET statement_timeout = '60s'; SELECT public.record_market_source_hours(3)$cmd$);
  END IF;
END $jobs$;

COMMIT;
