-- refresh_feed_rollups, bounded. First run (2026-10-15) showed the 24 h group-by over vehicle_events and the "today"
-- distinct count both exceed 20-25 s while Mecum writes ~12,000 rows an hour, and that every client lock wait is not
-- a reason to skip (autovacuum and the replication slot wait on locks all day).
--   - feed_source_rollup now records n_1h (distinct vehicles with a vehicle_events row in the last 70 minutes, which
--     answers in seconds) and last_seen_at (the last run that saw rows). The sidebar lists sources seen in the last 24 h.
--   - vehicles_added_today counts distinct vehicles with a listing event or a listed/upcoming auction event since
--     00:00 UTC (listings that went online), not the Mecum sold-lot backfill rows. 7 s measured.
--   - the lock guard counts only client backends that have waited on a lock for 10 s or more.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.feed_source_rollup
  ADD COLUMN IF NOT EXISTS n_1h integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
COMMENT ON COLUMN public.feed_source_rollup.n_1h IS 'Distinct vehicles with a vehicle_events row created in the 70 minutes before refreshed_at.';
COMMENT ON COLUMN public.feed_source_rollup.last_seen_at IS 'The last refresh that found rows for this source. The home feed lists sources whose last_seen_at is within 24 h.';
COMMENT ON COLUMN public.feed_source_rollup.n_24h IS 'Unused (the 24 h group-by was too slow); see n_1h and last_seen_at.';
COMMENT ON TABLE public.feed_source_rollup IS
  'Sources recently seen in vehicle_events, written hourly by refresh_feed_rollups() (grain: one source_platform). last_seen_at is the last run that found rows; n_1h the distinct vehicles in the 70 minutes before that run. discovery_sources lists the vehicles.discovery_source values the feed filter matches for the source. Read by the home feed Sources filter.';

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

  SELECT count(DISTINCT vehicle_id) INTO v_today FROM public.vehicle_events
  WHERE vehicle_id IS NOT NULL
    AND created_at >= (date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc')
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
