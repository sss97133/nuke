-- refresh_feed_rollups: "added today" is incremental. A scan of today's vehicle_events (Mecum alone writes ~12,000 rows
-- an hour) took 17-25 s by mid-afternoon UTC and timed out. Each run now counts only the rows created since the last run
-- (never before 00:00 UTC) and adds them to the stored figure; the figure resets at the UTC day boundary. A listing event
-- is written once per (vehicle, source, listing id), so a vehicle is not counted twice by consecutive runs.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.refresh_feed_rollups()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan jsonb;
  v_total bigint;
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

  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT 1 FROM public.vehicles WHERE is_public IS TRUE AND deleted_at IS NULL' INTO v_plan;
  v_total := (v_plan -> 0 -> 'Plan' ->> 'Plan Rows')::bigint;

  SELECT counts_updated_at, vehicles_added_today INTO v_prev FROM public.portfolio_stats_cache WHERE id = 'global';
  IF v_prev.counts_updated_at IS NOT NULL AND v_prev.counts_updated_at >= v_day_start THEN
    v_since := v_prev.counts_updated_at;
  ELSE
    v_since := greatest(v_day_start, now() - interval '3 hours'); -- first run of a day: the last 3 hours at most
    v_prev.vehicles_added_today := 0;
  END IF;
  SELECT coalesce(v_prev.vehicles_added_today, 0) + count(DISTINCT vehicle_id) INTO v_today FROM public.vehicle_events
  WHERE vehicle_id IS NOT NULL AND created_at >= v_since AND created_at < now()
    AND (event_type = 'listing' OR event_status IN ('listed', 'upcoming'));

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
  SET total_vehicles = v_total, total_is_estimate = true, vehicles_added_today = v_today, counts_updated_at = now()
  WHERE id = 'global';

  RETURN jsonb_build_object('sources_seen', v_sources, 'total_estimate', v_total, 'added_today', v_today);
END
$$;
REVOKE ALL ON FUNCTION public.refresh_feed_rollups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_feed_rollups() TO service_role;
