-- The feed strip total is the map's exact public-record count (treemap_refreshes.populations.public_records, e.g. 681,830
-- as of the 2026-10-15 09:10Z refresh), with that refresh's time in total_as_of. The planner estimate swung from 578,030
-- to ~704K in one hour (autovacuum ANALYZE) and is now only a fallback. Updates when the map refreshes.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.portfolio_stats_cache ADD COLUMN IF NOT EXISTS total_as_of timestamptz;
COMMENT ON COLUMN public.portfolio_stats_cache.total_as_of IS 'When the map refresh that supplied total_vehicles (public_records) ran; NULL when total_vehicles is the planner estimate.';

CREATE OR REPLACE FUNCTION public.refresh_feed_rollups()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan jsonb;
  v_total bigint;
  v_total_as_of timestamptz;
  v_today integer;
  v_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
  v_prev record;
  v_since timestamptz;
  v_sources integer;
BEGIN
  SET LOCAL statement_timeout = '25s';
  SET LOCAL lock_timeout = '2s';
  IF EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE datname = current_database() AND backend_type = 'client backend' AND wait_event_type = 'Lock'
      AND pid <> pg_backend_pid() AND now() - state_change > interval '10 seconds'
  ) THEN
    RETURN jsonb_build_object('skipped', 'lock waiters');
  END IF;

  -- The total is the map's exact count of public records from its latest refresh (treemap_refreshes.populations), with
  -- that refresh's time, so the feed and the map show one number with one definition. The planner estimate is the
  -- fallback only when no receipt exists.
  SELECT (populations ->> 'public_records')::bigint, refreshed_at INTO v_total, v_total_as_of
  FROM public.treemap_refreshes WHERE populations ? 'public_records' ORDER BY refreshed_at DESC LIMIT 1;
  IF v_total IS NULL THEN
    EXECUTE 'EXPLAIN (FORMAT JSON) SELECT 1 FROM public.vehicles WHERE is_public IS TRUE AND deleted_at IS NULL' INTO v_plan;
    v_total := (v_plan -> 0 -> 'Plan' ->> 'Plan Rows')::bigint;
    v_total_as_of := NULL;
  END IF;

  SELECT counts_updated_at, vehicles_added_today INTO v_prev FROM public.portfolio_stats_cache WHERE id = 'global';
  IF v_prev.counts_updated_at IS NOT NULL AND v_prev.counts_updated_at >= v_day_start THEN
    v_since := v_prev.counts_updated_at;
  ELSE
    v_since := greatest(v_day_start, now() - interval '3 hours'); -- first run of a day: the last 3 hours at most
    v_prev.vehicles_added_today := 0;
  END IF;
  -- Dynamic SQL with the literal bound: a generic plan for the parameterised form chose the status index and ran for
  -- seconds where the literal form answers in under one (measured 2026-10-15, 20 minutes of rows).
  EXECUTE format($q$SELECT count(DISTINCT vehicle_id) FROM public.vehicle_events
    WHERE vehicle_id IS NOT NULL AND created_at >= %L AND created_at < now()
      AND (event_type = 'listing' OR event_status IN ('listed', 'upcoming'))$q$, v_since) INTO v_today;
  v_today := coalesce(v_prev.vehicles_added_today, 0) + coalesce(v_today, 0);

  WITH d AS (
    SELECT source_platform, count(DISTINCT vehicle_id)::integer AS n
    FROM public.vehicle_events
    WHERE created_at >= now() - interval '70 minutes' AND source_platform IS NOT NULL AND vehicle_id IS NOT NULL
    GROUP BY 1
  ), alias(sp, label, ds) AS (VALUES
    ('bat', 'Bring a Trailer', ARRAY['bat','bring_a_trailer','bringatrailer']),
    ('cars_and_bids', 'Cars & Bids', ARRAY['cars-and-bids','cars_and_bids','carsandbids']),
    ('craigslist', 'Craigslist', ARRAY['craigslist']),
    ('ksl', 'KSL', ARRAY['ksl']),
    ('classiccars', 'ClassicCars.com', ARRAY['classiccars']),
    ('facebook_marketplace', 'Facebook Marketplace', ARRAY['facebook_marketplace']),
    ('mecum', 'Mecum', ARRAY['mecum']),
    ('bonhams', 'Bonhams', ARRAY['bonhams']),
    ('barnfinds', 'Barn Finds', ARRAY['barnfinds']),
    ('rm-sothebys', 'RM Sotheby''s', ARRAY['rmsothebys','rm-sothebys']),
    ('rmsothebys', 'RM Sotheby''s', ARRAY['rmsothebys','rm-sothebys']),
    ('gooding', 'Gooding & Co', ARRAY['gooding','gooding_extract']),
    ('pcarmarket', 'PCarMarket', ARRAY['PCARMARKET','pcarmarket','import-pcarmarket-listing']),
    ('barrett_jackson', 'Barrett-Jackson', ARRAY['barrett-jackson','barrett_jackson','barrettjackson']),
    ('barrettjackson', 'Barrett-Jackson', ARRAY['barrett-jackson','barrett_jackson','barrettjackson']),
    ('collecting_cars', 'Collecting Cars', ARRAY['collecting-cars','collecting_cars','collectingcars']),
    ('hagerty', 'Hagerty', ARRAY['hagerty']),
    ('ebay_motors', 'eBay Motors', ARRAY['ebay_motors','ebay']),
    ('broad-arrow', 'Broad Arrow', ARRAY['broad-arrow','broadarrow'])
  )
  INSERT INTO public.feed_source_rollup (source_platform, label, discovery_sources, n_1h, last_seen_at, refreshed_at)
  SELECT d.source_platform, coalesce(a.label, d.source_platform), coalesce(a.ds, ARRAY[d.source_platform]), d.n, now(), now()
  FROM d LEFT JOIN alias a ON a.sp = d.source_platform
  ON CONFLICT (source_platform) DO UPDATE
    SET label = excluded.label, discovery_sources = excluded.discovery_sources, n_1h = excluded.n_1h,
        last_seen_at = excluded.last_seen_at, refreshed_at = excluded.refreshed_at;
  GET DIAGNOSTICS v_sources = ROW_COUNT;
  UPDATE public.feed_source_rollup SET n_1h = 0, refreshed_at = now() WHERE refreshed_at < now() - interval '1 minute';

  UPDATE public.portfolio_stats_cache
  SET total_vehicles = v_total, total_is_estimate = (v_total_as_of IS NULL), total_as_of = v_total_as_of, vehicles_added_today = v_today, counts_updated_at = now()
  WHERE id = 'global';

  RETURN jsonb_build_object('sources_seen', v_sources, 'total_estimate', v_total, 'added_today', v_today);
END
$$;
REVOKE ALL ON FUNCTION public.refresh_feed_rollups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_feed_rollups() TO service_role;
