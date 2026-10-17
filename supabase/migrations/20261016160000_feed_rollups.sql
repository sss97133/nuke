-- Feed rollups: the sources that have rows today, and the stats strip's counts, from one hourly job.
--
-- Measured 2026-10-15: the home feed's Sources filter was six hard-coded toggles, and its stats strip read
-- portfolio_stats_cache, last updated 2026-04-14 ("408K records", "today +480", $17.3B, 67K for sale), because the
-- refresh job (refresh_stats_every_5min, jobid 107, now inactive) ran a full-table aggregate. A group-by over vehicles
-- for the last 24 h hit a 25 s statement timeout on 2026-10-15; vehicle_events by created_at answers in seconds.
--
--   feed_source_rollup: one row per vehicle_events.source_platform with rows in the last 24 h (n_24h = distinct vehicles),
--     its label, and the vehicles.discovery_source values it covers (what feed-query's source filter matches on).
--     Sources with no rows in 24 h keep their row with n_24h = 0; the sidebar lists only n_24h > 0.
--   portfolio_stats_cache 'global': total_vehicles becomes the planner's row estimate for public, undeleted vehicles
--     (EXPLAIN, no scan; total_is_estimate = true) and vehicles_added_today the distinct vehicles with a vehicle_events row
--     created since 00:00 UTC; counts_updated_at says when. Value, for-sale and sales figures stay as last computed;
--     value_updated_at records that date so the strip can hide them when they are old.
-- One cron job, hourly, 20 s statement timeout, skipped when any backend waits on a lock.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.feed_source_rollup (
  source_platform   text PRIMARY KEY,
  label             text NOT NULL,
  discovery_sources text[] NOT NULL,
  n_24h             integer NOT NULL DEFAULT 0,
  refreshed_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.feed_source_rollup IS
  'Sources with rows in the last 24 h, written hourly by refresh_feed_rollups() from vehicle_events (grain: one source_platform). n_24h counts distinct vehicles with a vehicle_events row created in the 24 h before refreshed_at. discovery_sources lists the vehicles.discovery_source values the feed filter should match for that source. Read by the home feed Sources filter.';
ALTER TABLE public.feed_source_rollup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feed_source_rollup_read ON public.feed_source_rollup;
CREATE POLICY feed_source_rollup_read ON public.feed_source_rollup FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.feed_source_rollup FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.feed_source_rollup TO anon, authenticated, service_role;

ALTER TABLE public.portfolio_stats_cache
  ADD COLUMN IF NOT EXISTS counts_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_is_estimate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS value_updated_at timestamptz;
UPDATE public.portfolio_stats_cache SET value_updated_at = updated_at WHERE value_updated_at IS NULL;
COMMENT ON COLUMN public.portfolio_stats_cache.counts_updated_at IS 'When total_vehicles and vehicles_added_today were last written by refresh_feed_rollups().';
COMMENT ON COLUMN public.portfolio_stats_cache.total_is_estimate IS 'True when total_vehicles is the planner row estimate for public undeleted vehicles, not an exact count.';
COMMENT ON COLUMN public.portfolio_stats_cache.value_updated_at IS 'When total_value, for_sale_count and the sales figures were last computed (they are not refreshed by refresh_feed_rollups()).';

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
  SET LOCAL statement_timeout = '20s';
  SET LOCAL lock_timeout = '2s';
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()) THEN
    RETURN jsonb_build_object('skipped', 'lock waiters');
  END IF;

  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT 1 FROM public.vehicles WHERE is_public IS TRUE AND deleted_at IS NULL' INTO v_plan;
  v_total := (v_plan -> 0 -> 'Plan' ->> 'Plan Rows')::bigint;

  SELECT count(DISTINCT vehicle_id) INTO v_today FROM public.vehicle_events
  WHERE vehicle_id IS NOT NULL AND created_at >= (date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');

  WITH d AS (
    SELECT source_platform, count(DISTINCT vehicle_id)::integer AS n
    FROM public.vehicle_events
    WHERE created_at >= now() - interval '24 hours' AND source_platform IS NOT NULL AND vehicle_id IS NOT NULL
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
  INSERT INTO public.feed_source_rollup (source_platform, label, discovery_sources, n_24h, refreshed_at)
  SELECT d.source_platform, coalesce(a.label, d.source_platform), coalesce(a.ds, ARRAY[d.source_platform]), d.n, now()
  FROM d LEFT JOIN alias a ON a.sp = d.source_platform
  ON CONFLICT (source_platform) DO UPDATE
    SET label = excluded.label, discovery_sources = excluded.discovery_sources, n_24h = excluded.n_24h, refreshed_at = excluded.refreshed_at;
  GET DIAGNOSTICS v_sources = ROW_COUNT;
  UPDATE public.feed_source_rollup SET n_24h = 0, refreshed_at = now() WHERE refreshed_at < now() - interval '1 minute';

  UPDATE public.portfolio_stats_cache
  SET total_vehicles = v_total, total_is_estimate = true, vehicles_added_today = v_today, counts_updated_at = now()
  WHERE id = 'global';

  RETURN jsonb_build_object('sources_with_rows', v_sources, 'total_estimate', v_total, 'added_today', v_today);
END
$$;
REVOKE ALL ON FUNCTION public.refresh_feed_rollups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_feed_rollups() TO service_role;
COMMENT ON FUNCTION public.refresh_feed_rollups() IS
  'Hourly: feed_source_rollup (24 h, from vehicle_events), portfolio_stats_cache.total_vehicles (planner estimate of public undeleted vehicles) and vehicles_added_today (distinct vehicles with a vehicle_events row since 00:00 UTC). 20 s statement timeout; returns {skipped} when a backend waits on a lock.';

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-feed-rollups') FROM cron.job WHERE jobname = 'refresh-feed-rollups';
  PERFORM cron.schedule('refresh-feed-rollups', '12 * * * *', 'SELECT public.refresh_feed_rollups()');
END
$$;
